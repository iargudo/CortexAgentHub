import {
  IChannelAdapter,
  ChannelConfig,
  ChannelType,
  NormalizedMessage,
  IncomingMessage,
  OutgoingMessage,
  SessionContext,
  generateUUID,
  MessageRole,
} from '@cortex/shared';
import { createLogger } from '@cortex/shared';

/**
 * Abstract base class for all channel adapters
 * Provides common functionality and enforces interface contract
 */
export abstract class BaseChannelAdapter implements IChannelAdapter {
  protected config!: any;
  protected logger;
  protected initialized: boolean = false;
  protected sessions: Map<string, SessionContext> = new Map();

  abstract readonly channelType: ChannelType;

  constructor() {
    this.logger = createLogger(`ChannelAdapter:${this.constructor.name}`);
  }

  /**
   * Initialize the adapter with configuration
   */
  async initialize(config: any): Promise<void> {
    this.config = config;
    this.initialized = true;
    this.logger.info(`Initialized ${this.channelType} adapter`, {
      name: config.name || this.channelType,
      enabled: config.enabled !== false,
    });
  }

  /**
   * Check if adapter is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.channelType} not initialized. Call initialize() first.`);
    }
  }

  /**
   * Create or update session context
   */
  protected createOrUpdateSession(userId: string, metadata?: any): SessionContext {
    const existingSession = this.sessions.get(userId);

    if (existingSession) {
      existingSession.lastActivity = new Date();
      existingSession.metadata = { ...existingSession.metadata, ...metadata };
      return existingSession;
    }

    const session: SessionContext = {
      sessionId: `${this.channelType}:${userId}:${Date.now()}`,
      channelType: this.channelType,
      userId,
      startedAt: new Date(),
      lastActivity: new Date(),
      metadata: metadata || {},
    };

    this.sessions.set(userId, session);
    this.logger.debug(`Created session for user: ${userId}`);

    return session;
  }

  /**
   * Normalize an incoming message to internal format
   */
  protected normalizeMessage(
    conversationId: string,
    userId: string,
    content: string,
    metadata?: any
  ): NormalizedMessage {
    return {
      id: generateUUID(),
      conversationId,
      channelType: this.channelType,
      channelUserId: userId,
      role: MessageRole.USER,
      content,
      timestamp: new Date().toISOString(),
      metadata: metadata || {},
    };
  }

  /**
   * Get session context for a user
   */
  getSessionContext(userId: string): SessionContext {
    let session = this.sessions.get(userId);

    if (!session) {
      session = this.createOrUpdateSession(userId);
    }

    return session;
  }

  /**
   * Clean up expired sessions (call periodically)
   */
  protected cleanupExpiredSessions(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, session] of this.sessions.entries()) {
      const age = now - session.lastActivity.getTime();
      if (age > maxAgeMs) {
        this.sessions.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired sessions`);
    }
  }

  /**
   * Abstract methods that must be implemented by specific adapters
   */
  abstract sendMessage(userId: string, message: OutgoingMessage): Promise<void>;
  abstract receiveMessage(payload: any): NormalizedMessage;
  abstract handleWebhook(payload: any): Promise<NormalizedMessage | null>;
  abstract isHealthy(): Promise<boolean>;
  abstract shutdown(): Promise<void>;
}
