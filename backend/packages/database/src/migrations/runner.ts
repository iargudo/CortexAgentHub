import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../connection';
import { createLogger } from '@cortex/shared';
import dotenv from 'dotenv';

dotenv.config();

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
   * Get pending migration files
   */
  private async getPendingMigrations(): Promise<string[]> {
    const migrationsDir = path.join(__dirname, '../../scripts');
    const sqlFile = 'init-db.sql';
    const sqlPath = path.join(migrationsDir, sqlFile);

    // Check if already executed
    const executed = await this.getExecutedMigrations();

    if (!executed.includes(sqlFile) && fs.existsSync(sqlPath)) {
      return [sqlPath];
    }

    return [];
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
  const command = process.argv[2] || 'run';

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
