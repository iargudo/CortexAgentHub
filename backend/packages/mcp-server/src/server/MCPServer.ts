import {
  MCPContext,
  MCPServerConfig,
  ToolDefinition,
  ToolExecution,
  MCPEvent,
  ChannelType,
  generateUUID,
  createExpiryTimestamp,
} from '@cortex/shared';
import { createLogger, MCPError, ERROR_CODES } from '@cortex/shared';
import { IContextStore } from '../context-store/ContextStore';
import { RedisContextStore } from '../context-store/RedisContextStore';
import { MemoryContextStore } from '../context-store/MemoryContextStore';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionManager } from '../permissions/PermissionManager';
import { DynamicToolLoader } from '../tools/DynamicToolLoader';
import { EventEmitter } from 'events';

const logger = createLogger('MCPServer');

/**
 * Main MCP Server implementation
 * Central hub for tool execution, context management, and permissions
 */
export class MCPServer extends EventEmitter {
  private contextStore: IContextStore;
  private toolRegistry: ToolRegistry;
  private permissionManager: PermissionManager;
  private toolLoader?: DynamicToolLoader;
  private config: MCPServerConfig;
  private isRunning: boolean = false;

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
    this.toolRegistry = new ToolRegistry();
    this.permissionManager = new PermissionManager();

    // Initialize context store based on configuration
    this.contextStore = this.initializeContextStore();

    // Register initial tools
    if (config.tools && config.tools.length > 0) {
      this.toolRegistry.registerTools(config.tools);
    }

