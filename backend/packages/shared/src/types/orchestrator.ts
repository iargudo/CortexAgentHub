import { UUID, ChannelType, LLMProvider, Metadata } from './common';
import { IncomingMessage, OutgoingMessage } from './message';
import { MCPContext, ToolExecution } from './mcp';

/**
 * Orchestrator Types
 */

export interface RoutingRule {
  id: UUID;
  name: string;
  priority: number;
  active: boolean;
  condition: RoutingCondition;
  action: RoutingAction;
}

export interface RoutingCondition {
  channelType?: ChannelType | ChannelType[];
  userId?: string | string[];
  userSegment?: string; // e.g., 'premium', 'free', 'enterprise'
  messagePattern?: string; // regex pattern
  timeRange?: {
    start: string; // HH:mm format
    end: string;
  };
  custom?: Metadata;
}

export interface RoutingAction {
  llmProvider: LLMProvider;
  llmModel: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  enabledTools?: string[];
  custom?: Metadata;
}

export interface OrchestratorConfig {
  defaultLLMProvider: LLMProvider;
  defaultLLMModel: string;
  routingRules: RoutingRule[];
  contextTTL: number; // seconds
  enableToolExecution: boolean;
  maxToolExecutions: number;
}

export interface ProcessingContext {
  incomingMessage: IncomingMessage;
  conversationId: UUID;
  sessionId: string;
  mcpContext: MCPContext;
  routingAction: RoutingAction;
  startTime: Date;
}

export interface ProcessingResult {
  outgoingMessage: OutgoingMessage;
  conversationId: UUID;
  llmProvider: LLMProvider;
  llmModel: string;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
  processingTimeMs: number;
  toolExecutions: ToolExecution[];
  metadata?: Metadata;
}

export interface MessageRouterConfig {
  rules: RoutingRule[];
  defaultProvider: LLMProvider;
  defaultModel: string;
}

export interface ContextManagerConfig {
  provider: 'redis' | 'memory';
  ttl: number;
  maxHistoryLength: number;
  compressionEnabled: boolean;
}
