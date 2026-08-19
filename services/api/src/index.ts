import express from 'express';
import cors from 'cors';
import pool from './db';

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connectivity check
pool.query('SELECT NOW()', (err: Error | null, res: any) => {
  if (err) {
    console.error('Failed to connect to PostgreSQL database:', err.message);
  } else {
    console.log('Successfully connected to PostgreSQL database at:', res.rows[0].now);
  }
});

// Basic Health Check Route
app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW()');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: dbResult.rows[0].now
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Import and mount routers (to be implemented)
import authRouter from './routes/auth';
import reposRouter from './routes/repos';
import pullsRouter from './routes/pulls';
import ciRouter from './routes/ci';

app.use('/api/auth', authRouter);
app.use('/api/repos', reposRouter);
app.use('/api/pulls', pullsRouter);
app.use('/api/ci', ciRouter);

app.listen(port, () => {
  console.log(`GitPub REST API listening on http://localhost:${port}`);
});
