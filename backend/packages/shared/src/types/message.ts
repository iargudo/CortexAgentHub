import { ChannelType, MessageRole, UUID, Timestamp, Metadata, TokenUsage, CostInfo } from './common';

/**
 * Normalized internal message format
 * All channel adapters must convert to this format
 */
export interface NormalizedMessage {
  id?: UUID;
  conversationId: UUID;
  channelType: ChannelType;
  channelUserId: string;
  role: MessageRole;
  content: string;
  timestamp: Timestamp;
  metadata?: Metadata;
}

/**
 * Message with LLM metadata (stored in database)
 */
export interface StoredMessage extends NormalizedMessage {
  id: UUID;
  llmProvider?: string;
  llmModel?: string;
  tokensUsed?: TokenUsage;
  cost?: number;
}

/**
 * Incoming message from channel adapter
 */
export interface IncomingMessage {
  channelType: ChannelType;
  channelUserId: string;
  content: string;
  metadata?: Metadata;
}

/**
 * Outgoing message to channel adapter
 */
export interface OutgoingMessage {
  channelUserId: string;
  content: string;
  metadata?: Metadata;
}

/**
 * Message with streaming support
 */
export interface StreamingMessage extends OutgoingMessage {
  isStreaming: boolean;
  chunkIndex?: number;
  totalChunks?: number;
}
