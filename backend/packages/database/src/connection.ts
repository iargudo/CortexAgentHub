import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { createLogger } from '@cortex/shared';

const logger = createLogger('DatabaseConnection');

/**
 * Database Connection Manager
 */
export class DatabaseConnection {
  private pool: Pool;
  private static instance: DatabaseConnection;

  private constructor(config?: PoolConfig) {
    const poolConfig: PoolConfig = config || {
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'),
    };

    this.pool = new Pool(poolConfig);

    // Handle pool errors
    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });

    // Handle pool connection
    this.pool.on('connect', () => {
      logger.debug('New database connection established');
    });

    logger.info('Database connection pool created', {
      max: poolConfig.max,
      database: this.getDatabaseName(poolConfig.connectionString || ''),
    });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: PoolConfig): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection(config);
    }
    return DatabaseConnection.instance;
  }

  /**
   * Get pool instance
   */
  public getPool(): Pool {
    return this.pool;
  }

  /**
   * Execute a query
   */
  public async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;

      logger.debug('Query executed', {
        text: text.substring(0, 100),
        duration,
        rows: result.rowCount,
      });

      return result;
    } catch (error: any) {
      logger.error('Query execution failed', {
        text: text.substring(0, 100),
        error: error.message,
        params,
      });
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  public async transaction<T>(
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check database health
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW() as now');
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
    }
  }

  /**
   * Get pool statistics
   */
  public getStats() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Close all connections
   */
  public async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }

  /**
   * Extract database name from connection string
   */
  private getDatabaseName(connectionString: string): string {
    try {
      const match = connectionString.match(/\/([^/?]+)(\?|$)/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

/**
 * Get database instance (shorthand)
 */
export const getDatabase = () => DatabaseConnection.getInstance();
