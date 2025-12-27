import { Pool } from 'pg';
import { createLogger } from '@cortex/shared';

const logger = createLogger('EmbeddingService');

export interface EmbeddingModel {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  dimensions: number;
  api_key_encrypted?: string;
  config: any;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  tokenCount?: number;
}

/**
 * Embedding Service
 * Generates vector embeddings using various providers (OpenAI, Cohere, HuggingFace, etc.)
 */
export class EmbeddingService {
  constructor(private db: Pool) {}

  /**
   * Get embedding model configuration
   */
  async getModel(modelId?: string): Promise<EmbeddingModel | null> {
    try {
      if (modelId) {
        const result = await this.db.query(
          'SELECT * FROM embedding_models WHERE id = $1 AND active = true',
          [modelId]
        );
        return result.rows[0] || null;
      }

      // Get default model
      const result = await this.db.query(
        'SELECT * FROM embedding_models WHERE is_default = true AND active = true LIMIT 1'
      );
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Failed to get embedding model', { error: error.message, modelId });
      return null;
    }
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(
    text: string,
    modelId?: string
  ): Promise<EmbeddingResult> {
    // Validate text is not empty
    const trimmedText = text?.trim() || '';
    if (!trimmedText || trimmedText.length === 0) {
      throw new Error('Cannot generate embedding for empty text. Text must contain at least one character.');
    }

    const model = await this.getModel(modelId);
    if (!model) {
      throw new Error('No embedding model available');
    }

    logger.debug('Generating embedding', {
      provider: model.provider,
      model: model.model_name,
      textLength: trimmedText.length,
    });

    switch (model.provider.toLowerCase()) {
      case 'openai':
      case 'azure-openai':
        return await this.generateOpenAIEmbedding(trimmedText, model);
      case 'cohere':
        return await this.generateCohereEmbedding(trimmedText, model);
      case 'huggingface':
        return await this.generateHuggingFaceEmbedding(trimmedText, model);
      case 'local':
        return await this.generateLocalEmbedding(trimmedText, model);
      default:
        throw new Error(`Unsupported embedding provider: ${model.provider}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateEmbeddings(
    texts: string[],
    modelId?: string
  ): Promise<EmbeddingResult[]> {
    const model = await this.getModel(modelId);
    if (!model) {
      throw new Error('No embedding model available');
    }

    // Batch processing for efficiency
    if (model.provider.toLowerCase() === 'openai' || model.provider.toLowerCase() === 'azure-openai') {
      return await this.generateOpenAIEmbeddingsBatch(texts, model);
    }
    
    if (model.provider.toLowerCase() === 'cohere') {
      return await this.generateCohereEmbeddingsBatch(texts, model);
    }

    // Fallback to sequential for other providers
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      const result = await this.generateEmbedding(text, modelId);
      results.push(result);
    }
    return results;
  }

  /**
   * OpenAI / Azure OpenAI embedding
   */
  private async generateOpenAIEmbedding(
    text: string,
    model: EmbeddingModel
  ): Promise<EmbeddingResult> {
    const apiKey = this.getApiKeyForProvider(model.provider, model.api_key_encrypted);
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(`API key is required for ${model.provider} embeddings. Please configure it in the admin or set ${model.provider.toUpperCase()}_API_KEY environment variable.`);
    }
    
    const baseUrl = model.config?.base_url || 'https://api.openai.com/v1';
    const isAzure = model.provider === 'azure-openai';

    const url = isAzure
      ? `${baseUrl}/openai/deployments/${model.model_name}/embeddings?api-version=2024-02-15-preview`
      : `${baseUrl}/embeddings`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isAzure) {
      headers['api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: text,
        model: model.model_name,
        dimensions: model.config?.dimensions || model.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      usage?: { total_tokens?: number };
    };
    const embedding = data.data[0].embedding;
    const tokenCount = data.usage?.total_tokens;

    return {
      embedding,
      dimensions: embedding.length,
      tokenCount,
    };
  }

  /**
   * OpenAI batch embeddings (more efficient)
   */
  private async generateOpenAIEmbeddingsBatch(
    texts: string[],
    model: EmbeddingModel
  ): Promise<EmbeddingResult[]> {
    const apiKey = this.getApiKeyForProvider(model.provider, model.api_key_encrypted);
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(`API key is required for ${model.provider} embeddings. Please configure it in the admin or set ${model.provider.toUpperCase()}_API_KEY environment variable.`);
    }
    
    const baseUrl = model.config?.base_url || 'https://api.openai.com/v1';
    const isAzure = model.provider === 'azure-openai';

    const url = isAzure
      ? `${baseUrl}/openai/deployments/${model.model_name}/embeddings?api-version=2024-02-15-preview`
      : `${baseUrl}/embeddings`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isAzure) {
      headers['api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    logger.info('Generating OpenAI batch embeddings', {
      textsCount: texts.length,
      model: model.model_name,
      provider: model.provider,
      totalChars: texts.reduce((sum, t) => sum + t.length, 0),
    });

    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: texts,
          model: model.model_name,
          dimensions: model.config?.dimensions || model.dimensions,
        }),
        // Increase timeout for large batches
        signal: AbortSignal.timeout(300000), // 5 minutes timeout
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('OpenAI batch embedding failed', {
          status: response.status,
          error,
          textsCount: texts.length,
        });
        throw new Error(`OpenAI batch embedding failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
        usage?: { total_tokens?: number };
      };
      const tokenCount = data.usage?.total_tokens;
      const elapsed = Date.now() - startTime;

      logger.info('OpenAI batch embeddings completed', {
        embeddingsCount: data.data.length,
        tokenCount,
        timeMs: elapsed,
      });

      return data.data.map((item) => ({
        embedding: item.embedding,
        dimensions: item.embedding.length,
        tokenCount: tokenCount ? Math.floor(tokenCount / texts.length) : undefined,
      }));
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        logger.error('OpenAI embedding request timed out', {
          textsCount: texts.length,
          timeMs: Date.now() - startTime,
        });
        throw new Error(`Embedding generation timed out after 5 minutes. The document may be too large. Try splitting it into smaller documents.`);
      }
      throw error;
    }
  }

