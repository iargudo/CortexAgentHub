/**
 * @cortex/mcp-server - Model Context Protocol Server
 * Main entry point for the MCP Server package
 */

export * from './server';
export * from './context-store';
export * from './tools';
export * from './permissions';
export * from './resources';

// Re-export important types from shared
export type {
  MCPContext,
  MCPServerConfig,
  ToolDefinition,
  ToolExecution,
  MCPEvent,
} from '@cortex/shared';
