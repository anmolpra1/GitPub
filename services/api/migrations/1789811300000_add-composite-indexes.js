/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Composite index on pull_requests(repo_id, created_at DESC)
  pgm.createIndex(
    'pull_requests',
    [
      'repo_id',
      { name: 'created_at', sort: 'DESC' },
    ],
    {
      name: 'idx_pull_requests_repo_id_created_at_desc',
      ifNotExists: true,
    }
  );

  // Composite index on ci_runs(repo_id, created_at DESC)
  pgm.createIndex(
    'ci_runs',
    [
      'repo_id',
      { name: 'created_at', sort: 'DESC' },
    ],
    {
      name: 'idx_ci_runs_repo_id_created_at_desc',
      ifNotExists: true,
    }
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex(
    'ci_runs',
    [
      'repo_id',
      { name: 'created_at', sort: 'DESC' },
    ],
    {
      name: 'idx_ci_runs_repo_id_created_at_desc',
      ifExists: true,
    }
  );

  pgm.dropIndex(
    'pull_requests',
    [
      'repo_id',
      { name: 'created_at', sort: 'DESC' },
    ],
    {
      name: 'idx_pull_requests_repo_id_created_at_desc',
      ifExists: true,
    }
  );
};
