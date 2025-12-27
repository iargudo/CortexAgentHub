import { Pool, QueryResult, QueryResultRow } from 'pg';
import { getDatabase } from '../connection';
import { createLogger } from '@cortex/shared';

const logger = createLogger('BaseRepository');

/**
 * Base Repository
 * Provides common CRUD operations for all repositories
 */
export abstract class BaseRepository<T extends QueryResultRow> {
  protected pool: Pool;
  protected abstract tableName: string;

  constructor() {
    this.pool = getDatabase().getPool();
  }

  /**
   * Find record by ID
   */
  async findById(id: string): Promise<T | null> {
    try {
      const result = await this.pool.query<T>(
        `SELECT * FROM ${this.tableName} WHERE id = $1`,
        [id]
      );
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error(`Error finding ${this.tableName} by id`, {
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Find all records with optional filters
   */
  async findAll(
    filters?: Partial<T>,
    limit: number = 100,
    offset: number = 0
  ): Promise<T[]> {
    try {
      let query = `SELECT * FROM ${this.tableName}`;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters && Object.keys(filters).length > 0) {
        const conditions = Object.keys(filters).map((key) => {
          params.push(filters[key as keyof T]);
          return `${key} = $${paramIndex++}`;
        });
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await this.pool.query<T>(query, params);
      return result.rows;
    } catch (error: any) {
      logger.error(`Error finding all ${this.tableName}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create a new record
   */
  async create(data: Partial<T>): Promise<T> {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

      const query = `
        INSERT INTO ${this.tableName} (${keys.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;

      const result = await this.pool.query<T>(query, values);
      return result.rows[0];
    } catch (error: any) {
      logger.error(`Error creating ${this.tableName}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update a record by ID
   */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');

      const query = `
        UPDATE ${this.tableName}
        SET ${setClause}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await this.pool.query<T>(query, [id, ...values]);
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error(`Error updating ${this.tableName}`, {
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `DELETE FROM ${this.tableName} WHERE id = $1`,
        [id]
      );
      return (result.rowCount || 0) > 0;
    } catch (error: any) {
      logger.error(`Error deleting ${this.tableName}`, {
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Count total records
   */
  async count(filters?: Partial<T>): Promise<number> {
    try {
      let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters && Object.keys(filters).length > 0) {
        const conditions = Object.keys(filters).map((key) => {
          params.push(filters[key as keyof T]);
          return `${key} = $${paramIndex++}`;
        });
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      const result = await this.pool.query<{ count: string }>(query, params);
      return parseInt(result.rows[0].count);
    } catch (error: any) {
      logger.error(`Error counting ${this.tableName}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if record exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `SELECT 1 FROM ${this.tableName} WHERE id = $1 LIMIT 1`,
        [id]
      );
      return result.rows.length > 0;
    } catch (error: any) {
      logger.error(`Error checking existence in ${this.tableName}`, {
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Execute custom query
   */
  protected async query<R extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }
}
