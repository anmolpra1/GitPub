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
  pgm.createTable('users', {
    id: 'id',
    username: { type: 'varchar(50)', notNull: true, unique: true },
    email: { type: 'varchar(100)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('repositories', {
    id: 'id',
    owner_id: {
      type: 'integer',
      notNull: true,
      references: '"users"',
      onDelete: 'cascade',
    },
    name: { type: 'varchar(100)', notNull: true },
    is_private: { type: 'boolean', notNull: true, default: false },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  pgm.addConstraint('repositories', 'unique_owner_repo_name', {
    unique: ['owner_id', 'name'],
  });

  pgm.createTable('pull_requests', {
    id: 'id',
    repo_id: {
      type: 'integer',
      notNull: true,
      references: '"repositories"',
      onDelete: 'cascade',
    },
    author_id: {
      type: 'integer',
      notNull: true,
      references: '"users"',
      onDelete: 'cascade',
    },
    title: { type: 'varchar(255)', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'open' },
    source_branch: { type: 'varchar(100)', notNull: true },
    target_branch: { type: 'varchar(100)', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('ci_runs', {
    id: 'id',
    repo_id: {
      type: 'integer',
      notNull: true,
      references: '"repositories"',
      onDelete: 'cascade',
    },
    commit_hash: { type: 'varchar(40)', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    log: { type: 'text' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    finished_at: { type: 'timestamp' },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('ci_runs');
  pgm.dropTable('pull_requests');
  pgm.dropTable('repositories');
  pgm.dropTable('users');
};

