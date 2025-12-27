/**
 * Common types shared across all packages
 */

export type UUID = string;
export type Timestamp = Date | string;

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export enum ChannelType {
  WHATSAPP = 'whatsapp',
  TELEGRAM = 'telegram',
  WEBCHAT = 'webchat',
  EMAIL = 'email',
}

export enum ConversationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum ToolExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export enum LLMProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  OLLAMA = 'ollama',
  HUGGINGFACE = 'huggingface',
  LMSTUDIO = 'lmstudio',
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface CostInfo {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

export interface Metadata {
  [key: string]: any;
}
