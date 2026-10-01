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
  pgm.createTable('pr_comments', {
    id: 'id',
    pr_id: {
      type: 'integer',
      notNull: true,
      references: '"pull_requests"',
      onDelete: 'cascade',
    },
    author_id: {
      type: 'integer',
      notNull: true,
      references: '"users"',
      onDelete: 'cascade',
    },
    body: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex(
    'pr_comments',
    [
      'pr_id',
      { name: 'created_at', sort: 'ASC' }
    ],
    {
      name: 'idx_pr_comments_pr_id_created_at_asc',
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
  pgm.dropTable('pr_comments');
};
