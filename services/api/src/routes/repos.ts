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

// Resolve root repos directory (D:\GITPUB\data\repos)
const REPOS_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'repos');

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
    // Path: D:\GITPUB\data\repos\<username>\<repo_name>.git
    const repoPath = path.join(REPOS_ROOT, user.username, `${name}.git`);
    
    // Ensure the owner's directory exists
    await fs.promises.mkdir(path.dirname(repoPath), { recursive: true });

    // Execute git init --bare
    await execAsync(`git init --bare "${repoPath}"`);

    res.status(201).json({
      message: 'Repository created successfully',
      repository: repo,
      cloneUrl: `http://localhost:8081/${user.username}/${name}.git`
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
// This is typically called by the gateway to verify authorization
router.post('/verify-git-auth', async (req, res) => {
  const { username, password, owner, repo, action } = req.body; // action: 'push' or 'pull'

  if (!username || !password || !owner || !repo || !action) {
    return res.status(400).json({ error: 'Missing authentication parameters' });
  }

  try {
    // 1. Authenticate user using username and PAT
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userResult.rows[0];

    if (!user || !user.pat_hash) {
      return res.status(401).json({ authenticated: false, error: 'Invalid username or token' });
    }

    // Hash incoming password (PAT) with SHA-256 and compare
    const incomingPatHash = crypto.createHash('sha256').update(password).digest('hex');
    if (incomingPatHash !== user.pat_hash) {
      return res.status(401).json({ authenticated: false, error: 'Invalid username or token' });
    }

    // 2. Authorize repository access
    // Fetch repository
    const repoResult = await pool.query(
      `SELECT r.*, u.username as owner_name 
       FROM repositories r 
       JOIN users u ON r.owner_id = u.id 
       WHERE u.username = $1 AND r.name = $2`,
      [owner, repo.replace('.git', '')]
    );
    const repository = repoResult.rows[0];

    if (!repository) {
      return res.status(404).json({ authenticated: false, error: 'Repository not found' });
    }

    // Access check:
    // - Private repo: Must be the owner (in basic model)
    // - Public repo: Anyone can pull, only owner can push
    const isOwner = repository.owner_id === user.id;

    if (action === 'push') {
      if (!isOwner) {
        return res.status(403).json({ authenticated: false, authorized: false, error: 'Push denied: You do not own this repository' });
      }
    } else if (action === 'pull') {
      if (repository.is_private && !isOwner) {
        return res.status(403).json({ authenticated: false, authorized: false, error: 'Pull denied: Repository is private' });
      }
    }

    res.json({ authenticated: true, authorized: true, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error('Verify git auth error:', error);
    res.status(500).json({ error: 'Internal server error verifying credentials' });
  }
});

// GET /api/repos/:owner/:repo/files - Get files in bare repository
router.get('/:owner/:repo/files', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const owner = req.params.owner as string;
  const repo = req.params.repo as string;
  const repoName = repo.endsWith('.git') ? repo : `${repo}.git`;
  const repoPath = path.join(REPOS_ROOT, owner, repoName);

  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'Repository not found' });
  }

  try {
    // Run git ls-tree -r --name-only HEAD to list all tracked files
    const { stdout } = await execAsync('git ls-tree -r --name-only HEAD', { cwd: repoPath });
    const files = stdout.trim() ? stdout.trim().split('\n') : [];
    res.json({ files });
  } catch (error: any) {
    // If the repository is empty (no commits yet), git ls-tree fails
    if (error.message.includes('Not a valid object name HEAD')) {
      return res.json({ files: [], isEmpty: true });
    }
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to read repository files' });
  }
});

// GET /api/repos/:owner/:repo/file-content - Get content of a specific file
router.get('/:owner/:repo/file-content', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const owner = req.params.owner as string;
  const repo = req.params.repo as string;
  const filePath = req.query.path as string;
  
  if (!filePath) {
    return res.status(400).json({ error: 'File path parameter is required' });
  }

  const repoName = repo.endsWith('.git') ? repo : `${repo}.git`;
  const repoPath = path.join(REPOS_ROOT, owner, repoName);

  if (!fs.existsSync(repoPath)) {
    return res.status(404).json({ error: 'Repository not found' });
  }

  try {
    // Run git show HEAD:path to retrieve file content
    const { stdout } = await execAsync(`git show "HEAD:${filePath}"`, { cwd: repoPath });
    res.json({ content: stdout });
  } catch (error: any) {
    console.error('Error reading file content:', error);
    res.status(500).json({ error: 'Failed to read file content' });
  }
});

export default router;

