import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import pool from '../db';

const execAsync = promisify(exec);
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const ciQueue = new Queue('ci-runs', { connection: redisConnection });

const TEMP_CI_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'scratch', 'ci-runs');

// Database helper to append logs and update status
async function updateRun(runId: number, status: string, logChunk?: string, finished = false) {
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
    } else {
      await pool.query(
        `UPDATE ci_runs 
         SET status = $1, 
             finished_at = $2 
         WHERE id = $3`,
        [status, finished ? new Date() : null, runId]
      );
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

    // 3. Parse commands from script block
    const script = ciConfig?.script;
    if (!script || !Array.isArray(script) || script.length === 0) {
      await updateRun(
        runId,
        'failed',
        `[CI Error] Invalid configuration: 'script' list is missing or empty.\nBuild aborted.\n`,
        true
      );
      return;
    }

    const commandString = script.join(' && ');

    // 4. Create temporary workspace for checkout
    const tempWorkspacePath = path.join(TEMP_CI_ROOT, `${runId}_${Date.now()}`);
    await fs.promises.mkdir(TEMP_CI_ROOT, { recursive: true });

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

      if (dockerAvailable) {
        // Check if gitpub-ci-runner:latest exists, if not build it
        try {
          await execAsync('docker image inspect gitpub-ci-runner:latest');
        } catch {
          await updateRun(runId, 'running', `[CI System] Building gitpub-ci-runner:latest image...\n`);
          const dockerRunnerDir = path.resolve(__dirname, '..', '..', '..', '..', 'infra', 'docker-runner');
          await execAsync(`docker build -t gitpub-ci-runner:latest "${dockerRunnerDir}"`);
          await updateRun(runId, 'running', `[CI System] Sandbox runner image ready.\n\n`);
        }
      }

      const normalizedMountPath = tempWorkspacePath.replace(/\\/g, '/');

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
        const fallbackProcess = spawn(process.platform === 'win32' ? 'cmd.exe' : 'sh', 
          process.platform === 'win32' ? ['/c', commandString] : ['-c', commandString],
          { cwd: tempWorkspacePath }
        );

        fallbackProcess.stdout.on('data', async (data) => {
          await updateRun(runId, 'running', data.toString());
        });

        fallbackProcess.stderr.on('data', async (data) => {
          await updateRun(runId, 'running', data.toString());
        });

        const exitCode = await new Promise<number>((resolve) => {
          fallbackProcess.on('close', (code) => resolve(code ?? 0));
          fallbackProcess.on('error', () => resolve(1));
        });

        if (exitCode === 0) {
          await updateRun(runId, 'success', `\n[CI System] Build succeeded! (Exit code: 0)\n`, true);
        } else {
          await updateRun(runId, 'failed', `\n[CI System] Build failed with exit code ${exitCode}.\n`, true);
        }
        return;
      }

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

      const child = spawn('docker', dockerArgs);

      // Watchdog timeout (10 minutes = 600s per SRS §6)
      const timeoutMs = 600000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        updateRun(runId, 'failed', `\n[CI System Error] Execution exceeded 10-minute timeout limit. Terminated.\n`, true);
      }, timeoutMs);

      child.stdout.on('data', async (data) => {
        await updateRun(runId, 'running', data.toString());
      });

      child.stderr.on('data', async (data) => {
        await updateRun(runId, 'running', data.toString());
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code ?? 0);
        });
        child.on('error', () => {
          clearTimeout(timer);
          resolve(125);
        });
      });

      if (!timedOut) {
        if (exitCode === 0) {
          await updateRun(runId, 'success', `\n[CI System] Build succeeded! (Exit code: 0)\n`, true);
        } else {
          await updateRun(runId, 'failed', `\n[CI System] Build failed with exit code ${exitCode}.\n`, true);
        }
      }

    } catch (buildError: any) {
      console.error('CI pipeline runner failed:', buildError);
      await updateRun(runId, 'failed', `\n[CI System Error] Execution failed: ${buildError.message}\n`, true);
    } finally {
      // Clean up workspace files
      fs.promises.rm(tempWorkspacePath, { recursive: true, force: true }).catch(err => {
        console.error('Failed to cleanup CI temp workspace:', err);
      });
    }
  },
  { connection: redisConnection }
);

console.log('[Queue Module] Redis connection established, CI runner Queue & Worker active.');
