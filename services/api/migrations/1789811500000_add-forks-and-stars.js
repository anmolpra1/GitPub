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
  // 1. Add forked_from_id to repositories table
  pgm.addColumn('repositories', {
    forked_from_id: {
      type: 'integer',
      references: '"repositories"',
      onDelete: 'SET NULL',
      default: null,
    },
  });

  pgm.createIndex('repositories', 'forked_from_id', {
    name: 'idx_repositories_forked_from_id',
    ifNotExists: true,
  });

  // 2. Create repo_stars table
  pgm.createTable('repo_stars', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: '"users"',
      onDelete: 'cascade',
    },
    repo_id: {
      type: 'integer',
      notNull: true,
      references: '"repositories"',
      onDelete: 'cascade',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addConstraint('repo_stars', 'unique_user_repo_star', {
    unique: ['user_id', 'repo_id'],
  });

  pgm.createIndex('repo_stars', 'repo_id', {
    name: 'idx_repo_stars_repo_id',
    ifNotExists: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('repo_stars');
  pgm.dropIndex('repositories', 'forked_from_id', {
    name: 'idx_repositories_forked_from_id',
    ifExists: true,
  });
  pgm.dropColumn('repositories', 'forked_from_id');
};
