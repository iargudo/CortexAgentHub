import { ChannelType, ToolPermissions } from '@cortex/shared';
import { createLogger, ForbiddenError, RateLimitError } from '@cortex/shared';

const logger = createLogger('PermissionManager');

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Manages permissions and rate limiting for MCP tools
 */
export class PermissionManager {
  private rateLimitStore: Map<string, RateLimitEntry>;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.rateLimitStore = new Map();

    // Clean up expired rate limit entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupRateLimits();
    }, 60000);
  }

  /**
   * Check if a channel has permission to use a tool
   */
  checkPermission(
    toolName: string,
    channelType: ChannelType,
    permissions: ToolPermissions
  ): void {
    // Check if channel is allowed
    if (permissions.channels && permissions.channels.length > 0) {
      if (!permissions.channels.includes(channelType)) {
        logger.warn(`Permission denied: ${toolName} not available for channel ${channelType}`);
        throw new ForbiddenError(
          `Tool '${toolName}' is not available for channel '${channelType}'`
        );
      }
    }

    logger.debug(`Permission granted: ${toolName} for channel ${channelType}`);
  }

  /**
   * Check and update rate limit for a tool
   */
  checkRateLimit(
    toolName: string,
    userId: string,
    channelType: ChannelType,
    permissions: ToolPermissions
  ): void {
    if (!permissions.rateLimit) {
      return; // No rate limit configured
    }

    const key = `${channelType}:${userId}:${toolName}`;
    const now = Date.now();
    const entry = this.rateLimitStore.get(key);

    if (!entry) {
      // First request
      this.rateLimitStore.set(key, {
        count: 1,
        resetAt: now + permissions.rateLimit.window * 1000,
      });
      return;
    }

    // Check if window has expired
    if (now >= entry.resetAt) {
      // Reset the counter
      this.rateLimitStore.set(key, {
        count: 1,
        resetAt: now + permissions.rateLimit.window * 1000,
      });
      return;
    }

    // Check if limit exceeded
    if (entry.count >= permissions.rateLimit.requests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn(`Rate limit exceeded for ${toolName} by user ${userId}`, {
        retryAfter,
      });
      throw new RateLimitError(
        `Rate limit exceeded for tool '${toolName}'. Try again in ${retryAfter} seconds.`,
        { retryAfter }
      );
    }

    // Increment counter
    entry.count++;
    this.rateLimitStore.set(key, entry);
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanupRateLimits(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.rateLimitStore.entries()) {
      if (now >= entry.resetAt) {
        this.rateLimitStore.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} rate limit entries`);
    }
  }

  /**
   * Reset rate limit for a specific user/tool combination
   */
  resetRateLimit(toolName: string, userId: string, channelType: ChannelType): void {
    const key = `${channelType}:${userId}:${toolName}`;
    this.rateLimitStore.delete(key);
    logger.debug(`Reset rate limit for ${key}`);
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(
    toolName: string,
    userId: string,
    channelType: ChannelType
  ): {
    remaining: number;
    resetAt: Date | null;
  } | null {
    const key = `${channelType}:${userId}:${toolName}`;
    const entry = this.rateLimitStore.get(key);

    if (!entry) {
      return null;
    }

    return {
      remaining: Math.max(0, entry.count),
      resetAt: new Date(entry.resetAt),
    };
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
    this.rateLimitStore.clear();
    logger.info('Permission manager shut down');
  }
}
