import {
  MCPContext,
  ContextManagerConfig,
  MCPMessage,
  ToolExecution,
  ChannelType,
  generateUUID,
  generateSessionId,
  createExpiryTimestamp,
  createLogger,
} from '@cortex/shared';
import { MCPServer } from '@cortex/mcp-server';

const logger = createLogger('ContextManager');

/**
 * Context Manager - Manages conversation context and history
 */
export class ContextManager {
  private mcpServer: MCPServer;
  private config: ContextManagerConfig;

  constructor(mcpServer: MCPServer, config: ContextManagerConfig) {
    this.mcpServer = mcpServer;
    this.config = config;

    logger.info('ContextManager initialized', {
      provider: config.provider,
      ttl: config.ttl,
      maxHistoryLength: config.maxHistoryLength,
    });
  }

  /**
   * Get or create context for a conversation
   */
  async getOrCreateContext(
    conversationId: string,
    channelType: ChannelType,
    userId: string
  ): Promise<MCPContext> {
    const sessionId = generateSessionId(channelType, userId);

    // Try to get existing context
    let context = await this.mcpServer.getContext(sessionId);

    if (context) {
      logger.debug('Retrieved existing context', { sessionId, conversationId });
      return context;
    }

    // Create new context
    context = await this.mcpServer.createContext(
      sessionId,
      conversationId,
      channelType,
      userId
    );

    logger.info('Created new context', { sessionId, conversationId });
    return context;
  }

  /**
   * Add a message to the conversation history
   */
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    toolCalls?: any[]
  ): Promise<void> {
    const context = await this.mcpServer.getContext(sessionId);

    if (!context) {
      logger.error('Context not found', { sessionId });
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    const message: MCPMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
      toolCalls,
    };

    // Add message to history
    const updatedHistory = [...context.conversationHistory, message];

    // Trim history if it exceeds max length
    const trimmedHistory = this.trimHistory(updatedHistory);

    // Update context
    await this.mcpServer.updateContext(sessionId, {
      conversationHistory: trimmedHistory,
      updatedAt: new Date().toISOString(),
    });

    logger.debug('Message added to context', {
      sessionId,
      role,
      historyLength: trimmedHistory.length,
    });
  }

  /**
   * Add tool execution to context
   */
  async addToolExecution(sessionId: string, execution: ToolExecution): Promise<void> {
    const context = await this.mcpServer.getContext(sessionId);

    if (!context) {
      logger.error('Context not found', { sessionId });
      throw new Error(`Context not found for session: ${sessionId}`);
    }

    const updatedExecutions = [...context.toolExecutions, execution];

    await this.mcpServer.updateContext(sessionId, {
      toolExecutions: updatedExecutions,
      updatedAt: new Date().toISOString(),
    });

    logger.debug('Tool execution added to context', {
      sessionId,
      toolName: execution.toolName,
    });
  }

  /**
   * Get conversation history
   */
  async getHistory(sessionId: string): Promise<MCPMessage[]> {
    const context = await this.mcpServer.getContext(sessionId);

    if (!context) {
      return [];
    }

    return context.conversationHistory;
  }

  /**
   * Get tool executions
   */
  async getToolExecutions(sessionId: string): Promise<ToolExecution[]> {
    const context = await this.mcpServer.getContext(sessionId);

    if (!context) {
      return [];
    }

    return context.toolExecutions;
  }

  /**
   * Clear conversation history
   */
  async clearHistory(sessionId: string): Promise<void> {
    await this.mcpServer.updateContext(sessionId, {
      conversationHistory: [],
      updatedAt: new Date().toISOString(),
    });

    logger.info('Conversation history cleared', { sessionId });
  }

  /**
   * Delete context
   */
  async deleteContext(sessionId: string): Promise<void> {
    await this.mcpServer.deleteContext(sessionId);
    logger.info('Context deleted', { sessionId });
  }

  /**
   * Extend context TTL
   */
  async extendTTL(sessionId: string, additionalSeconds?: number): Promise<void> {
    const ttl = additionalSeconds || this.config.ttl;
    await this.mcpServer.setContextExpiry(sessionId, ttl);
    logger.debug('Context TTL extended', { sessionId, ttl });
  }

  /**
   * Trim conversation history to max length
   */
  private trimHistory(history: MCPMessage[]): MCPMessage[] {
    if (history.length <= this.config.maxHistoryLength) {
      return history;
    }

    // Keep system messages and the most recent messages
    const systemMessages = history.filter((m) => m.role === 'system');
    const nonSystemMessages = history.filter((m) => m.role !== 'system');

    // Calculate how many non-system messages to keep
    const maxNonSystem = this.config.maxHistoryLength - systemMessages.length;

    if (maxNonSystem <= 0) {
      // If we have too many system messages, just keep the most recent ones
      return history.slice(-this.config.maxHistoryLength);
    }

    // Keep the most recent non-system messages
    const trimmedNonSystem = nonSystemMessages.slice(-maxNonSystem);

    // Combine and sort by timestamp
    const result = [...systemMessages, ...trimmedNonSystem].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    logger.debug('History trimmed', {
      originalLength: history.length,
      newLength: result.length,
    });

    return result;
  }

  /**
   * Compress conversation history (if enabled)
   */
  private async compressHistory(history: MCPMessage[]): Promise<MCPMessage[]> {
    if (!this.config.compressionEnabled) {
      return history;
    }

    // Implement compression logic here
    // This could involve:
    // 1. Summarizing old messages
    // 2. Removing redundant information
    // 3. Using an LLM to create summaries

    // For now, just return the history as-is
    // This is a placeholder for future implementation
    return history;
  }

  /**
   * Get context summary (for debugging/monitoring)
   */
  async getContextSummary(sessionId: string): Promise<{
    sessionId: string;
    messageCount: number;
    toolExecutionCount: number;
    lastActivity: Date;
    createdAt: Date;
  } | null> {
    const context = await this.mcpServer.getContext(sessionId);

    if (!context) {
      return null;
    }

    return {
      sessionId: context.sessionId,
      messageCount: context.conversationHistory.length,
      toolExecutionCount: context.toolExecutions.length,
      lastActivity: new Date(context.updatedAt),
      createdAt: new Date(context.createdAt),
    };
  }

  /**
   * Format conversation history for LLM
   */
  formatHistoryForLLM(history: MCPMessage[]): string {
    return history
      .map((msg) => {
        const role = msg.role.toUpperCase();
        const timestamp = new Date(msg.timestamp).toLocaleString();
        return `[${timestamp}] ${role}: ${msg.content}`;
      })
      .join('\n\n');
  }

  /**
   * Get conversation statistics
   */
  async getStats(sessionId: string): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    systemMessages: number;
    toolExecutions: number;
    successfulTools: number;
    failedTools: number;
  } | null> {
    const context = await this.mcpServer.getContext(sessionId);

    if (!context) {
      return null;
    }

    const userMessages = context.conversationHistory.filter((m) => m.role === 'user').length;
    const assistantMessages = context.conversationHistory.filter(
      (m) => m.role === 'assistant'
    ).length;
    const systemMessages = context.conversationHistory.filter((m) => m.role === 'system').length;

    const successfulTools = context.toolExecutions.filter((t) => t.status === 'success').length;
    const failedTools = context.toolExecutions.filter((t) => t.status === 'failed').length;

    return {
      totalMessages: context.conversationHistory.length,
      userMessages,
      assistantMessages,
      systemMessages,
      toolExecutions: context.toolExecutions.length,
      successfulTools,
      failedTools,
    };
  }
}
