import { UUID, Timestamp, Metadata, ChannelType } from './common';

/**
 * MCP (Model Context Protocol) Types
 */

export interface MCPContext {
  sessionId: string;
  conversationId: UUID;
  channelType: ChannelType;
  userId: string;
  conversationHistory: MCPMessage[];
  toolExecutions: ToolExecution[];
  metadata: Metadata;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt?: Timestamp;
}

export interface MCPMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Timestamp;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
  permissions: ToolPermissions;
  handler: ToolHandler;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ParameterProperty>;
  required?: string[];
}

export interface ParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: any[];
  items?: ParameterProperty;
}

export interface ToolPermissions {
  channels: ChannelType[];
  requiresAuth?: boolean;
  rateLimit?: {
    requests: number;
    window: number; // in seconds
  };
}

export type ToolHandler = (params: any, context: MCPContext) => Promise<any>;

export interface ToolCall {
  id: string;
  name: string;
  parameters: any;
  timestamp: Timestamp;
}

export interface ToolExecution {
  id: UUID;
  toolName: string;
  parameters: any;
  result?: any;
  error?: string;
  executionTimeMs: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  executedAt: Timestamp;
}

export interface ResourceDefinition {
  name: string;
  type: 'database' | 'api' | 'file' | 'vector-db' | 'custom';
  config: ResourceConfig;
}

export interface ResourceConfig {
  [key: string]: any;
}

export interface MCPEvent {
  type: 'tool_execution' | 'context_update' | 'error' | 'message';
  data: any;
  timestamp: Timestamp;
}

export interface MCPServerConfig {
  port: number;
  tools: ToolDefinition[];
  resources: ResourceDefinition[];
  contextStore: {
    provider: 'redis' | 'memory';
    ttl: number; // seconds
    config?: any;
  };
  security: {
    enablePermissions: boolean;
    enableRateLimiting: boolean;
  };
}
