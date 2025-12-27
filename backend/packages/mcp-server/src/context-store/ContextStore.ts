import { MCPContext } from '@cortex/shared';
import { createLogger } from '@cortex/shared';

const logger = createLogger('ContextStore');

/**
 * Base interface for context storage
 */
export interface IContextStore {
  get(sessionId: string): Promise<MCPContext | null>;
  set(sessionId: string, context: MCPContext, ttl?: number): Promise<void>;
  update(sessionId: string, updates: Partial<MCPContext>): Promise<void>;
  delete(sessionId: string): Promise<void>;
  exists(sessionId: string): Promise<boolean>;
  setExpiry(sessionId: string, ttlSeconds: number): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Abstract base class for context stores
 */
export abstract class BaseContextStore implements IContextStore {
  protected ttl: number;

  constructor(ttl: number = 3600) {
    this.ttl = ttl;
  }

  abstract get(sessionId: string): Promise<MCPContext | null>;
  abstract set(sessionId: string, context: MCPContext, ttl?: number): Promise<void>;
  abstract update(sessionId: string, updates: Partial<MCPContext>): Promise<void>;
  abstract delete(sessionId: string): Promise<void>;
  abstract exists(sessionId: string): Promise<boolean>;
  abstract setExpiry(sessionId: string, ttlSeconds: number): Promise<void>;
  abstract shutdown(): Promise<void>;
}
