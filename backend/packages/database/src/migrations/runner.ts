import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../connection';
import { createLogger } from '@cortex/shared';
import dotenv from 'dotenv';

// Load .env from package dir, then from repo root (monorepo)
dotenv.config();
const rootEnv = path.join(__dirname, '../../../../../.env');
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

const logger = createLogger('MigrationRunner');

/**
 * Migration Runner
 */
class MigrationRunner {
  private db = getDatabase();

  /**
   * Create migrations table if not exists
   */
  private async createMigrationsTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    logger.info('Migrations table created');
  }

  /**
   * Get executed migrations
   */
  private async getExecutedMigrations(): Promise<string[]> {
    const result = await this.db.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id'
    );
    return result.rows.map((row) => row.name);
  }

  /**
   * Mark migration as executed
   */
  private async markAsExecuted(name: string): Promise<void> {
    await this.db.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
  }

  /**
   * Get pending migration files from migrations/ folder (e.g. 001_*.sql, 002_*.sql).
   * Sorted by filename so order is deterministic.
   * Skips 001_initial_schema.sql if base schema already exists (orchestration_flows table).
   */
  private async getPendingMigrations(): Promise<string[]> {
    const migrationsDir = path.join(__dirname, '../../migrations');
    const executed = await this.getExecutedMigrations();

    if (!fs.existsSync(migrationsDir)) {
      logger.warn(`Migrations directory not found: ${migrationsDir}`);
      return [];
    }

    let skipInitial = false;
    if (!executed.includes('001_initial_schema.sql')) {
      try {
        const r = await this.db.query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orchestration_flows') as exists`
        );
        if (r.rows[0]?.exists) {
          skipInitial = true;
          logger.info('Base schema already present; skipping 001_initial_schema.sql');
          await this.markAsExecuted('001_initial_schema.sql');
        }
      } catch (e: any) {
        logger.debug('Could not check base schema', { error: e.message });
      }
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => path.join(migrationsDir, f));

    return files.filter((filePath) => {
      const name = path.basename(filePath);
      if (name === '001_initial_schema.sql' && skipInitial) return false;
      return !executed.includes(name);
    });
  }

  /**
   * Execute a migration file
   */
  private async executeMigration(filePath: string): Promise<void> {
    const name = path.basename(filePath);
    logger.info(`Executing migration: ${name}`);

    const sql = fs.readFileSync(filePath, 'utf-8');

    try {
      await this.db.query(sql);
      await this.markAsExecuted(name);
      logger.info(`Migration ${name} executed successfully`);
    } catch (error: any) {
      logger.error(`Migration ${name} failed`, { error: error.message });
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async run(): Promise<void> {
    try {
      logger.info('Starting migrations...');

      await this.createMigrationsTable();

      const pending = await this.getPendingMigrations();

      if (pending.length === 0) {
        logger.info('No pending migrations');
        return;
      }

      logger.info(`Found ${pending.length} pending migration(s)`);

      for (const migration of pending) {
        await this.executeMigration(migration);
      }

      logger.info('All migrations completed successfully');
    } catch (error: any) {
      logger.error('Migration failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Rollback last migration (not implemented yet)
   */
  async rollback(): Promise<void> {
    logger.warn('Rollback not implemented yet');
  }

  /**
   * Get migration status
   */
  async status(): Promise<void> {
    await this.createMigrationsTable();
    const executed = await this.getExecutedMigrations();
    const pending = await this.getPendingMigrations();

    logger.info('Migration Status:');
    logger.info(`Executed: ${executed.length}`);
    executed.forEach((name) => logger.info(`  ✓ ${name}`));

    logger.info(`Pending: ${pending.length}`);
    pending.forEach((file) =>
      logger.info(`  ○ ${path.basename(file)}`)
    );
  }
}

/**
 * CLI Entry point
 */
async function main() {
  const runner = new MigrationRunner();
  // pnpm run migrate -- status passes argv as [..., '--', 'status']; npm passes [..., 'status']
  const raw = process.argv[2];
  const command = (raw === '--' ? process.argv[3] : raw) || 'run';

  try {
    switch (command) {
      case 'run':
        await runner.run();
        break;
      case 'status':
        await runner.status();
        break;
      case 'rollback':
        await runner.rollback();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Available commands: run, status, rollback');
        process.exit(1);
    }

    await getDatabase().close();
    process.exit(0);
  } catch (error) {
    logger.error('Migration runner failed', { error });
    await getDatabase().close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { MigrationRunner };
