import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { StringDecoder } from 'string_decoder';
import { EventEmitter } from 'events';
import pool from '../db';

export const ciLogEvents = new EventEmitter();
ciLogEvents.setMaxListeners(200);

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const execAsync = promisify(exec);
const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
});
redisConnection.on('error', (err) => {
  // Gracefully log without crashing
});

export const redisPublisher = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
});
redisPublisher.on('error', () => {});

export const redisSubscriber = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
});
redisSubscriber.on('error', () => {});

redisPublisher.connect().catch((err) => {
  console.log('[Redis Pub/Sub] Publisher running in local fallback mode:', err.message);
});

redisSubscriber.connect().then(() => {
  redisSubscriber.psubscribe('ci:logs:*', () => {});
  redisSubscriber.on('pmessage', (_pattern, channel, message) => {
    try {
      const runId = channel.replace('ci:logs:', '');
      const data = JSON.parse(message);
      ciLogEvents.emit(`remote-log:${runId}`, data);
      if (data.finished) {
        ciLogEvents.emit(`remote-finish:${runId}`, data);
      }
    } catch {}
  });
}).catch((err) => {
  console.log('[Redis Pub/Sub] Subscriber running in local fallback mode:', err.message);
});

export function broadcastCILog(runId: number, data: { chunk?: string; status?: string; finished?: boolean }) {
  ciLogEvents.emit(`log:${runId}`, data);
  if (data.finished) {
    ciLogEvents.emit(`finish:${runId}`, data);
  }
  if (redisPublisher.status === 'ready') {
    redisPublisher.publish(`ci:logs:${runId}`, JSON.stringify(data)).catch(() => {});
  }
}

export const ciQueue = new Queue('ci-runs', { connection: redisConnection });

// Standardize REPOS_ROOT and SCRATCH_ROOT to respect environment variables
export const REPOS_ROOT = process.env.REPOS_ROOT 
  ? path.resolve(process.env.REPOS_ROOT) 
  : path.resolve(__dirname, '..', '..', '..', '..', 'data', 'repos');
export const SCRATCH_ROOT = process.env.SCRATCH_ROOT 
  ? path.resolve(process.env.SCRATCH_ROOT) 
  : path.resolve(__dirname, '..', '..', '..', '..', 'scratch');
const TEMP_CI_ROOT = path.join(SCRATCH_ROOT, 'ci-runs');

/**
 * BuildLogBuffer batches incoming stdout/stderr chunks and periodically flushes
 * them to PostgreSQL, guaranteeing sequential writes and complete flush before job exit.
 */
export class BuildLogBuffer {
  private runId: number;
  private flushIntervalMs: number;
  private maxBufferSize: number;
  private buffer: string[] = [];
  private currentBufferedBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  private activeFlushPromise: Promise<void> | null = null;
  private decoder = new StringDecoder('utf-8');
  private closed = false;

  constructor(runId: number, flushIntervalMs = 500, maxBufferSize = 65536) {
    this.runId = runId;
    this.flushIntervalMs = flushIntervalMs;
    this.maxBufferSize = maxBufferSize;

    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        console.error(`[BuildLogBuffer] Interval flush error for CI run #${this.runId}:`, err);
      });
    }, this.flushIntervalMs);

    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  public append(chunk: string | Buffer): void {
    if (!chunk || this.closed) return;
    const str = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    if (!str) return;

    this.buffer.push(str);
    this.currentBufferedBytes += Buffer.byteLength(str, 'utf-8');

    // Flush immediately if buffer exceeds threshold and no flush is currently active
    if (this.currentBufferedBytes >= this.maxBufferSize && !this.activeFlushPromise) {
      this.flush().catch((err) => {
        console.error(`[BuildLogBuffer] Threshold flush error for CI run #${this.runId}:`, err);
      });
    }
  }

  public async flush(): Promise<void> {
    while (this.activeFlushPromise) {
      await this.activeFlushPromise;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer.join('');
    this.buffer = [];
    this.currentBufferedBytes = 0;

    this.activeFlushPromise = (async () => {
      try {
        await pool.query(
          `UPDATE ci_runs 
           SET log = COALESCE(log, '') || $1 
           WHERE id = $2`,
          [batch, this.runId]
        );
        broadcastCILog(this.runId, { chunk: batch, status: 'running' });
      } catch (err) {
        console.error(`[BuildLogBuffer] Database write error for CI run #${this.runId}:`, err);
      } finally {
        this.activeFlushPromise = null;
      }
    })();

    await this.activeFlushPromise;
  }

  public async flushAndClose(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Flush remaining decoded characters if any
    const trailing = this.decoder.end();
    if (trailing) {
      this.buffer.push(trailing);
      this.currentBufferedBytes += Buffer.byteLength(trailing, 'utf-8');
    }

    // Wait for in-flight write to complete and drain buffer
    while (this.activeFlushPromise || this.buffer.length > 0) {
      await this.flush();
    }
  }

  public getBufferedBytes(): number {
    return this.currentBufferedBytes;
  }

  public isClosed(): boolean {
    return this.closed;
  }
}

