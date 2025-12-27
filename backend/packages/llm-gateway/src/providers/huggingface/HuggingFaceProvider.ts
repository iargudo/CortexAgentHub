import { HfInference } from '@huggingface/inference';
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
 * HuggingFace Inference API provider implementation
 */
export class HuggingFaceProvider extends BaseLLMProvider {
  readonly name = LLMProvider.HUGGINGFACE;
  readonly supportsMCP = false;
  readonly supportsTools = false;
  readonly maxTokens: number;
  readonly costPerToken: { input: number; output: number };

  private client!: HfInference;

  constructor() {
    super();
    // Default costs for HF Inference API
    this.maxTokens = 2048;
    this.costPerToken = { input: 0.000001, output: 0.000001 };
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    const apiKey = config.apiKey || process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      throw new Error('HuggingFace API key is required');
    }

    this.client = new HfInference(apiKey);

    this.logger.info('HuggingFace provider initialized', {
      model: config.model,
      maxTokens: this.maxTokens,
    });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    this.ensureInitialized();

    try {
      const fullPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

      this.logger.debug('Sending completion request to HuggingFace', {
        model: this.config.model,
        promptLength: fullPrompt.length,
      });

      const response = await this.client.textGeneration({
        model: this.config.model,
        inputs: fullPrompt,
        parameters: {
          temperature: options.temperature ?? this.config.temperature ?? 0.7,
          max_new_tokens: options.maxTokens ?? this.config.maxTokens,
          top_p: options.topP ?? this.config.topP,
          return_full_text: false,
        },
      });

      const generatedText = response.generated_text;

      // Estimate token usage
      const tokensUsed = {
        input: this.estimateTokens(fullPrompt),
        output: this.estimateTokens(generatedText),
        total: this.estimateTokens(fullPrompt) + this.estimateTokens(generatedText),
      };

      const cost = this.calculateCost(tokensUsed);

      const result: CompletionResponse = {
        content: generatedText,
        provider: this.name,
        model: this.config.model,
        tokensUsed,
        cost,
        finishReason: 'stop',
      };

      this.logger.info('Completion successful', {
        tokens: tokensUsed.total,
        cost: cost.totalCost,
      });

      return result;
    } catch (error: any) {
      this.logger.error('HuggingFace completion failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `HuggingFace API error: ${error.message}`,
        { provider: this.name, model: this.config.model, originalError: error }
      );
    }
  }

  async *stream(prompt: string, options: StreamOptions): AsyncGenerator<Token> {
    this.ensureInitialized();

    try {
      const fullPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;

      const stream = this.client.textGenerationStream({
        model: this.config.model,
        inputs: fullPrompt,
        parameters: {
          temperature: options.temperature ?? this.config.temperature ?? 0.7,
          max_new_tokens: options.maxTokens ?? this.config.maxTokens,
        },
      });

      let index = 0;
      let fullText = '';

      for await (const chunk of stream) {
        const content = chunk.token.text;

        if (content) {
          fullText += content;

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
        const tokensUsed = {
          input: this.estimateTokens(fullPrompt),
          output: this.estimateTokens(fullText),
          total: this.estimateTokens(fullPrompt) + this.estimateTokens(fullText),
        };

        options.onComplete({
          content: fullText,
          provider: this.name,
          model: this.config.model,
          tokensUsed,
          cost: this.calculateCost(tokensUsed),
          finishReason: 'stop',
        });
      }
    } catch (error: any) {
      this.logger.error('HuggingFace streaming failed', { error: error.message });

      if (options.onError) {
        options.onError(error);
      }

      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `HuggingFace streaming error: ${error.message}`,
        { provider: this.name, model: this.config.model }
      );
    }
  }

  async embeddings(text: string): Promise<EmbeddingResponse> {
    this.ensureInitialized();

    try {
      // Use a default sentence transformer model
      const embeddingModel = this.config.metadata?.embeddingModel || 'sentence-transformers/all-MiniLM-L6-v2';

      const response = await this.client.featureExtraction({
        model: embeddingModel,
        inputs: text,
      });

      // HF returns different formats, normalize to array
      let embedding: number[];
      if (Array.isArray(response)) {
        if (Array.isArray(response[0])) {
          embedding = response[0] as number[];
        } else {
          embedding = response as number[];
        }
      } else {
        throw new Error('Unexpected embedding format from HuggingFace');
      }

      const tokensUsed = this.estimateTokens(text);

      return {
        embedding,
        provider: this.name,
        model: embeddingModel,
        tokensUsed,
        cost: {
          inputCost: 0, // HF embeddings are included in API pricing
          outputCost: 0,
          totalCost: 0,
          currency: 'USD',
        },
      };
    } catch (error: any) {
      this.logger.error('HuggingFace embeddings failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `HuggingFace embeddings error: ${error.message}`
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.textGeneration({
        model: this.config.model,
        inputs: 'ping',
        parameters: {
          max_new_tokens: 5,
        },
      });
      return true;
    } catch {
      return false;
    }
  }
}
