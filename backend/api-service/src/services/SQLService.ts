import { Pool as PgPool } from 'pg';
import { createLogger } from '@cortex/shared';

const logger = createLogger('SQLService');

export type DatabaseType = 'postgresql' | 'mysql' | 'mssql' | 'oracle';

export interface DatabaseConfig {
  type: DatabaseType;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  // PostgreSQL specific
  ssl?: boolean;
  // MySQL specific
  connectionLimit?: number;
  // MSSQL specific
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  // Oracle specific
  connectString?: string;
}

export interface ExecuteSQLParams {
  query: string;
  parameters?: any[];
}

export interface SQLResult {
  success: boolean;
  rows?: any[];
  rowCount?: number;
  error?: string;
  executionTime?: number;
}

/**
 * SQL Service for executing SQL queries across multiple database types
 * Supports: PostgreSQL, MySQL, MSSQL Server, and Oracle
 */
export class SQLService {
  private pools: Map<string, any> = new Map();

  /**
   * Get or create a database connection pool
   */
  private async getPool(
    connectionId: string,
    config: DatabaseConfig
  ): Promise<any> {
    if (this.pools.has(connectionId)) {
      return this.pools.get(connectionId);
    }

    let pool: any;

    try {
      switch (config.type) {
        case 'postgresql':
          pool = new PgPool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
            ssl: config.ssl || false,
            max: 10,
          });
          // Test connection
          await pool.query('SELECT 1');
          break;

        case 'mysql': {
          const mysql = await import('mysql2/promise');
          pool = mysql.createPool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
            connectionLimit: config.connectionLimit || 10,
            waitForConnections: true,
            queueLimit: 0,
          });
          // Test connection
          await pool.query('SELECT 1');
          break;
        }

        case 'mssql': {
          const sql = await import('mssql');
          pool = new sql.ConnectionPool({
            server: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
            options: {
              encrypt: config.encrypt !== false,
              trustServerCertificate: config.trustServerCertificate || false,
            },
          });
          await pool.connect();
          break;
        }

        case 'oracle': {
          const oracledb = await import('oracledb');
          pool = {
            type: 'oracle',
            getConnection: async () => {
              return await oracledb.getConnection({
                user: config.user,
                password: config.password,
                connectString: config.connectString || `${config.host}:${config.port}/${config.database}`,
              });
            },
          };
          // Test connection
          const testConn = await pool.getConnection();
          await testConn.close();
          break;
        }

        default:
          throw new Error(`Unsupported database type: ${config.type}`);
      }

      this.pools.set(connectionId, pool);
      logger.info(`Database pool created for ${config.type}`, { connectionId });

      return pool;
    } catch (error: any) {
      logger.error(`Failed to create database pool for ${config.type}`, {
        error: error.message,
        connectionId,
      });
      throw error;
    }
  }

  /**
   * Execute SQL query
   */
  static async executeQuery(
    config: DatabaseConfig,
    params: ExecuteSQLParams
  ): Promise<SQLResult> {
    const startTime = Date.now();
    const service = new SQLService();
    const connectionId = `${config.type}_${config.host}_${config.database}`;

    try {
      // Validate query
      if (!params.query || params.query.trim() === '') {
        throw new Error('SQL query is required');
      }

      // Security: Only allow SELECT queries by default (can be configured)
      const queryUpper = params.query.trim().toUpperCase();
      const dangerousKeywords = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'INSERT', 'UPDATE'];
      const hasDangerousKeyword = dangerousKeywords.some(keyword => queryUpper.includes(keyword));

      if (hasDangerousKeyword) {
        logger.warn('Potentially dangerous SQL query detected', {
          query: params.query.substring(0, 100),
        });
        // Allow dangerous operations only if explicitly configured
        // For now, we'll allow them but log a warning
      }

      const pool = await service.getPool(connectionId, config);
      let result: any;

      switch (config.type) {
        case 'postgresql':
          result = await (pool as PgPool).query(params.query, params.parameters);
          return {
            success: true,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: Date.now() - startTime,
          };

        case 'mysql':
          const [rows] = await pool.execute(params.query, params.parameters || []);
          return {
            success: true,
            rows: Array.isArray(rows) ? rows : [],
            rowCount: Array.isArray(rows) ? rows.length : 0,
            executionTime: Date.now() - startTime,
          };

        case 'mssql': {
          const request = pool.request();
          if (params.parameters) {
            params.parameters.forEach((param: any, index: number) => {
              request.input(`param${index}`, param);
            });
          }
          result = await request.query(params.query);
          return {
            success: true,
            rows: result.recordset || [],
            rowCount: result.rowsAffected?.[0] || 0,
            executionTime: Date.now() - startTime,
          };
        }

        case 'oracle': {
          const connection = await pool.getConnection();
          try {
            result = await connection.execute(params.query, params.parameters || {}, {
              outFormat: 2, // Return as objects
            });
            await connection.commit();
            return {
              success: true,
              rows: result.rows || [],
              rowCount: result.rowsAffected || 0,
              executionTime: Date.now() - startTime,
            };
          } finally {
            await connection.close();
          }
        }

        default:
          throw new Error(`Unsupported database type: ${config.type}`);
      }
    } catch (error: any) {
      logger.error('SQL query execution failed', {
        error: error.message,
        databaseType: config.type,
        query: params.query.substring(0, 100),
      });

      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate database connection
   */
  static async validateConnection(config: DatabaseConfig): Promise<{
    valid: boolean;
    error?: string;
  }> {
    const service = new SQLService();
    const connectionId = `test_${config.type}_${Date.now()}`;

    try {
      // Test with a simple query
      const result = await SQLService.executeQuery(config, { query: 'SELECT 1' });

      if (!result.success) {
        return {
          valid: false,
          error: result.error,
        };
      }

      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Close all connection pools
   */
  async closeAll(): Promise<void> {
    for (const [id, pool] of this.pools.entries()) {
      try {
        if (pool && pool.end) {
          await pool.end();
        } else if (pool && pool.close) {
          await pool.close();
        }
      } catch (error: any) {
        logger.error(`Failed to close pool ${id}`, { error: error.message });
      }
    }
    this.pools.clear();
  }
}