// Database helper to append logs and update status
export async function updateRun(runId: number, status: string, logChunk?: string, finished = false) {
  try {
    if (logChunk) {
      await pool.query(
        `UPDATE ci_runs 
         SET status = $1, 
             log = COALESCE(log, '') || $2, 
             finished_at = $3 
         WHERE id = $4`,
        [status, logChunk, finished ? new Date() : null, runId]
      );
      broadcastCILog(runId, { chunk: logChunk, status, finished });
    } else {
      await pool.query(
        `UPDATE ci_runs 
         SET status = $1, 
             finished_at = $2 
         WHERE id = $3`,
        [status, finished ? new Date() : null, runId]
      );
      broadcastCILog(runId, { status, finished });
    }
  } catch (err) {
    console.error(`Error updating CI run ${runId} in database:`, err);
  }
}

// Background Worker processing CI runs
export const ciWorker = new Worker(
  'ci-runs',
  async (job: Job) => {
    const { runId, repoPath, commitHash } = job.data;
    console.log(`[CI Worker] Processing Job ${job.id} for CI Run #${runId} (Commit: ${commitHash})`);

    // 1. Mark run as running
    await updateRun(runId, 'running', `[CI System] Starting build for commit ${commitHash}...\n`);

    // 2. Fetch .gitpub-ci.yml using git show
    let ciConfig: any;
    try {
      const { stdout } = await execAsync(`git show "${commitHash}:.gitpub-ci.yml"`, { cwd: repoPath });
      ciConfig = yaml.parse(stdout);
    } catch (error: any) {
      await updateRun(
        runId,
        'failed',
        `[CI Error] Failed to read .gitpub-ci.yml: file not found or invalid format.\nBuild aborted.\n`,
        true
      );
      return;
    }

    // 3. Parse commands from script or steps block
    let commands: string[] = [];
    if (Array.isArray(ciConfig?.script)) {
      commands = ciConfig.script.map((s: any) => typeof s === 'string' ? s : (s?.command || ''));
    } else if (Array.isArray(ciConfig?.steps)) {
      commands = ciConfig.steps.map((s: any) => typeof s === 'string' ? s : (s?.command || ''));
    }
    commands = commands.filter(Boolean);

    if (commands.length === 0) {
      await updateRun(
        runId,
        'failed',
        `[CI Error] Invalid configuration: 'script' or 'steps' list is missing or empty.\nBuild aborted.\n`,
        true
      );
      return;
    }

    const commandString = commands.join(' && ');

    // 4. Create temporary workspace for checkout
    const tempWorkspacePath = path.join(TEMP_CI_ROOT, `${runId}_${Date.now()}`);
    await fs.promises.mkdir(TEMP_CI_ROOT, { recursive: true });

    let logBuffer: BuildLogBuffer | null = null;

    try {
      await updateRun(runId, 'running', `[CI System] Cloning workspace...\n`);
      // Clone bare repository to workspace
      await execAsync(`git clone "${repoPath}" "${tempWorkspacePath}"`);

      // Checkout specific commit
      await execAsync(`git checkout "${commitHash}"`, { cwd: tempWorkspacePath });

      await updateRun(runId, 'running', `[CI System] Launching sandboxed test runner...\n\n`);

      // 5. Check Docker daemon availability and auto-build runner if missing
      let dockerAvailable = false;
      try {
        await execAsync('docker info');
        dockerAvailable = true;
      } catch {
        dockerAvailable = false;
      }

      let child: ChildProcess;

      if (!dockerAvailable) {
        const fallbackAllowed = process.env.ALLOW_LOCAL_CI_FALLBACK === 'true';
        if (!fallbackAllowed) {
          await updateRun(
            runId,
            'failed',
            `[CI System Error] Docker daemon is offline or unreachable.\nPlease start Docker Desktop to run sandboxed CI containers (or set ALLOW_LOCAL_CI_FALLBACK=true in .env for dev testing).\n`,
            true
          );
          return;
        }

        await updateRun(runId, 'running', `[CI System Notice] Docker offline. Executing in local development fallback mode...\n\n`);
        child = spawn(
          process.platform === 'win32' ? 'cmd.exe' : 'sh', 
          process.platform === 'win32' ? ['/c', commandString] : ['-c', commandString],
          { cwd: tempWorkspacePath }
        );
      } else {
        // Auto-build gitpub-ci-runner:latest image if missing
        try {
          await execAsync('docker image inspect gitpub-ci-runner:latest');
        } catch {
          await updateRun(runId, 'running', `[CI System] Building gitpub-ci-runner:latest image...\n`);
          const dockerRunnerDir = path.resolve(__dirname, '..', '..', '..', '..', 'infra', 'docker-runner');
          await execAsync(`docker build -t gitpub-ci-runner:latest "${dockerRunnerDir}"`);
          await updateRun(runId, 'running', `[CI System] Sandbox runner image ready.\n\n`);
        }

        const normalizedMountPath = tempWorkspacePath.replace(/\\/g, '/');
        const dockerArgs = [
          'run', '--rm',
          '--user', '1000:1000',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--memory=1024m', '--cpus=1.0',
          '--network', 'none',
          '-v', `${normalizedMountPath}:/workspace`,
          'gitpub-ci-runner:latest',
          'sh', '-c', `cd /workspace && ${commandString}`
        ];
        child = spawn('docker', dockerArgs);
      }

      // Initialize log buffer for process output (500ms periodic flush, 64KB threshold)
      const flushIntervalMs = Number(process.env.CI_LOG_FLUSH_INTERVAL_MS) || 500;
      logBuffer = new BuildLogBuffer(runId, flushIntervalMs, 65536);

      // Watchdog timeout (10 minutes = 600s per SRS §6)
      const timeoutMs = 600000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        logBuffer?.append(data);
      });

      child.stderr?.on('data', (data) => {
        logBuffer?.append(data);
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code ?? 0);
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          console.error(`[CI Worker] Process execution error for CI run #${runId}:`, err);
          resolve(125);
        });
      });

      // 6. Guarantee all buffered logs are flushed to PostgreSQL before finalizing status
      await logBuffer.flushAndClose();
      logBuffer = null;

      // 7. Atomically finalize run status and append final result log
      if (timedOut) {
        await updateRun(runId, 'failed', `\n[CI System Error] Execution exceeded 10-minute timeout limit. Terminated.\n`, true);
      } else if (exitCode === 0) {
        await updateRun(runId, 'success', `\n[CI System] Build succeeded! (Exit code: 0)\n`, true);
      } else {
        await updateRun(runId, 'failed', `\n[CI System] Build failed with exit code ${exitCode}.\n`, true);
      }

    } catch (buildError: any) {
      console.error('CI pipeline runner failed:', buildError);
      if (logBuffer) {
        await logBuffer.flushAndClose().catch(() => {});
      }
      const errorMsg = buildError?.message || String(buildError);
      await updateRun(runId, 'failed', `\n[CI System Error] Execution failed: ${errorMsg}\n`, true);
    } finally {
      // Clean up workspace files
      fs.promises.rm(tempWorkspacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(err => {
        console.error('Failed to cleanup CI temp workspace:', err);
      });
    }
  },
  { connection: redisConnection }
);

console.log('[Queue Module] Redis connection established, CI runner Queue & Worker active.');
