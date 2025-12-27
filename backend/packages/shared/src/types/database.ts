import { UUID, Timestamp, ChannelType, ConversationStatus, MessageRole, Metadata } from './common';

/**
 * Database Entity Types
 */

export interface Conversation {
  id: UUID;
  channel: ChannelType;
  channelUserId: string;
  startedAt: Timestamp;
  lastActivity: Timestamp;
  status: ConversationStatus;
  metadata?: Metadata;
}

export interface Message {
  id: UUID;
  conversationId: UUID;
  role: MessageRole;
  content: string;
  timestamp: Timestamp;
  llmProvider?: string;
  llmModel?: string;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
  metadata?: Metadata;
}

export interface ToolExecutionRecord {
  id: UUID;
  messageId: UUID;
  toolName: string;
  parameters: any;
  result?: any;
  executionTimeMs: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  error?: string;
  executedAt: Timestamp;
}

export interface ContextStore {
  sessionId: string;
  context: any;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt?: Timestamp;
}

export interface ChannelConfigRecord {
  id: UUID;
  channelType: ChannelType;
  name: string;
  config: any; // Encrypted
  active: boolean;
  createdAt: Timestamp;
}

export interface LLMConfigRecord {
  id: UUID;
  provider: string;
  model: string;
  apiKeyEncrypted?: string;
  config?: any;
  active: boolean;
  priority: number;
  createdAt: Timestamp;
}

export interface RoutingRuleRecord {
  id: UUID;
  name: string;
  condition: any;
  action: any;
  priority: number;
  active: boolean;
}

export interface AnalyticsEvent {
  id: UUID;
  eventType: string;
  channel?: ChannelType;
  llmProvider?: string;
  timestamp: Timestamp;
  latencyMs?: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
  metadata?: Metadata;
}
