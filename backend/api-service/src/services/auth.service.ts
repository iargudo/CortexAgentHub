import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { AppError, createLogger } from '@cortex/shared';

const logger = createLogger('AuthService');

export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  full_name?: string;
  is_active: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAdminUserInput {
  username: string;
  password: string;
  email?: string;
  full_name?: string;
  created_by?: string;
}

export interface UpdateAdminUserInput {
  username?: string;
  password?: string;
  email?: string;
  full_name?: string;
  is_active?: boolean;
}

/**
 * Authentication Service
 * Handles admin user authentication and password management
 */
export class AuthService {
  private readonly SALT_ROUNDS = 10;

  constructor(private db: Pool) {}

  /**
   * Hash a password using bcrypt
   */
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify a password against a hash
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Authenticate a user by username and password
   */
  async authenticate(username: string, password: string): Promise<AdminUser | null> {
    try {
      const result = await this.db.query(
        `SELECT id, username, password_hash, email, full_name, is_active, last_login, created_at, updated_at
         FROM admin_users
         WHERE username = $1 AND is_active = true`,
        [username]
      );

      if (result.rows.length === 0) {
        logger.warn('Authentication failed: user not found', { username });
        return null;
      }

      const user = result.rows[0];
      const isValid = await this.verifyPassword(password, user.password_hash);

      if (!isValid) {
        logger.warn('Authentication failed: invalid password', { username });
        return null;
      }

      // Update last login
      await this.db.query(
        'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );

      logger.info('User authenticated successfully', { username, userId: user.id });

      // Return user without password_hash
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active,
        last_login: user.last_login ? new Date(user.last_login) : undefined,
        created_at: new Date(user.created_at),
        updated_at: new Date(user.updated_at),
      };
    } catch (error: any) {
      logger.error('Authentication error', { error: error.message, username });
      throw new AppError('AUTH_ERROR', `Authentication failed: ${error.message}`, 500);
    }
  }

  /**
   * Create a new admin user
   */
  async createUser(input: CreateAdminUserInput): Promise<AdminUser> {
    try {
      // Check if username already exists
      const existingUser = await this.db.query(
        'SELECT id FROM admin_users WHERE username = $1',
        [input.username]
      );

      if (existingUser.rows.length > 0) {
        throw new AppError('USER_EXISTS', 'Username already exists', 400);
      }

      // Hash password
      const passwordHash = await this.hashPassword(input.password);

      // Insert user
      const result = await this.db.query(
        `INSERT INTO admin_users (username, password_hash, email, full_name, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, email, full_name, is_active, last_login, created_at, updated_at`,
        [input.username, passwordHash, input.email || null, input.full_name || null, input.created_by || null]
      );

      const user = result.rows[0];
      logger.info('Admin user created', { username: input.username, userId: user.id });

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active,
        last_login: user.last_login ? new Date(user.last_login) : undefined,
        created_at: new Date(user.created_at),
        updated_at: new Date(user.updated_at),
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error creating admin user', { error: error.message, username: input.username });
      throw new AppError('CREATE_USER_ERROR', `Failed to create user: ${error.message}`, 500);
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<AdminUser | null> {
    try {
      const result = await this.db.query(
        `SELECT id, username, email, full_name, is_active, last_login, created_at, updated_at
         FROM admin_users
         WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const user = result.rows[0];
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active,
        last_login: user.last_login ? new Date(user.last_login) : undefined,
        created_at: new Date(user.created_at),
        updated_at: new Date(user.updated_at),
      };
    } catch (error: any) {
      logger.error('Error getting user by ID', { error: error.message, userId: id });
      throw new AppError('GET_USER_ERROR', `Failed to get user: ${error.message}`, 500);
    }
  }

  /**
   * List all admin users
   */
  async listUsers(): Promise<AdminUser[]> {
    try {
      const result = await this.db.query(
        `SELECT id, username, email, full_name, is_active, last_login, created_at, updated_at
         FROM admin_users
         ORDER BY created_at DESC`
      );

      return result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        full_name: row.full_name,
        is_active: row.is_active,
        last_login: row.last_login ? new Date(row.last_login) : undefined,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      }));
    } catch (error: any) {
      logger.error('Error listing users', { error: error.message });
      throw new AppError('LIST_USERS_ERROR', `Failed to list users: ${error.message}`, 500);
    }
  }

  /**
   * Update an admin user
   */
  async updateUser(id: string, input: UpdateAdminUserInput): Promise<AdminUser> {
    try {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (input.username !== undefined) {
        // Check if new username already exists (excluding current user)
        const existingUser = await this.db.query(
          'SELECT id FROM admin_users WHERE username = $1 AND id != $2',
          [input.username, id]
        );

        if (existingUser.rows.length > 0) {
          throw new AppError('USER_EXISTS', 'Username already exists', 400);
        }

        updates.push(`username = $${paramIndex++}`);
        values.push(input.username);
      }

      if (input.password !== undefined) {
        const passwordHash = await this.hashPassword(input.password);
        updates.push(`password_hash = $${paramIndex++}`);
        values.push(passwordHash);
      }

      if (input.email !== undefined) {
        updates.push(`email = $${paramIndex++}`);
        values.push(input.email || null);
      }

      if (input.full_name !== undefined) {
        updates.push(`full_name = $${paramIndex++}`);
        values.push(input.full_name || null);
      }

      if (input.is_active !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(input.is_active);
      }

      if (updates.length === 0) {
        // No updates, return current user
        const user = await this.getUserById(id);
        if (!user) {
          throw new AppError('USER_NOT_FOUND', 'User not found', 404);
        }
        return user;
      }

      // Add updated_at
      updates.push(`updated_at = NOW()`);
      values.push(id);

      const result = await this.db.query(
        `UPDATE admin_users
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, username, email, full_name, is_active, last_login, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        throw new AppError('USER_NOT_FOUND', 'User not found', 404);
      }

      const user = result.rows[0];
      logger.info('Admin user updated', { userId: id });

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active,
        last_login: user.last_login ? new Date(user.last_login) : undefined,
        created_at: new Date(user.created_at),
        updated_at: new Date(user.updated_at),
      };
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error updating admin user', { error: error.message, userId: id });
      throw new AppError('UPDATE_USER_ERROR', `Failed to update user: ${error.message}`, 500);
    }
  }

  /**
   * Delete an admin user
   */
  async deleteUser(id: string): Promise<void> {
    try {
      const result = await this.db.query(
        'DELETE FROM admin_users WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('USER_NOT_FOUND', 'User not found', 404);
      }

      logger.info('Admin user deleted', { userId: id });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error deleting admin user', { error: error.message, userId: id });
      throw new AppError('DELETE_USER_ERROR', `Failed to delete user: ${error.message}`, 500);
    }
  }
}