    logger.info('MCP Server initialized', {
      contextStoreProvider: config.contextStore.provider,
      toolCount: this.toolRegistry.size(),
    });
  }

  private initializeContextStore(): IContextStore {
    const { provider, ttl, config: storeConfig } = this.config.contextStore;

    switch (provider) {
      case 'redis':
        const redisUrl = storeConfig?.url || process.env.REDIS_URL || 'redis://localhost:6379';
        return new RedisContextStore(redisUrl, ttl);

      case 'memory':
        return new MemoryContextStore(ttl);

      default:
        logger.warn(`Unknown context store provider: ${provider}, defaulting to memory`);
        return new MemoryContextStore(ttl);
    }
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('MCP Server is already running');
      return;
    }

    // Load tools from database if database URL is provided
    if (process.env.DATABASE_URL) {
      try {
        logger.info('Loading tools from database...');
        this.toolLoader = new DynamicToolLoader(process.env.DATABASE_URL);
        const tools = await this.toolLoader.loadTools();
        this.toolRegistry.registerTools(tools);
        logger.info(`Loaded ${tools.length} tools from database`);
      } catch (error: any) {
        logger.error('Failed to load tools from database, continuing with config tools only', {
          error: error.message,
        });
      }
    } else {
      logger.warn('DATABASE_URL not set, skipping database tool loading');
    }

    this.isRunning = true;
    logger.info('MCP Server started', {
      toolCount: this.toolRegistry.size(),
    });
    this.emit('started');
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('MCP Server is not running');
      return;
    }

    this.isRunning = false;

    // Shutdown components
    await this.contextStore.shutdown();
    this.permissionManager.shutdown();

    logger.info('MCP Server stopped');
    this.emit('stopped');
  }

  /**
   * Register a new tool
   */
  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.registerTool(tool);
    this.emit('tool:registered', tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: ToolDefinition[]): void {
    this.toolRegistry.registerTools(tools);
    tools.forEach((tool) => this.emit('tool:registered', tool));
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolName: string): boolean {
    const result = this.toolRegistry.unregisterTool(toolName);
    if (result) {
      this.emit('tool:unregistered', toolName);
    }
    return result;
  }

  /**
   * Get all registered tools
   */
  getTools(): ToolDefinition[] {
    return this.toolRegistry.getAllTools();
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): ToolDefinition | undefined {
    return this.toolRegistry.getTool(toolName);
  }

  /**
   * Execute a tool with permissions and rate limiting
   */
  async executeTool(
    toolName: string,
    parameters: any,
    context: MCPContext
  ): Promise<ToolExecution> {
    const tool = this.toolRegistry.getTool(toolName);

    if (!tool) {
      throw new MCPError(ERROR_CODES.MCP_TOOL_NOT_FOUND, `Tool '${toolName}' not found`);
    }

    // Check permissions if enabled
    if (this.config.security.enablePermissions) {
      this.permissionManager.checkPermission(toolName, context.channelType, tool.permissions);
    }

    // Check rate limiting if enabled
    if (this.config.security.enableRateLimiting) {
      this.permissionManager.checkRateLimit(
        toolName,
        context.userId,
        context.channelType,
        tool.permissions
      );
    }

    const executionId = generateUUID();
    const startTime = Date.now();

    const execution: ToolExecution = {
      id: executionId,
      toolName,
      parameters,
      status: 'running',
      executionTimeMs: 0,
      executedAt: new Date().toISOString(),
    };

    try {
      // Execute the tool
      const result = await this.toolRegistry.executeTool(toolName, parameters, context);

      const executionTimeMs = Date.now() - startTime;

      execution.result = result;
      execution.status = 'success';
      execution.executionTimeMs = executionTimeMs;

      // Update context with tool execution
      await this.updateContext(context.sessionId, {
        toolExecutions: [...context.toolExecutions, execution],
      });

      this.emit('tool:executed', execution);

      logger.info(`Tool executed successfully: ${toolName}`, {
        executionId,
        executionTimeMs,
      });

      return execution;
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;

      execution.status = 'failed';
      execution.error = error.message;
      execution.executionTimeMs = executionTimeMs;

      this.emit('tool:failed', execution);

      logger.error(`Tool execution failed: ${toolName}`, {
        executionId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Get context for a session
   */
  async getContext(sessionId: string): Promise<MCPContext | null> {
    return await this.contextStore.get(sessionId);
  }

  /**
   * Create a new context
   */
  async createContext(
    sessionId: string,
    conversationId: string,
    channelType: ChannelType,
    userId: string
  ): Promise<MCPContext> {
    const context: MCPContext = {
      sessionId,
      conversationId,
      channelType,
      userId,
      conversationHistory: [],
      toolExecutions: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: createExpiryTimestamp(this.config.contextStore.ttl).toISOString(),
    };

    await this.contextStore.set(sessionId, context);

    this.emit('context:created', context);
    logger.info(`Context created for session: ${sessionId}`);

    return context;
  }

  /**
   * Update context
   */
  async updateContext(sessionId: string, updates: Partial<MCPContext>): Promise<void> {
    await this.contextStore.update(sessionId, updates);
    this.emit('context:updated', sessionId);
    logger.debug(`Context updated for session: ${sessionId}`);
  }

  /**
   * Delete context
   */
  async deleteContext(sessionId: string): Promise<void> {
    await this.contextStore.delete(sessionId);
    this.emit('context:deleted', sessionId);
    logger.info(`Context deleted for session: ${sessionId}`);
  }

  /**
   * Check if context exists
   */
  async contextExists(sessionId: string): Promise<boolean> {
    return await this.contextStore.exists(sessionId);
  }

  /**
   * Set context expiry
   */
  async setContextExpiry(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.contextStore.setExpiry(sessionId, ttlSeconds);
  }

  /**
   * Get or create context
   */
  async getOrCreateContext(
    sessionId: string,
    conversationId: string,
    channelType: ChannelType,
    userId: string
  ): Promise<MCPContext> {
    const existingContext = await this.getContext(sessionId);

    if (existingContext) {
      return existingContext;
    }

    return await this.createContext(sessionId, conversationId, channelType, userId);
  }

  /**
   * Stream events for a session (placeholder for future implementation)
   */
  async *streamEvents(sessionId: string): AsyncGenerator<MCPEvent> {
    // This is a placeholder for future real-time event streaming
    // Could be implemented with Redis Pub/Sub or WebSockets
    logger.warn('Event streaming not yet implemented');
    yield {
      type: 'message',
      data: { message: 'Event streaming not yet implemented' },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check permission for a tool
   */
  checkPermission(channelType: ChannelType, toolName: string): boolean {
    const tool = this.toolRegistry.getTool(toolName);

    if (!tool) {
      return false;
    }

    try {
      this.permissionManager.checkPermission(toolName, channelType, tool.permissions);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get tools available for a channel
   */
  getToolsForChannel(channelType: ChannelType): ToolDefinition[] {
    return this.toolRegistry.getToolsForChannel(channelType);
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check if context store is healthy
      if ('isHealthy' in this.contextStore) {
        return await (this.contextStore as any).isHealthy();
      }
      return this.isRunning;
    } catch {
      return false;
    }
  }

  /**
   * Reload tools from database
   */
  async reloadTools(): Promise<{ success: boolean; toolCount: number; error?: string }> {
    if (!this.toolLoader) {
      return {
        success: false,
        toolCount: 0,
        error: 'Tool loader not initialized. DATABASE_URL may not be set.',
      };
    }

    try {
      logger.info('Reloading tools from database...');

      // Clear current tools
      this.toolRegistry.clear();

      // Reload from config if provided
      if (this.config.tools && this.config.tools.length > 0) {
        this.toolRegistry.registerTools(this.config.tools);
      }

      // Load from database
      const tools = await this.toolLoader.loadTools();
      this.toolRegistry.registerTools(tools);

      const toolCount = this.toolRegistry.size();
      logger.info(`Tools reloaded successfully: ${toolCount} tools`);

      this.emit('tools:reloaded', { toolCount });

      return {
        success: true,
        toolCount,
      };
    } catch (error: any) {
      logger.error('Failed to reload tools', { error: error.message });
      return {
        success: false,
        toolCount: this.toolRegistry.size(),
        error: error.message,
      };
    }
  }

  /**
   * Get server stats
   */
  getStats(): {
    isRunning: boolean;
    toolCount: number;
    contextStoreProvider: string;
    databaseToolsEnabled: boolean;
  } {
    return {
      isRunning: this.isRunning,
      toolCount: this.toolRegistry.size(),
      contextStoreProvider: this.config.contextStore.provider,
      databaseToolsEnabled: !!this.toolLoader,
    };
  }
}