  /**
   * Cohere embedding
   */
  private async generateCohereEmbedding(
    text: string,
    model: EmbeddingModel
  ): Promise<EmbeddingResult> {
    // Validate text is not empty (double check)
    const trimmedText = text?.trim() || '';
    if (!trimmedText || trimmedText.length === 0) {
      throw new Error('Cannot generate Cohere embedding for empty text. Text must contain at least one character.');
    }

    const apiKey = this.getApiKeyForProvider('cohere', model.api_key_encrypted);
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key is required for Cohere embeddings. Please configure it in the admin or set COHERE_API_KEY environment variable.');
    }
    
    const baseUrl = model.config?.base_url || 'https://api.cohere.ai/v1';

    const response = await fetch(`${baseUrl}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        texts: [trimmedText],
        model: model.model_name,
        input_type: 'search_document',
        truncate: 'END',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere embedding failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      embeddings: number[][];
    };
    return {
      embedding: data.embeddings[0],
      dimensions: data.embeddings[0].length,
    };
  }

  /**
   * Cohere batch embeddings (more efficient)
   */
  private async generateCohereEmbeddingsBatch(
    texts: string[],
    model: EmbeddingModel
  ): Promise<EmbeddingResult[]> {
    const apiKey = this.getApiKeyForProvider('cohere', model.api_key_encrypted);
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key is required for Cohere embeddings. Please configure it in the admin or set COHERE_API_KEY environment variable.');
    }
    
    const baseUrl = model.config?.base_url || 'https://api.cohere.ai/v1';

    // Filter out empty texts and trim
    const validTexts = texts
      .map(t => t?.trim() || '')
      .filter(t => t.length > 0);

    if (validTexts.length === 0) {
      throw new Error('Cannot generate Cohere embeddings: all texts are empty. At least one non-empty text is required.');
    }

    // Cohere supports up to 96 texts per batch
    const batchSize = 96;
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < validTexts.length; i += batchSize) {
      const batch = validTexts.slice(i, i + batchSize);
      
      const response = await fetch(`${baseUrl}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          texts: batch,
          model: model.model_name,
          input_type: 'search_document',
          truncate: 'END',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cohere batch embedding failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        embeddings: number[][];
      };
      results.push(...data.embeddings.map((embedding) => ({
        embedding,
        dimensions: embedding.length,
      })));
    }

    return results;
  }

  /**
   * HuggingFace embedding
   */
  private async generateHuggingFaceEmbedding(
    text: string,
    model: EmbeddingModel
  ): Promise<EmbeddingResult> {
    const apiKey = this.getApiKeyForProvider('huggingface', model.api_key_encrypted);
    const baseUrl = model.config?.base_url || 'https://api-inference.huggingface.co';

    const response = await fetch(`${baseUrl}/pipeline/feature-extraction/${model.model_name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        inputs: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HuggingFace embedding failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as number[] | number[][];
    // HuggingFace returns array of arrays, take first
    const embedding = Array.isArray(data[0]) ? (data as number[][])[0] : (data as number[]);
    return {
      embedding,
      dimensions: embedding.length,
    };
  }

  /**
   * Local embedding (for future implementation with transformers.js or similar)
   */
  private async generateLocalEmbedding(
    text: string,
    model: EmbeddingModel
  ): Promise<EmbeddingResult> {
    // TODO: Implement local embedding using transformers.js or ONNX runtime
    throw new Error('Local embeddings not yet implemented. Use OpenAI, Cohere, or HuggingFace.');
  }

  /**
   * Decrypt API key (simple implementation - should use proper encryption in production)
   */
  private decryptApiKey(encrypted?: string): string {
    if (!encrypted || encrypted.trim() === '') {
      // Try to get from environment based on provider
      // This will be determined by the model provider
      return process.env.OPENAI_API_KEY || process.env.COHERE_API_KEY || process.env.HUGGINGFACE_API_KEY || '';
    }

    // TODO: Implement proper decryption
    // For now, assume it's stored as plain text (not recommended for production)
    // In production, use proper encryption like AES-256-GCM
    return encrypted;
  }

  /**
   * Get API key for a specific provider
   */
  private getApiKeyForProvider(provider: string, encrypted?: string): string {
    // First try to decrypt/use the stored key
    if (encrypted && encrypted.trim() !== '') {
      return encrypted; // For now, stored as plain text (TODO: implement encryption)
    }

    // Fallback to environment variables
    switch (provider.toLowerCase()) {
      case 'openai':
      case 'azure-openai':
        return process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || '';
      case 'cohere':
        return process.env.COHERE_API_KEY || '';
      case 'huggingface':
        return process.env.HUGGINGFACE_API_KEY || '';
      default:
        return '';
    }
  }
}

