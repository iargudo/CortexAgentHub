import { MCPContext } from '@cortex/shared';
import { createLogger, MCPError, ERROR_CODES } from '@cortex/shared';
import { BaseContextStore } from './ContextStore';

const logger = createLogger('MemoryContextStore');

interface ContextEntry {
  context: MCPContext;
  expiresAt: number;
}

/**
 * In-memory context store (for development/testing)
 * WARNING: This is not suitable for production use
 */
export class MemoryContextStore extends BaseContextStore {
  private store: Map<string, ContextEntry>;
  private cleanupInterval: NodeJS.Timeout;

  constructor(ttl: number = 3600) {
    super(ttl);
    this.store = new Map();

    // Clean up expired contexts every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);

    logger.warn('Using in-memory context store - not suitable for production');
  }

  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired contexts`);
    }
  }

  async get(sessionId: string): Promise<MCPContext | null> {
    const entry = this.store.get(sessionId);

    if (!entry) {
      logger.debug(`Context not found for session: ${sessionId}`);
      return null;
    }

    // Check if expired
    if (entry.expiresAt < Date.now()) {
      this.store.delete(sessionId);
      logger.debug(`Context expired for session: ${sessionId}`);
      return null;
    }

    logger.debug(`Retrieved context for session: ${sessionId}`);
    return entry.context;
  }

  async set(sessionId: string, context: MCPContext, ttl?: number): Promise<void> {
    const ttlSeconds = ttl || this.ttl;
    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.store.set(sessionId, {
      context,
      expiresAt,
    });

    logger.debug(`Stored context for session: ${sessionId} with TTL ${ttlSeconds}s`);
  }

  async update(sessionId: string, updates: Partial<MCPContext>): Promise<void> {
    const entry = this.store.get(sessionId);

    if (!entry) {
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Context not found for session: ${sessionId}`
      );
    }

    // Check if expired
    if (entry.expiresAt < Date.now()) {
      this.store.delete(sessionId);
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Context expired for session: ${sessionId}`
      );
    }

    const updatedContext: MCPContext = {
      ...entry.context,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.store.set(sessionId, {
      context: updatedContext,
      expiresAt: entry.expiresAt, // Preserve expiry
    });

    logger.debug(`Updated context for session: ${sessionId}`);
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
    logger.debug(`Deleted context for session: ${sessionId}`);
  }

  async exists(sessionId: string): Promise<boolean> {
    const entry = this.store.get(sessionId);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (entry.expiresAt < Date.now()) {
      this.store.delete(sessionId);
      return false;
    }

    return true;
  }

  async setExpiry(sessionId: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(sessionId);

    if (!entry) {
      throw new MCPError(
        ERROR_CODES.MCP_CONTEXT_NOT_FOUND,
        `Context not found for session: ${sessionId}`
      );
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.store.set(sessionId, {
      ...entry,
      expiresAt,
    });

    logger.debug(`Set expiry for session ${sessionId} to ${ttlSeconds}s`);
  }

  async shutdown(): Promise<void> {
    clearInterval(this.cleanupInterval);
    this.store.clear();
    logger.info('Shut down memory context store');
  }

  /**
   * Get all session keys
   */
  getAllSessions(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Clear all contexts
   */
  clearAll(): void {
    this.store.clear();
    logger.info('Cleared all contexts');
  }

  /**
   * Get store size
   */
  size(): number {
    return this.store.size;
  }
}
