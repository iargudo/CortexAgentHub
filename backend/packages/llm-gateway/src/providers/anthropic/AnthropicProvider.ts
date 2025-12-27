import Anthropic from '@anthropic-ai/sdk';
import {
  CompletionOptions,
  CompletionResponse,
  StreamOptions,
  Token,
  EmbeddingResponse,
  LLMProvider,
  LLM_COSTS,
  LLM_MAX_TOKENS,
  LLMError,
  ERROR_CODES,
} from '@cortex/shared';
import { BaseLLMProvider } from '../../interfaces/BaseLLMProvider';

/**
 * Anthropic Claude provider implementation
 * Supports Claude 3 (Opus, Sonnet, Haiku)
 */
export class AnthropicProvider extends BaseLLMProvider {
  name = LLMProvider.ANTHROPIC;
  supportsMCP = true;
  supportsTools = true;
  maxTokens: number;
  costPerToken: { input: number; output: number };

  private client!: Anthropic;

  constructor() {
    super();
    // Default to Claude 3 Sonnet costs
    this.maxTokens = 200000;
    this.costPerToken = { input: 0.000003, output: 0.000015 };
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });

    // Update costs and max tokens based on model
    const modelKey = config.model as keyof typeof LLM_COSTS.anthropic;
    if (LLM_COSTS.anthropic[modelKey]) {
      this.costPerToken = LLM_COSTS.anthropic[modelKey];
    }
    if (LLM_MAX_TOKENS.anthropic[modelKey]) {
      this.maxTokens = LLM_MAX_TOKENS.anthropic[modelKey];
    }

    this.logger.info('Anthropic provider initialized', {
      model: config.model,
      maxTokens: this.maxTokens,
    });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    this.ensureInitialized();

    try {
      // Build tools if provided
      const tools = options.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));

      const requestParams: any = {
        model: this.config.model,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
      };

      this.logger.debug('Sending completion request to Anthropic', {
        model: requestParams.model,
        hasTools: !!tools,
      });

      const response = await (this.client as any).messages.create(requestParams);

      const tokensUsed = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      };

      const cost = this.calculateCost(tokensUsed);

      // Extract text content
      const textContent = response.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => (c as any).text)
        .join('\n');

      // Handle tool calls
      const toolCalls = response.content
        .filter((c: any) => c.type === 'tool_use')
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          parameters: c.input,
          timestamp: new Date().toISOString(),
        }));

      const result: CompletionResponse = {
        content: textContent,
        provider: this.name,
        model: this.config.model,
        tokensUsed,
        cost,
        finishReason: this.mapStopReason(response.stop_reason),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      this.logger.info('Completion successful', {
        tokens: tokensUsed.total,
        cost: cost.totalCost,
        stopReason: response.stop_reason,
        hasToolCalls: toolCalls.length > 0,
      });

      return result;
    } catch (error: any) {
      this.logger.error('Anthropic completion failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Anthropic API error: ${error.message}`,
        { provider: this.name, model: this.config.model, originalError: error }
      );
    }
  }

  async *stream(prompt: string, options: StreamOptions): AsyncGenerator<Token> {
    this.ensureInitialized();

    try {
      const stream = await (this.client as any).messages.create({
        model: this.config.model,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        stream: true,
      });

      let index = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            const content = delta.text;

            const token: Token = {
              content,
              index: index++,
              isComplete: false,
            };

            if (options.onToken) {
              options.onToken(content);
            }

            yield token;
          }
        } else if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
        }
      }

      // Final token to indicate completion
      yield {
        content: '',
        index,
        isComplete: true,
      };

      if (options.onComplete) {
        const tokensUsed = {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        };

        options.onComplete({
          content: '',
          provider: this.name,
          model: this.config.model,
          tokensUsed,
          cost: this.calculateCost(tokensUsed),
          finishReason: 'stop',
        });
      }
    } catch (error: any) {
      this.logger.error('Anthropic streaming failed', { error: error.message });

      if (options.onError) {
        options.onError(error);
      }

      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Anthropic streaming error: ${error.message}`,
        { provider: this.name, model: this.config.model }
      );
    }
  }

  async embeddings(_text: string): Promise<EmbeddingResponse> {
    // Anthropic doesn't provide embeddings API
    throw new LLMError(
      ERROR_CODES.LLM_API_ERROR,
      'Anthropic does not support embeddings. Use OpenAI or another provider.'
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check with minimal tokens
      await (this.client as any).messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private mapStopReason(
    reason: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
