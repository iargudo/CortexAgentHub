import { ToolDefinition, MCPContext } from '@cortex/shared';
import { createLogger, MCPError, ERROR_CODES } from '@cortex/shared';

const logger = createLogger('ToolRegistry');

/**
 * Registry for managing MCP tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new tool
   */
  registerTool(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool '${tool.name}' is already registered, overwriting`);
    }

    this.tools.set(tool.name, tool);
    logger.info(`Registered tool: ${tool.name}`);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: ToolDefinition[]): void {
    tools.forEach((tool) => this.registerTool(tool));
    logger.info(`Registered ${tools.length} tools`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolName: string): boolean {
    const deleted = this.tools.delete(toolName);

    if (deleted) {
      logger.info(`Unregistered tool: ${toolName}`);
    } else {
      logger.warn(`Tool not found: ${toolName}`);
    }

    return deleted;
  }

  /**
   * Get a tool definition
   */
  getTool(toolName: string): ToolDefinition | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Check if a tool exists
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool
   */
  async executeTool(
    toolName: string,
    parameters: any,
    context: MCPContext
  ): Promise<any> {
    const tool = this.getTool(toolName);

    if (!tool) {
      throw new MCPError(
        ERROR_CODES.MCP_TOOL_NOT_FOUND,
        `Tool '${toolName}' not found`
      );
    }

    try {
      logger.info(`Executing tool: ${toolName}`, { parameters });
      const startTime = Date.now();

      const result = await tool.handler(parameters, context);

      // Check if result indicates failure (some tools return { success: false } instead of throwing)
      if (result && typeof result === 'object' && result.success === false) {
        const errorMessage = result.error || result.message || 'Tool execution returned failure status';
        logger.error(`Tool execution failed: ${toolName}`, {
          error: errorMessage,
          result: result,
        });

        throw new MCPError(
          ERROR_CODES.MCP_TOOL_EXECUTION_FAILED,
          errorMessage,
          { toolName, parameters, originalError: errorMessage, toolResult: result }
        );
      }

      const executionTime = Date.now() - startTime;
      logger.info(`Tool executed successfully: ${toolName}`, {
        executionTime: `${executionTime}ms`,
      });

      return result;
    } catch (error: any) {
      logger.error(`Tool execution failed: ${toolName}`, {
        error: error.message,
        stack: error.stack,
      });

      throw new MCPError(
        ERROR_CODES.MCP_TOOL_EXECUTION_FAILED,
        `Tool execution failed: ${error.message}`,
        { toolName, parameters, originalError: error.message }
      );
    }
  }

  /**
   * Get tools available for a specific channel
   */
  getToolsForChannel(channelType: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((tool) =>
      tool.permissions.channels.includes(channelType as any)
    );
  }

  /**
   * Clear all tools (for testing)
   */
  clear(): void {
    this.tools.clear();
    logger.info('Cleared all tools');
  }

  /**
   * Get tool count
   */
  size(): number {
    return this.tools.size;
  }
}
