import path from 'path';
import { runner } from 'node-pg-migrate';

/**
 * Validates and executes any pending database migrations.
 * Safe to run on every API startup (uses pgmigrations table and advisory locks).
 */
export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://gitpub:devpass@localhost:5432/gitpub';
  const migrationsDir = path.resolve(__dirname, '../../migrations');

  console.log('[Database] Checking and executing pending migrations...');
  try {
    const appliedMigrations = await runner({
      databaseUrl,
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      verbose: false,
    });

    if (appliedMigrations && appliedMigrations.length > 0) {
      console.log(
        `[Database] Successfully applied ${appliedMigrations.length} migration(s):`,
        appliedMigrations.map((m: any) => m.name).join(', ')
      );
    } else {
      console.log('[Database] Schema is up to date.');
    }
  } catch (error: any) {
    console.error('[Database] Migration failed on startup:', error.message);
    throw error;
  }
}
