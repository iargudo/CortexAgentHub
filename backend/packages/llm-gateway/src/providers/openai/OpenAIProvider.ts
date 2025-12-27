import OpenAI from 'openai';
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
 * OpenAI provider implementation
 * Supports GPT-3.5-turbo, GPT-4, GPT-4-turbo
 */
export class OpenAIProvider extends BaseLLMProvider {
  name = LLMProvider.OPENAI;
  supportsMCP = true;
  supportsTools = true;
  maxTokens: number;
  costPerToken: { input: number; output: number };

  private client!: OpenAI;

  constructor() {
    super();
    // Default to GPT-3.5-turbo costs, will be updated on initialize
    this.maxTokens = 16385;
    this.costPerToken = { input: 0.0000005, output: 0.0000015 };
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
    });

    // Update costs and max tokens based on model
    const modelKey = config.model as keyof typeof LLM_COSTS.openai;
    if (LLM_COSTS.openai[modelKey]) {
      this.costPerToken = LLM_COSTS.openai[modelKey];
    }
    if (LLM_MAX_TOKENS.openai[modelKey]) {
      this.maxTokens = LLM_MAX_TOKENS.openai[modelKey];
    }

    this.logger.info('OpenAI provider initialized', {
      model: config.model,
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
        max_tokens: options.maxTokens ?? this.config.maxTokens,
        top_p: options.topP ?? this.config.topP,
        frequency_penalty: options.frequencyPenalty ?? this.config.frequencyPenalty,
        presence_penalty: options.presencePenalty ?? this.config.presencePenalty,
        stop: options.stopSequences ?? this.config.stopSequences,
        ...(tools && tools.length > 0 ? { tools } : {}),
      };

      this.logger.info('Sending completion request to OpenAI', {
        model: requestParams.model,
        messageCount: messages.length,
        hasTools: !!tools,
        toolCount: tools?.length || 0,
        toolNames: tools?.map((t) => t.function.name) || [],
        systemPromptPreview: options.systemPrompt?.substring(0, 200) || 'None',
      });

      const response = await this.client.chat.completions.create(requestParams);

      const choice = response.choices[0];
      const usage = response.usage;

      if (!choice || !usage) {
        throw new Error('Invalid response from OpenAI API');
      }

      const tokensUsed = {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        total: usage.total_tokens,
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

      this.logger.info('OpenAI tool calls parsed', {
        toolCallsCount: toolCalls.length,
        toolCallsNames: toolCalls.map((tc) => tc.name),
        finishReason: choice.finish_reason,
      });

      const result: CompletionResponse = {
        content: choice.message.content || '',
        provider: this.name,
        model: modelToUse,
        tokensUsed,
        cost,
        finishReason: this.mapFinishReason(choice.finish_reason),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      this.logger.info('Completion successful', {
        tokens: tokensUsed.total,
        cost: cost.totalCost,
        finishReason: result.finishReason,
        hasToolCalls: toolCalls.length > 0,
      });

      return result;
    } catch (error: any) {
      this.logger.error('OpenAI completion failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `OpenAI API error: ${error.message}`,
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
        max_tokens: options.maxTokens ?? this.config.maxTokens,
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
        // Note: streaming doesn't provide token usage, would need to estimate
        const estimatedTokens = this.estimateTokens(prompt);
        const tokensUsed = {
          input: estimatedTokens,
          output: 0, // Unknown in streaming
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
      this.logger.error('OpenAI streaming failed', { error: error.message });

      if (options.onError) {
        options.onError(error);
      }

      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `OpenAI streaming error: ${error.message}`,
        { provider: this.name, model: this.config.model }
      );
    }
  }

  async embeddings(text: string): Promise<EmbeddingResponse> {
    this.ensureInitialized();

    try {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text,
      });

      const embedding = response.data[0].embedding;
      const tokensUsed = response.usage.total_tokens;

      // Embedding costs
      const embeddingCost = tokensUsed * 0.0000001; // $0.0001 per 1K tokens

      return {
        embedding,
        provider: this.name,
        model: 'text-embedding-ada-002',
        tokensUsed,
        cost: {
          inputCost: embeddingCost,
          outputCost: 0,
          totalCost: embeddingCost,
          currency: 'USD',
        },
      };
    } catch (error: any) {
      this.logger.error('OpenAI embeddings failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `OpenAI embeddings error: ${error.message}`
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check: list models
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
