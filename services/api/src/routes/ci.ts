import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import pool from '../db';
import { ciQueue } from '../queue';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';

const execAsync = promisify(exec);
const router = Router();

// Resolve root repos directory
const REPOS_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'repos');

// POST /api/ci/trigger - Trigger a new CI build
router.post('/trigger', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { repoId, branchOrCommit } = req.body; // e.g., branchOrCommit = 'main' or a full SHA
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
    } catch (gitErr) {
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

export default router;
