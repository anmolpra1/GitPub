declare module 'node-pg-migrate' {
  export interface RunMigration {
    path: string;
    name: string;
    timestamp: number;
  }

  export interface RunnerOption {
    databaseUrl: string | object;
    dir: string;
    direction: 'up' | 'down';
    migrationsTable?: string;
    verbose?: boolean;
    count?: number;
    file?: string;
    dryRun?: boolean;
    fake?: boolean;
    singleTransaction?: boolean;
    noLock?: boolean;
    schema?: string;
  }

  export function runner(options: RunnerOption): Promise<RunMigration[]>;
}
