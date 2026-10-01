import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import pool from '../db';
import { ciQueue, ciLogEvents } from '../queue';
import { authenticateJWT, AuthenticatedRequest, JWT_SECRET } from '../middleware/auth';

const execAsync = promisify(exec);
const router = Router();

// Resolve root repos directory (configurable via REPOS_ROOT)
const REPOS_ROOT = process.env.REPOS_ROOT 
  ? path.resolve(process.env.REPOS_ROOT) 
  : path.resolve(__dirname, '..', '..', '..', '..', 'data', 'repos');

// POST /api/ci/trigger - Trigger a new CI build
router.post('/trigger', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { repoId, branchOrCommit } = req.body;
  if (!repoId || !branchOrCommit) {
    return res.status(400).json({ error: 'repoId and branchOrCommit are required' });
  }

  try {
    // 1. Get repository metadata
    const repoResult = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE r.id = $1`,
      [repoId]
    );
    const repository = repoResult.rows[0];

    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    if (repository.is_private && repository.owner_id !== user.id) {
      return res.status(403).json({ error: 'Access denied to this repository' });
    }

    const repoPath = path.join(REPOS_ROOT, repository.owner_name, `${repository.name}.git`);
    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: 'Repository files not found on disk' });
    }

    // 2. Resolve branch/tag/ref to a full commit SHA using git rev-parse
    let commitHash: string;
    try {
      const { stdout } = await execAsync(`git rev-parse "${branchOrCommit}"`, { cwd: repoPath });
      commitHash = stdout.trim();
    } catch {
      return res.status(400).json({ error: `Could not resolve reference '${branchOrCommit}' in Git repository` });
    }

    // 3. Create pending entry in database
    const dbResult = await pool.query(
      `INSERT INTO ci_runs (repo_id, commit_hash, status, log) 
       VALUES ($1, $2, 'pending', '') 
       RETURNING *`,
      [repoId, commitHash]
    );
    const ciRun = dbResult.rows[0];

    // 4. Enqueue the CI job into BullMQ
    await ciQueue.add('run', {
      runId: ciRun.id,
      repoPath,
      commitHash
    });

    res.status(201).json({
      message: 'CI job triggered and enqueued successfully',
      ciRun
    });
  } catch (error) {
    console.error('Trigger CI error:', error);
    res.status(500).json({ error: 'Failed to trigger CI pipeline' });
  }
});

// GET /api/ci - Get list of CI runs for a repository
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { repoId } = req.query;

  if (!repoId) {
    return res.status(400).json({ error: 'repoId is required' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM ci_runs 
       WHERE repo_id = $1 
       ORDER BY created_at DESC`,
      [repoId]
    );

    res.json({ ciRuns: result.rows });
  } catch (error) {
    console.error('List CI runs error:', error);
    res.status(500).json({ error: 'Failed to retrieve CI runs' });
  }
});

