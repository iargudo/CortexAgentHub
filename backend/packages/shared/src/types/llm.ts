import { LLMProvider, TokenUsage, CostInfo, Metadata } from './common';
import { ToolCall, ToolDefinition as MCPToolDefinition } from './mcp';

/**
 * LLM Gateway Types
 */

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  metadata?: Metadata;
}

/**
 * Simplified tool definition for LLM providers (without handler/permissions)
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface CompletionOptions extends Omit<LLMConfig, 'provider' | 'apiKey'> {
  systemPrompt?: string;
  tools?: LLMToolDefinition[];
  stream?: boolean;
}

export interface CompletionResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  tokensUsed: TokenUsage;
  cost: CostInfo;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  toolCalls?: ToolCall[];
  metadata?: Metadata;
}

export interface StreamOptions extends CompletionOptions {
  onToken?: (token: string) => void;
  onComplete?: (response: CompletionResponse) => void;
  onError?: (error: Error) => void;
}

export interface Token {
  content: string;
  index: number;
  isComplete: boolean;
}

export interface EmbeddingResponse {
  embedding: number[];
  provider: LLMProvider;
  model: string;
  tokensUsed: number;
  cost: CostInfo;
}

/**
 * Base interface that all LLM providers must implement
 */
export interface ILLMProvider {
  name: LLMProvider;
  supportsMCP: boolean;
  supportsTools: boolean;
  maxTokens: number;
  costPerToken: {
    input: number;
    output: number;
  };

  initialize(config: LLMConfig): Promise<void>;
  complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse>;
  stream(prompt: string, options: StreamOptions): AsyncGenerator<Token>;
  embeddings(text: string): Promise<EmbeddingResponse>;
  isHealthy(): Promise<boolean>;
}

/**
 * Load balancer configuration
 */
export interface LoadBalancerConfig {
  strategy: 'round-robin' | 'least-latency' | 'least-cost' | 'priority';
  providers: LLMConfig[];
  fallbackEnabled: boolean;
  retryAttempts: number;
  retryDelay: number; // milliseconds
  circuitBreaker?: {
    failureThreshold: number;
    resetTimeout: number; // milliseconds
  };
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  provider: LLMProvider;
  isHealthy: boolean;
  lastChecked: Date;
  latency?: number; // milliseconds
  errorRate?: number; // percentage
  circuitBreakerOpen?: boolean;
}
