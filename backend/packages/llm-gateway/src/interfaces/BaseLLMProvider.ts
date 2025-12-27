import {
  ILLMProvider,
  LLMConfig,
  CompletionOptions,
  CompletionResponse,
  StreamOptions,
  Token,
  EmbeddingResponse,
  LLMProvider,
  calculateCost,
  TokenUsage,
} from '@cortex/shared';
import { createLogger } from '@cortex/shared';

/**
 * Abstract base class for all LLM providers
 * Provides common functionality and enforces interface contract
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  protected config!: LLMConfig;
  protected logger;
  protected initialized: boolean = false;

  abstract readonly name: LLMProvider;
  abstract readonly supportsMCP: boolean;
  abstract readonly supportsTools: boolean;
  abstract readonly maxTokens: number;
  abstract readonly costPerToken: {
    input: number;
    output: number;
  };

  constructor() {
    this.logger = createLogger(`LLMProvider:${this.constructor.name}`);
  }

  /**
   * Initialize the provider with configuration
   */
  async initialize(config: LLMConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    this.logger.info(`Initialized ${this.name} provider with model: ${config.model}`);
  }

  /**
   * Check if provider is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Provider ${this.name} not initialized. Call initialize() first.`);
    }
  }

  /**
   * Calculate cost based on token usage
   */
  protected calculateCost(tokens: TokenUsage) {
    return calculateCost(tokens, this.costPerToken);
  }

  /**
   * Count tokens (basic estimation, should be overridden by providers)
   */
  protected estimateTokens(text: string): number {
    // Basic estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Build messages array for completion
   */
  protected buildMessages(prompt: string, options: CompletionOptions): any[] {
    const messages: any[] = [];

    if (options.systemPrompt) {
      messages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    return messages;
  }

  /**
   * Abstract methods that must be implemented by providers
   */
  abstract complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse>;
  abstract stream(prompt: string, options: StreamOptions): AsyncGenerator<Token>;
  abstract embeddings(text: string): Promise<EmbeddingResponse>;
  abstract isHealthy(): Promise<boolean>;
}
