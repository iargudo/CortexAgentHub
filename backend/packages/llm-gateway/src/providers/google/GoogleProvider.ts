import { GoogleGenerativeAI } from '@google/generative-ai';
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
 * Google Gemini provider implementation
 * Supports Gemini Pro, Gemini Ultra
 */
export class GoogleProvider extends BaseLLMProvider {
  name = LLMProvider.GOOGLE;
  supportsMCP = false;
  supportsTools = true;
  maxTokens: number;
  costPerToken: { input: number; output: number };

  private client!: GoogleGenerativeAI;
  private model!: any;

  constructor() {
    super();
    // Default to Gemini Pro costs
    this.maxTokens = 32000;
    this.costPerToken = { input: 0.00000025, output: 0.0000005 };
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    const apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('Google API key is required');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: config.model });

    // Update costs and max tokens based on model
    const modelKey = config.model as keyof typeof LLM_COSTS.google;
    if (LLM_COSTS.google[modelKey]) {
      this.costPerToken = LLM_COSTS.google[modelKey];
    }
    if (LLM_MAX_TOKENS.google[modelKey]) {
      this.maxTokens = LLM_MAX_TOKENS.google[modelKey];
    }

    this.logger.info('Google provider initialized', {
      model: config.model,
      maxTokens: this.maxTokens,
    });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    this.ensureInitialized();

    try {
      const fullPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

      this.logger.debug('Sending completion request to Google', {
        model: this.config.model,
        promptLength: fullPrompt.length,
      });

      const generationConfig = {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        topP: options.topP ?? this.config.topP,
        maxOutputTokens: options.maxTokens ?? this.config.maxTokens,
        stopSequences: options.stopSequences ?? this.config.stopSequences,
      };

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig,
      });

      const response = result.response;
      const text = response.text();

      // Google doesn't provide exact token counts, estimate them
      const tokensUsed = {
        input: this.estimateTokens(fullPrompt),
        output: this.estimateTokens(text),
        total: this.estimateTokens(fullPrompt) + this.estimateTokens(text),
      };

      const cost = this.calculateCost(tokensUsed);

      const completionResponse: CompletionResponse = {
        content: text,
        provider: this.name,
        model: this.config.model,
        tokensUsed,
        cost,
        finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
        metadata: {
          safetyRatings: response.candidates?.[0]?.safetyRatings,
        },
      };

      this.logger.info('Completion successful', {
        tokens: tokensUsed.total,
        cost: cost.totalCost,
      });

      return completionResponse;
    } catch (error: any) {
      this.logger.error('Google completion failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Google API error: ${error.message}`,
        { provider: this.name, model: this.config.model, originalError: error }
      );
    }
  }

  async *stream(prompt: string, options: StreamOptions): AsyncGenerator<Token> {
    this.ensureInitialized();

    try {
      const fullPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

      const generationConfig = {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? this.config.maxTokens,
      };

      const result = await this.model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig,
      });

      let index = 0;

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();

        if (chunkText) {
          const token: Token = {
            content: chunkText,
            index: index++,
            isComplete: false,
          };

          if (options.onToken) {
            options.onToken(chunkText);
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
        const tokensUsed = {
          input: this.estimateTokens(fullPrompt),
          output: 0, // Unknown in streaming
          total: this.estimateTokens(fullPrompt),
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
      this.logger.error('Google streaming failed', { error: error.message });

      if (options.onError) {
        options.onError(error);
      }

      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Google streaming error: ${error.message}`,
        { provider: this.name, model: this.config.model }
      );
    }
  }

  async embeddings(text: string): Promise<EmbeddingResponse> {
    this.ensureInitialized();

    try {
      // Google uses a separate embedding model
      const embeddingModel = this.client.getGenerativeModel({ model: 'embedding-001' });

      const result = await embeddingModel.embedContent(text);
      const embedding = result.embedding.values;

      const tokensUsed = this.estimateTokens(text);

      return {
        embedding,
        provider: this.name,
        model: 'embedding-001',
        tokensUsed,
        cost: {
          inputCost: 0, // Google embeddings are free in preview
          outputCost: 0,
          totalCost: 0,
          currency: 'USD',
        },
      };
    } catch (error: any) {
      this.logger.error('Google embeddings failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Google embeddings error: ${error.message}`
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.model.generateContent('ping');
      return !!result.response;
    } catch {
      return false;
    }
  }

  private mapFinishReason(
    reason: string | undefined
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
