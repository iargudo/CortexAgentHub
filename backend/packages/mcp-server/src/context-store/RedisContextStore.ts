import Redis from 'ioredis';
import { MCPContext } from '@cortex/shared';
import { createLogger, MCPError, ERROR_CODES } from '@cortex/shared';
import { BaseContextStore } from './ContextStore';

const logger = createLogger('RedisContextStore');

/**
 * Redis-based context store implementation
 */
export class RedisContextStore extends BaseContextStore {
  private client: Redis;
  private keyPrefix: string = 'cortex:context:';

  constructor(redisUrl: string, ttl: number = 3600) {
    super(ttl);
    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        // Solo loguear como WARN después de varios intentos, los primeros como DEBUG
        if (times <= 3) {
          logger.debug(`Redis connection retry attempt ${times}, waiting ${delay}ms`);
        } else {
          logger.warn(`Redis connection retry attempt ${times}, waiting ${delay}ms`);
        }
        // Limitar reintentos a 10 para evitar loops infinitos
        if (times > 10) {
          logger.error('Redis connection failed after 10 retry attempts');
          return null; // Detener reintentos
        }
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true, // No conectar inmediatamente
      connectTimeout: 10000, // 10 segundos timeout
      keepAlive: 30000, // Keep-alive cada 30 segundos
      reconnectOnError: (err) => {
        // Reconectar automáticamente en errores específicos
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      },
      enableOfflineQueue: true, // Encolar comandos si está offline para evitar errores en el primer uso
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
    });

    this.client.on('ready', () => {
      logger.info('Redis ready');
    });

    this.client.on('error', (error) => {
      // Solo loguear errores críticos, ignorar errores de conexión temporales
      if (!error.message.includes('ECONNREFUSED') && 
          !error.message.includes('ETIMEDOUT') &&
          !error.message.includes('Connection is closed')) {
        logger.error('Redis connection error', { error: error.message });
      } else {
        logger.debug('Redis connection error (will retry)', { error: error.message });
      }
    });

    this.client.on('close', () => {
      // Cambiar a DEBUG - las desconexiones son normales y se reconectan automáticamente
      logger.debug('Redis connection closed (will reconnect automatically)');
    });

    this.client.on('reconnecting', (delay: number) => {
      logger.debug(`Redis reconnecting in ${delay}ms`);
    });
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Ensure Redis is connected before operations
   * This prevents "Stream isn't writeable" errors when Redis hasn't connected yet
   */
  private async ensureConnected(): Promise<void> {
    const status = this.client.status;
    
    if (status === 'ready') {
      return;
    }

    if (status === 'connecting' || status === 'reconnecting') {
      // Wait for connection to be ready (max 10 seconds)
      const maxWait = 10000;
      const startTime = Date.now();
      
      while (this.client.status !== 'ready' && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.client.status === 'ready') {
        return;
      }
    }

    // If not connected, try to connect
    const currentStatus = this.client.status;
    if (currentStatus === 'end' || currentStatus === 'close') {
      logger.warn('Redis connection closed, attempting to reconnect...');
      await this.client.connect();
    } else if (currentStatus === 'wait') {
      // Connection not started yet, start it
      await this.client.connect();
    }
  }

  async get(sessionId: string): Promise<MCPContext | null> {
    try {
      await this.ensureConnected();
      const key = this.getKey(sessionId);
      const data = await this.client.get(key);

      if (!data) {
        logger.debug(`Context not found for session: ${sessionId}`);
        return null;
      }

      const context = JSON.parse(data) as MCPContext;
      logger.debug(`Retrieved context for session: ${sessionId}`);
      return context;
    } catch (error: any) {
      logger.error(`Failed to get context for session ${sessionId}`, { error: error.message });
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Failed to retrieve context: ${error.message}`
      );
    }
  }

  async set(sessionId: string, context: MCPContext, ttl?: number): Promise<void> {
    try {
      await this.ensureConnected();
      const key = this.getKey(sessionId);
      const ttlSeconds = ttl || this.ttl;
      const data = JSON.stringify(context);

      logger.info(`[DEBUG] Attempting to store context`, {
        sessionId,
        key,
        ttlSeconds,
        dataLength: data.length,
        conversationHistoryLength: context.conversationHistory.length,
      });

      await this.client.setex(key, ttlSeconds, data);

      // Verify it was stored
      const stored = await this.client.get(key);
      if (stored) {
        logger.info(`[DEBUG] Context successfully stored and verified`, {
          sessionId,
          key,
          storedDataLength: stored.length,
        });
      } else {
        logger.error(`[DEBUG] Context was NOT stored in Redis!`, { sessionId, key });
      }

      logger.debug(`Stored context for session: ${sessionId} with TTL ${ttlSeconds}s`);
    } catch (error: any) {
      logger.error(`Failed to set context for session ${sessionId}`, { error: error.message });
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Failed to store context: ${error.message}`
      );
    }
  }

  async update(sessionId: string, updates: Partial<MCPContext>): Promise<void> {
    try {
      logger.info(`[DEBUG] Attempting to update context`, {
        sessionId,
        updateKeys: Object.keys(updates),
        hasConversationHistory: !!updates.conversationHistory,
        conversationHistoryLength: updates.conversationHistory?.length || 0,
      });

      const existingContext = await this.get(sessionId);

      if (!existingContext) {
        logger.error(`[DEBUG] Cannot update - context not found`, { sessionId });
        throw new MCPError(
          ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
          `Context not found for session: ${sessionId}`
        );
      }

      logger.info(`[DEBUG] Existing context found`, {
        sessionId,
        existingHistoryLength: existingContext.conversationHistory.length,
      });

      const updatedContext: MCPContext = {
        ...existingContext,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      // Get remaining TTL and preserve it
      const key = this.getKey(sessionId);
      const ttl = await this.client.ttl(key);
      const ttlSeconds = ttl > 0 ? ttl : this.ttl;

      logger.info(`[DEBUG] Calling set() with updated context`, {
        sessionId,
        updatedHistoryLength: updatedContext.conversationHistory.length,
        ttlSeconds,
      });

      await this.set(sessionId, updatedContext, ttlSeconds);
      logger.debug(`Updated context for session: ${sessionId}`);
    } catch (error: any) {
      logger.error(`Failed to update context for session ${sessionId}`, { error: error.message });
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await this.ensureConnected();
      const key = this.getKey(sessionId);
      await this.client.del(key);
      logger.debug(`Deleted context for session: ${sessionId}`);
    } catch (error: any) {
      logger.error(`Failed to delete context for session ${sessionId}`, { error: error.message });
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Failed to delete context: ${error.message}`
      );
    }
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const key = this.getKey(sessionId);
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error: any) {
      logger.error(`Failed to check existence for session ${sessionId}`, {
        error: error.message,
      });
      return false;
    }
  }

  async setExpiry(sessionId: string, ttlSeconds: number): Promise<void> {
    try {
      await this.ensureConnected();
      const key = this.getKey(sessionId);
      await this.client.expire(key, ttlSeconds);
      logger.debug(`Set expiry for session ${sessionId} to ${ttlSeconds}s`);
    } catch (error: any) {
      logger.error(`Failed to set expiry for session ${sessionId}`, { error: error.message });
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Failed to set expiry: ${error.message}`
      );
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Redis context store');
    await this.client.quit();
  }

  /**
   * Get all session keys (for debugging/admin purposes)
   */
  async getAllSessions(): Promise<string[]> {
    try {
      await this.ensureConnected();
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.client.keys(pattern);
      return keys.map((key) => key.replace(this.keyPrefix, ''));
    } catch (error: any) {
      logger.error('Failed to get all sessions', { error: error.message });
      return [];
    }
  }

  /**
   * Clear all contexts (for testing/reset purposes)
   */
  async clearAll(): Promise<void> {
    try {
      await this.ensureConnected();
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.client.del(...keys);
        logger.info(`Cleared ${keys.length} contexts`);
      }
    } catch (error: any) {
      logger.error('Failed to clear all contexts', { error: error.message });
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.ensureConnected();
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
