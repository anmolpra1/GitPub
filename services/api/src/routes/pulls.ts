import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import pool from '../db';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';

const execAsync = promisify(exec);
const router = Router();

// Resolve root repos directory
const REPOS_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'repos');
const TEMP_DIR_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'scratch', 'temp-merges');

// Helper to run commands
async function runGit(cmd: string, repoPath: string) {
  try {
    const { stdout } = await execAsync(cmd, { cwd: repoPath });
    return stdout;
  } catch (error: any) {
    throw new Error(error.stdout || error.stderr || error.message);
  }
}

// POST /api/pulls - Create a new Pull Request
router.post('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { repoId, title, sourceBranch, targetBranch } = req.body;
  if (!repoId || !title || !sourceBranch || !targetBranch) {
    return res.status(400).json({ error: 'repoId, title, sourceBranch, and targetBranch are required' });
  }

  try {
    // Check if repo exists and user has access
    const repoResult = await pool.query('SELECT * FROM repositories WHERE id = $1', [repoId]);
    const repository = repoResult.rows[0];

    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    if (repository.is_private && repository.owner_id !== user.id) {
      return res.status(403).json({ error: 'Access denied to this repository' });
    }

    // Insert PR
    const result = await pool.query(
      `INSERT INTO pull_requests (repo_id, author_id, title, status, source_branch, target_branch) 
       VALUES ($1, $2, $3, 'open', $4, $5) 
       RETURNING *`,
      [repoId, user.id, title, sourceBranch, targetBranch]
    );

    res.status(201).json({
      message: 'Pull Request created successfully',
      pullRequest: result.rows[0]
    });
  } catch (error) {
    console.error('Create PR error:', error);
    res.status(500).json({ error: 'Failed to create Pull Request' });
  }
});

// GET /api/pulls - List Pull Requests for a repository
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { repoId } = req.query;

  if (!repoId) {
    return res.status(400).json({ error: 'repoId is required' });
  }

  try {
    const result = await pool.query(
      `SELECT pr.*, u.username as author_name 
       FROM pull_requests pr 
       JOIN users u ON pr.author_id = u.id 
       WHERE pr.repo_id = $1 
       ORDER BY pr.created_at DESC`,
      [repoId]
    );

    res.json({ pullRequests: result.rows });
  } catch (error) {
    console.error('List PRs error:', error);
    res.status(500).json({ error: 'Failed to retrieve Pull Requests' });
  }
});

// GET /api/pulls/:id/diff - Get PR diff output
router.get('/:id/diff', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const prId = req.params.id;

  try {
    // Get PR details along with repository info
    const prResult = await pool.query(
      `SELECT pr.*, r.name as repo_name, u.username as owner_name 
       FROM pull_requests pr 
       JOIN repositories r ON pr.repo_id = r.id 
       JOIN users u ON r.owner_id = u.id 
       WHERE pr.id = $1`,
      [prId]
    );
    const pr = prResult.rows[0];

    if (!pr) {
      return res.status(404).json({ error: 'Pull Request not found' });
    }

    const repoPath = path.join(REPOS_ROOT, pr.owner_name, `${pr.repo_name}.git`);

    // Verify repository path exists
    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: 'Repository files not found on disk' });
    }

    // Run git diff base...head
    // Since it's a bare repository, the branches are referenced as local branches
    const diffOutput = await runGit(`git diff "${pr.target_branch}...${pr.source_branch}"`, repoPath);
    
    res.json({ diff: diffOutput });
  } catch (error: any) {
    console.error('Fetch diff error:', error);
    res.status(500).json({ error: 'Failed to compute diff', details: error.message });
  }
});

// POST /api/pulls/:id/merge - Merge a PR
router.post('/:id/merge', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const prId = req.params.id;
  const user = req.user;

  try {
    const prResult = await pool.query(
      `SELECT pr.*, r.name as repo_name, r.owner_id, u.username as owner_name 
       FROM pull_requests pr 
       JOIN repositories r ON pr.repo_id = r.id 
       JOIN users u ON r.owner_id = u.id 
       WHERE pr.id = $1`,
      [prId]
    );
    const pr = prResult.rows[0];

    if (!pr) {
      return res.status(404).json({ error: 'Pull Request not found' });
    }

    if (pr.status !== 'open') {
      return res.status(400).json({ error: `Cannot merge a Pull Request in '${pr.status}' status` });
    }

    // Authorization: Only repo owner can merge (or PR author, depending on rules; here we restrict to repo owner)
    if (pr.owner_id !== user?.id) {
      return res.status(403).json({ error: 'Only the repository owner is authorized to merge this Pull Request' });
    }

    const repoPath = path.join(REPOS_ROOT, pr.owner_name, `${pr.repo_name}.git`);
    
    // Setup temporary clone path in scratch/temp-merges
    const tempDirName = `${pr.id}_${Date.now()}`;
    const tempPath = path.join(TEMP_DIR_ROOT, tempDirName);
    
    // Ensure temp parent exists
    await fs.promises.mkdir(TEMP_DIR_ROOT, { recursive: true });

    try {
      // 1. Clone the bare repo to a temporary local workspace
      await execAsync(`git clone "${repoPath}" "${tempPath}"`);

      // 2. Checkout target branch
      await execAsync(`git checkout "${pr.target_branch}"`, { cwd: tempPath });

      // 3. Merge the source branch
      // We merge origin/<source> because they might not be checked out locally in the clone
      await execAsync(
        `git merge "origin/${pr.source_branch}" -m "Merge pull request #${pr.id} from ${pr.source_branch} into ${pr.target_branch}"`, 
        { cwd: tempPath }
      );

      // 4. Push the merged branch back to the bare repository
      await execAsync(`git push origin "${pr.target_branch}"`, { cwd: tempPath });

      // 5. Update database status
      await pool.query(
        "UPDATE pull_requests SET status = 'merged', updated_at = NOW() WHERE id = $1",
        [pr.id]
      );

      res.json({ message: 'Pull Request merged successfully', status: 'merged' });
    } catch (mergeError: any) {
      console.error('Git merge operation failed:', mergeError);
      
      // Check if merge failed due to conflicts
      const isConflict = mergeError.message.includes('CONFLICT') || mergeError.message.includes('Merge conflict');
      res.status(409).json({ 
        error: 'Merge failed due to conflicts. Please resolve conflicts locally.',
        details: isConflict ? 'Merge conflicts detected' : mergeError.message 
      });
    } finally {
      // Cleanup temp directories in background
      fs.promises.rm(tempPath, { recursive: true, force: true }).catch(err => {
        console.error('Failed to cleanup temp merge directory:', err);
      });
    }
  } catch (error) {
    console.error('Merge PR database/operation error:', error);
    res.status(500).json({ error: 'Failed to process Pull Request merge' });
  }
});

export default router;
