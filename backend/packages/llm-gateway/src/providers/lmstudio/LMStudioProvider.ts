import OpenAI from 'openai';
import {
  CompletionOptions,
  CompletionResponse,
  StreamOptions,
  Token,
  EmbeddingResponse,
  LLMProvider,
  LLM_MAX_TOKENS,
  LLMError,
  ERROR_CODES,
} from '@cortex/shared';
import { BaseLLMProvider } from '../../interfaces/BaseLLMProvider';

/**
 * LMStudio provider implementation
 * LMStudio uses OpenAI-compatible API, so we can reuse OpenAI client
 * Supports local models running via LMStudio
 */
export class LMStudioProvider extends BaseLLMProvider {
  name = LLMProvider.LMSTUDIO;
  supportsMCP = false; // Local models don't typically support structured MCP
  supportsTools = true; // Supports tools via OpenAI-compatible API
  maxTokens: number;
  costPerToken: { input: number; output: number };

  private client!: OpenAI;

  constructor() {
    super();
    // Default limits for local models
    this.maxTokens = 4096;
    this.costPerToken = { input: 0, output: 0 }; // Free (local)
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    // LMStudio default URL is http://localhost:1234/v1
    const baseURL = config.baseURL || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
    
    // LMStudio doesn't require API key, but some setups might use it
    const apiKey = config.apiKey || process.env.LMSTUDIO_API_KEY || 'lm-studio';

    this.client = new OpenAI({
      apiKey,
      baseURL,
    });

    // Update max tokens based on model if known
    const modelKey = config.model as keyof typeof LLM_MAX_TOKENS.openai;
    if (LLM_MAX_TOKENS.openai[modelKey]) {
      this.maxTokens = LLM_MAX_TOKENS.openai[modelKey];
    } else {
      // Default for local models
      this.maxTokens = config.maxTokens || 4096;
    }

    this.logger.info('LMStudio provider initialized', {
      model: config.model,
      baseURL,
      maxTokens: this.maxTokens,
    });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    this.ensureInitialized();

    try {
      const messages = this.buildMessages(prompt, options);

      // Build tools if provided
      const tools = options.tools?.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      // Use model from options if provided, otherwise use config model
      const modelToUse = options.model || this.config.model;

      const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: modelToUse,
        messages,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? this.maxTokens,
        top_p: options.topP ?? this.config.topP,
        frequency_penalty: options.frequencyPenalty ?? this.config.frequencyPenalty,
        presence_penalty: options.presencePenalty ?? this.config.presencePenalty,
        stop: options.stopSequences ?? this.config.stopSequences,
        ...(tools && tools.length > 0 ? { tools } : {}),
      };

      this.logger.info('Sending completion request to LMStudio', {
        model: requestParams.model,
        messageCount: messages.length,
        hasTools: !!tools,
        toolCount: tools?.length || 0,
      });

      const response = await this.client.chat.completions.create(requestParams);

      const choice = response.choices[0];
      const usage = response.usage;

      if (!choice) {
        throw new Error('Invalid response from LMStudio API');
      }

      const tokensUsed = usage
        ? {
            input: usage.prompt_tokens,
            output: usage.completion_tokens,
            total: usage.total_tokens,
          }
        : {
            input: this.estimateTokens(prompt),
            output: this.estimateTokens(choice.message.content || ''),
            total: this.estimateTokens(prompt) + this.estimateTokens(choice.message.content || ''),
          };

      const cost = this.calculateCost(tokensUsed);

      // Handle tool calls
      const toolCalls =
        choice.message.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          parameters: JSON.parse(tc.function.arguments),
          timestamp: new Date().toISOString(),
        })) || [];

      const result: CompletionResponse = {
        content: choice.message.content || '',
        provider: this.name,
        model: modelToUse,
        tokensUsed,
        cost,
        finishReason: this.mapFinishReason(choice.finish_reason),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      this.logger.info('LMStudio completion successful', {
        tokens: tokensUsed.total,
        finishReason: result.finishReason,
        hasToolCalls: toolCalls.length > 0,
      });

      return result;
    } catch (error: any) {
      this.logger.error('LMStudio completion failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `LMStudio API error: ${error.message}`,
        { provider: this.name, model: this.config.model, originalError: error }
      );
    }
  }

  async *stream(prompt: string, options: StreamOptions): AsyncGenerator<Token> {
    this.ensureInitialized();

    try {
      const messages = this.buildMessages(prompt, options);

      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? this.config.maxTokens ?? this.maxTokens,
        stream: true,
      });

      let index = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content || '';

        if (content) {
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
      }

      // Final token to indicate completion
      yield {
        content: '',
        index,
        isComplete: true,
      };

      if (options.onComplete) {
        const estimatedTokens = this.estimateTokens(prompt);
        const tokensUsed = {
          input: estimatedTokens,
          output: 0,
          total: estimatedTokens,
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
      this.logger.error('LMStudio streaming failed', { error: error.message });

      if (options.onError) {
        options.onError(error);
      }

      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `LMStudio streaming error: ${error.message}`,
        { provider: this.name, model: this.config.model }
      );
    }
  }

  async embeddings(text: string): Promise<EmbeddingResponse> {
    this.ensureInitialized();

    try {
      // LMStudio may support embeddings depending on the model
      const response = await this.client.embeddings.create({
        model: this.config.model,
        input: text,
      });

      const embedding = response.data[0].embedding;
      const tokensUsed = response.usage.total_tokens;

      return {
        embedding,
        provider: this.name,
        model: this.config.model,
        tokensUsed,
        cost: {
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          currency: 'USD',
        },
      };
    } catch (error: any) {
      this.logger.error('LMStudio embeddings failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `LMStudio embeddings error: ${error.message}. Make sure your model supports embeddings.`
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check: try to list models
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private mapFinishReason(
    reason: string | null | undefined
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
      case 'function_call':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}

