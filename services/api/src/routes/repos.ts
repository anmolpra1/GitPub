import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from '../db';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';

const execAsync = promisify(exec);
const router = Router();

// Resolve root repos directory (configurable via REPOS_ROOT)
const REPOS_ROOT = process.env.REPOS_ROOT 
  ? path.resolve(process.env.REPOS_ROOT) 
  : path.resolve(__dirname, '..', '..', '..', '..', 'data', 'repos');

function sanitizeRef(ref?: string): string {
  if (!ref || ref === 'HEAD') return 'HEAD';
  const cleaned = ref.replace(/[^a-zA-Z0-9/_\-\.]/g, '');
  if (!cleaned || cleaned.startsWith('-') || cleaned.includes('..')) {
    return 'HEAD';
  }
  return cleaned;
}

function sanitizeFilePath(filePath?: string): string {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

// POST /api/repos - Create a new repository
router.post('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, is_private } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Repository name is required' });
  }

  // Validate name (alphanumeric, dashes, underscores)
  const nameRegex = /^[a-zA-Z0-9-_]+$/;
  if (!nameRegex.test(name)) {
    return res.status(400).json({ error: 'Repository name can only contain alphanumeric characters, dashes, and underscores' });
  }

  try {
    // 1. Insert repository record into the database
    const dbResult = await pool.query(
      'INSERT INTO repositories (owner_id, name, is_private) VALUES ($1, $2, $3) RETURNING *',
      [user.id, name, is_private || false]
    );

    const repo = dbResult.rows[0];

    // 2. Initialize bare repository on disk
    const repoPath = path.join(REPOS_ROOT, user.username, `${name}.git`);
    
    // Ensure the owner's directory exists
    await fs.promises.mkdir(path.dirname(repoPath), { recursive: true });

    // Execute git init --bare
    await execAsync(`git init --bare "${repoPath}"`);

    const gatewayUrl = (process.env.GATEWAY_URL || 'http://localhost:8081').replace(/\/$/, '');
    res.status(201).json({
      message: 'Repository created successfully',
      repository: repo,
      cloneUrl: `${gatewayUrl}/${user.username}/${name}.git`
    });
  } catch (error: any) {
    if (error.code === '23505') { // Unique constraint violation (owner_id, name)
      return res.status(409).json({ error: 'A repository with this name already exists for your account' });
    }
    console.error('Repository creation error:', error);
    res.status(500).json({ error: 'Internal server error during repository creation' });
  }
});

// GET /api/repos - List user's repositories
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE r.owner_id = $1 OR r.is_private = false
       ORDER BY r.created_at DESC`,
      [user.id]
    );

    res.json({ repositories: result.rows });
  } catch (error) {
    console.error('List repositories error:', error);
    res.status(500).json({ error: 'Failed to retrieve repositories' });
  }
});

// GET /api/repos/verify-git-auth - Authenticate Git clients (username + password/PAT)
router.post('/verify-git-auth', async (req, res) => {
  const { username, password, owner, repo, action } = req.body;

  if (!owner || !repo || !action) {
    return res.status(400).json({ error: 'Missing owner, repo, or action parameters' });
  }

  try {
    const repoResult = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE u.username = $1 AND r.name = $2`,
      [owner, repo.replace('.git', '')]
    );
    const repository = repoResult.rows[0];

    if (!repository) {
      return res.status(404).json({ authenticated: false, authorized: false, error: 'Repository not found' });
    }

    if (!username || !password) {
      if (action === 'pull') {
        if (!repository.is_private) {
          return res.json({ authenticated: false, authorized: true });
        } else {
          return res.status(401).json({ authenticated: false, authorized: false, error: 'Authentication required: Repository is private' });
        }
      } else {
        return res.status(401).json({ authenticated: false, authorized: false, error: 'Authentication required: Push denied' });
      }
    }

    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userResult.rows[0];

    if (!user || !user.pat_hash) {
      return res.status(401).json({ authenticated: false, authorized: false, error: 'Invalid username or token' });
    }

    const incomingPatHash = crypto.createHash('sha256').update(password).digest('hex');
    if (incomingPatHash !== user.pat_hash) {
      return res.status(401).json({ authenticated: false, authorized: false, error: 'Invalid username or token' });
    }

    const isOwner = repository.owner_id === user.id;

    if (action === 'push') {
      if (!isOwner) {
        return res.status(403).json({ authenticated: true, authorized: false, error: 'Push denied: You do not own this repository' });
      }
    } else if (action === 'pull') {
      if (repository.is_private && !isOwner) {
        return res.status(403).json({ authenticated: true, authorized: false, error: 'Pull denied: Repository is private' });
      }
    }

    res.json({ authenticated: true, authorized: true, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error('Verify git auth error:', error);
    res.status(500).json({ error: 'Internal server error verifying credentials' });
  }
});

