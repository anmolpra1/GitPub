import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://gitpub:devpass@localhost:5432/gitpub',
});

export default pool;