// GET /api/ci/:id - Fetch details and log output of a single CI run
router.get('/:id', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT cr.*, r.name as repo_name, u.username as owner_name 
       FROM ci_runs cr 
       JOIN repositories r ON cr.repo_id = r.id 
       JOIN users u ON r.owner_id = u.id 
       WHERE cr.id = $1`,
      [runId]
    );

    const run = result.rows[0];
    if (!run) {
      return res.status(404).json({ error: 'CI Run not found' });
    }

    res.json({ ciRun: run });
  } catch (error) {
    console.error('Get CI run error:', error);
    res.status(500).json({ error: 'Failed to fetch CI run details' });
  }
});

// GET /api/ci/:id/stream - Server-Sent Events (SSE) live log streaming
router.get('/:id/stream', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Access token required' });
  }

  let user: any;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const runId = parseInt(idParam as string, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ error: 'Invalid CI Run ID' });
  }

  try {
    const runResult = await pool.query(
      `SELECT cr.*, r.is_private, r.owner_id 
       FROM ci_runs cr 
       JOIN repositories r ON cr.repo_id = r.id 
       WHERE cr.id = $1`,
      [runId]
    );

    const run = runResult.rows[0];
    if (!run) {
      return res.status(404).json({ error: 'CI Run not found' });
    }

    if (run.is_private && run.owner_id !== user.id) {
      return res.status(403).json({ error: 'Access denied: Repository is private' });
    }

    // Configure SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial snapshot
    res.write(`data: ${JSON.stringify({ chunk: run.log || '', status: run.status, initial: true })}\n\n`);

    if (run.status === 'success' || run.status === 'failed') {
      res.write(`data: ${JSON.stringify({ finished: true, status: run.status })}\n\n`);
      res.end();
      return;
    }

    const onLog = (data: { chunk?: string; status?: string; finished?: boolean }) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (data.finished) {
        cleanup();
        res.end();
      }
    };

    const onFinish = (data: { status: string; finished: boolean }) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      cleanup();
      res.end();
    };

    const cleanup = () => {
      ciLogEvents.off(`log:${runId}`, onLog);
      ciLogEvents.off(`finish:${runId}`, onFinish);
    };

    ciLogEvents.on(`log:${runId}`, onLog);
    ciLogEvents.on(`finish:${runId}`, onFinish);

    req.on('close', cleanup);
  } catch (error) {
    console.error('SSE CI stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initialize SSE stream' });
    }
  }
});

// POST /api/ci/internal/on-push - Internal hook triggered by Protocol Gateway on successful push
router.post('/internal/on-push', async (req: Request, res: Response) => {
  const { owner, repo } = req.body;
  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner and repo are required' });
  }

  const cleanRepoName = repo.replace(/\.git$/, '');
  const repoPath = path.join(REPOS_ROOT, owner, `${cleanRepoName}.git`);

  try {
    // 1. Resolve repository in database
    const repoResult = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE u.username = $1 AND r.name = $2`,
      [owner, cleanRepoName]
    );
    const repository = repoResult.rows[0];
    if (!repository) {
      return res.status(404).json({ error: 'Repository not found in DB' });
    }

    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: 'Repository files not found on disk' });
    }

    // 2. Identify the latest pushed commit hash and branch name
    const { stdout } = await execAsync(
      `git for-each-ref --sort=-committerdate --count=1 --format="%(objectname) %(refname:short)" refs/heads/`,
      { cwd: repoPath }
    );
    const [commitHash, branchName] = stdout.trim().split(' ');
    if (!commitHash) {
      return res.status(400).json({ error: 'No commits found in repository' });
    }

    // 3. Check if .gitpub-ci.yml exists for this commit
    try {
      await execAsync(`git show "${commitHash}:.gitpub-ci.yml"`, { cwd: repoPath });
    } catch {
      console.log(`[CI Trigger] Commit ${commitHash} on ${owner}/${cleanRepoName} has no .gitpub-ci.yml. Skipping CI.`);
      return res.json({ message: 'No .gitpub-ci.yml found; CI skipped', skipped: true });
    }

    // 4. Create pending CI run record
    const dbResult = await pool.query(
      `INSERT INTO ci_runs (repo_id, commit_hash, status, log) 
       VALUES ($1, $2, 'pending', '') 
       RETURNING *`,
      [repository.id, commitHash]
    );
    const ciRun = dbResult.rows[0];

    // 5. Enqueue into BullMQ
    await ciQueue.add('run', {
      runId: ciRun.id,
      repoPath,
      commitHash,
      branchName
    });

    console.log(`[CI Trigger] Auto-queued CI Run #${ciRun.id} for commit ${commitHash} (${owner}/${cleanRepoName})`);
    res.status(201).json({
      message: 'Automatic CI run queued',
      ciRun
    });
  } catch (err: any) {
    console.error('Error in on-push hook:', err);
    res.status(500).json({ error: err.message || 'Internal error processing push hook' });
  }
});

export default router;
