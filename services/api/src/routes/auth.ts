import { Router, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../db';
import { authenticateJWT, AuthenticatedRequest, JWT_SECRET } from '../middleware/auth';

const router = Router();

// Register Route
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  try {
    // Hash password with Argon2
    const passwordHash = await argon2.hash(password);

    // Insert user into PostgreSQL
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, passwordHash]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (error: any) {
    if (error.code === '23505') { // Unique constraint violation (username or email)
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Retrieve user from DB
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password with Argon2
    const isPasswordValid = await argon2.verify(user.password_hash, password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create Personal Access Token (PAT)
router.post('/pat', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Generate a secure random token
    const rawPat = 'gp_pat_' + crypto.randomBytes(24).toString('hex');

    // Create SHA-256 hash of the token
    const patHash = crypto.createHash('sha256').update(rawPat).digest('hex');

    // Store only the SHA-256 hash in the users table
    await pool.query('UPDATE users SET pat_hash = $1 WHERE id = $2', [patHash, user.id]);

    // Send the raw token back to the user (only displayed once!)
    res.json({
      message: 'Personal Access Token created successfully. Save it now, you will not be able to see it again!',
      pat: rawPat
    });
  } catch (error) {
    console.error('Error generating PAT:', error);
    res.status(500).json({ error: 'Failed to generate Personal Access Token' });
  }
});

export default router;