// GET /api/repos/:owner/:repo - Get single repository details
router.get('/:owner/:repo', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  const owner = req.params.owner as string;
  const repoName = (req.params.repo as string).replace(/\.git$/, '');

  try {
    const result = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE u.username = $1 AND r.name = $2`,
      [owner, repoName]
    );

    const repository = result.rows[0];
    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    if (repository.is_private && repository.owner_id !== user?.id) {
      return res.status(403).json({ error: 'Access denied: Repository is private' });
    }

    const gatewayUrl = (process.env.GATEWAY_URL || 'http://localhost:8081').replace(/\/$/, '');
    res.json({
      repository,
      cloneUrl: `${gatewayUrl}/${repository.owner_name}/${repository.name}.git`,
      isOwner: user?.id === repository.owner_id
    });
  } catch (error) {
    console.error('Get repo error:', error);
    res.status(500).json({ error: 'Failed to retrieve repository' });
  }
});

// GET /api/repos/:owner/:repo/branches - List all branches in the repository
router.get('/:owner/:repo/branches', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const owner = req.params.owner as string;
  const repo = (req.params.repo as string).replace(/\.git$/, '');
  const repoPath = path.join(REPOS_ROOT, owner, `${repo}.git`);

  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'Repository not found on disk' });
  }

  try {
    const { stdout } = await execAsync('git for-each-ref --format="%(refname:short)" refs/heads/', { cwd: repoPath });
    const branches = stdout.trim() ? stdout.trim().split('\n').map((b) => b.trim()).filter(Boolean) : [];
    
    // Identify default branch (usually main or master)
    let defaultBranch = 'main';
    try {
      const headSymref = await execAsync('git symbolic-ref --short HEAD', { cwd: repoPath });
      if (headSymref.stdout.trim()) {
        defaultBranch = headSymref.stdout.trim();
      }
    } catch {
      if (branches.length > 0) defaultBranch = branches[0];
    }

    res.json({ branches, defaultBranch });
  } catch (error: any) {
    console.error('Error listing branches:', error);
    res.status(500).json({ error: 'Failed to read branches' });
  }
});

// GET /api/repos/:owner/:repo/files - Get files in bare repository
router.get('/:owner/:repo/files', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const owner = req.params.owner as string;
  const repo = (req.params.repo as string).replace(/\.git$/, '');
  const ref = sanitizeRef(req.query.ref as string);
  const repoPath = path.join(REPOS_ROOT, owner, `${repo}.git`);

  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'Repository not found' });
  }

  try {
    const { stdout } = await execAsync(`git ls-tree -r --name-only "${ref}"`, { cwd: repoPath });
    const files = stdout.trim() ? stdout.trim().split('\n') : [];
    res.json({ files, ref });
  } catch (error: any) {
    if (error.message.includes('Not a valid object name') || error.message.includes('fatal: Not a valid object name')) {
      return res.json({ files: [], isEmpty: true, ref });
    }
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to read repository files' });
  }
});

// GET /api/repos/:owner/:repo/file-content - Get content of a specific file
router.get('/:owner/:repo/file-content', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const owner = req.params.owner as string;
  const repo = (req.params.repo as string).replace(/\.git$/, '');
  const filePath = sanitizeFilePath(req.query.path as string);
  const ref = sanitizeRef(req.query.ref as string);
  
  if (!filePath) {
    return res.status(400).json({ error: 'File path parameter is required' });
  }

  const repoPath = path.join(REPOS_ROOT, owner, `${repo}.git`);

  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'Repository not found' });
  }

  try {
    const { stdout } = await execAsync(`git show "${ref}:${filePath}"`, { cwd: repoPath });
    res.json({ content: stdout, ref, path: filePath });
  } catch (error: any) {
    console.error('Error reading file content:', error);
    res.status(500).json({ error: 'Failed to read file content' });
  }
});

// GET /api/repos/:owner/:repo/commits - Fetch commit history
router.get('/:owner/:repo/commits', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const owner = req.params.owner as string;
  const repo = (req.params.repo as string).replace(/\.git$/, '');
  const ref = sanitizeRef(req.query.ref as string);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 100);
  const repoPath = path.join(REPOS_ROOT, owner, `${repo}.git`);

  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'Repository not found' });
  }

  try {
    const delimiter = '---COMMIT_DELIMITER---';
    const { stdout } = await execAsync(
      `git log -n ${limit} --format="%H|%h|%an|%ae|%aI|%s${delimiter}" "${ref}"`,
      { cwd: repoPath }
    );

    const commits = stdout
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, shortHash, authorName, authorEmail, date, ...subjectParts] = entry.split('|');
        return {
          hash,
          shortHash,
          authorName,
          authorEmail,
          date,
          message: subjectParts.join('|'),
        };
      });

    res.json({ commits, ref });
  } catch (error: any) {
    if (error.message.includes('does not have any commits') || error.message.includes('unknown revision')) {
      return res.json({ commits: [], isEmpty: true, ref });
    }
    console.error('Error reading commit history:', error);
    res.status(500).json({ error: 'Failed to read commit history' });
  }
});

// PATCH /api/repos/:owner/:repo - Update repository visibility
router.patch('/:owner/:repo', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  const owner = req.params.owner as string;
  const repo = (req.params.repo as string).replace(/\.git$/, '');
  const { is_private } = req.body;

  if (typeof is_private !== 'boolean') {
    return res.status(400).json({ error: 'is_private boolean field is required' });
  }

  try {
    const repoResult = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    const repository = repoResult.rows[0];

    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    if (repository.owner_id !== user?.id) {
      return res.status(403).json({ error: 'Only the repository owner can modify settings' });
    }

    const updated = await pool.query(
      'UPDATE repositories SET is_private = $1 WHERE id = $2 RETURNING *',
      [is_private, repository.id]
    );

    res.json({ message: 'Repository updated successfully', repository: updated.rows[0] });
  } catch (error) {
    console.error('Update repository error:', error);
    res.status(500).json({ error: 'Failed to update repository settings' });
  }
});

// DELETE /api/repos/:owner/:repo - Delete repository
router.delete('/:owner/:repo', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  const owner = req.params.owner as string;
  const repo = (req.params.repo as string).replace(/\.git$/, '');

  try {
    const repoResult = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    const repository = repoResult.rows[0];

    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    if (repository.owner_id !== user?.id) {
      return res.status(403).json({ error: 'Only the repository owner can delete this repository' });
    }

    // 1. Delete from database (cascades to PRs, CI runs)
    await pool.query('DELETE FROM repositories WHERE id = $1', [repository.id]);

    // 2. Remove bare git repository from disk
    const repoPath = path.join(REPOS_ROOT, owner, `${repo}.git`);
    if (fs.existsSync(repoPath)) {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
    }

    res.json({ message: `Repository ${owner}/${repo} deleted successfully` });
  } catch (error) {
    console.error('Delete repository error:', error);
    res.status(500).json({ error: 'Failed to delete repository' });
  }
});

export default router;
