import { Pool } from 'pg';
import { createLogger } from '@cortex/shared';
import { EmbeddingService, EmbeddingResult } from './EmbeddingService';

const logger = createLogger('RAGService');

export interface RAGResult {
  chunks: RAGChunk[];
  queryEmbedding: number[];
  totalResults: number;
  processingTimeMs: number;
}

export interface RAGChunk {
  id: string;
  content: string;
  documentId: string;
  documentTitle?: string;
  chunkIndex: number;
  similarity: number;
  metadata: any;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  knowledgeBaseMetadata?: any;
}

export interface RAGQuery {
  flowId: string;
  knowledgeBaseIds?: string[];
  queryText: string;
  maxResults?: number;
  similarityThreshold?: number;
}

/**
 * RAG Service
 * Retrieval-Augmented Generation service using pgvector for similarity search
 */
export class RAGService {
  constructor(
    private db: Pool,
    private embeddingService: EmbeddingService
  ) {}

  /**
   * Search knowledge bases for relevant context
   */
  async search(
    query: RAGQuery
  ): Promise<RAGResult> {
    const startTime = Date.now();

    try {
      // Validate query text is not empty
      const trimmedQueryText = query.queryText?.trim() || '';
      if (!trimmedQueryText || trimmedQueryText.length === 0) {
        logger.debug('RAG search skipped: empty query text', {
          flowId: query.flowId,
          queryText: query.queryText,
        });
        // Return empty result with zero vector embedding
        // Using a zero vector of typical embedding dimensions (768 for Cohere, 1536 for OpenAI)
        const emptyEmbedding = new Array(768).fill(0);
        return {
          chunks: [],
          queryEmbedding: emptyEmbedding,
          totalResults: 0,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // 1. Get knowledge bases for this flow first (to determine which model to use)
      const knowledgeBases = await this.getKnowledgeBasesForFlow(
        query.flowId,
        query.knowledgeBaseIds
      );

      if (knowledgeBases.length === 0) {
        logger.debug('No knowledge bases found for flow', { flowId: query.flowId });
        const embeddingResult = await this.embeddingService.generateEmbedding(trimmedQueryText);
        return {
          chunks: [],
          queryEmbedding: embeddingResult.embedding,
          totalResults: 0,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // 2. Get the embedding model ID from the first knowledge base (all KBs should use same model)
      const kbResult = await this.db.query(
        'SELECT embedding_model_id FROM knowledge_bases WHERE id = $1',
        [knowledgeBases[0].knowledge_base_id]
      );
      const embeddingModelId = kbResult.rows[0]?.embedding_model_id;

      // 3. Generate embedding for query using the same model as the knowledge base
      logger.debug('Generating query embedding', {
        flowId: query.flowId,
        queryLength: trimmedQueryText.length,
        modelId: embeddingModelId,
      });

      const embeddingResult = await this.embeddingService.generateEmbedding(
        trimmedQueryText,
        embeddingModelId
      );
      const queryEmbedding = embeddingResult.embedding;

      // 4. Search each knowledge base and combine results
      const allResults: Array<RAGChunk & { similarity: number; priority: number }> = [];

      for (const kb of knowledgeBases) {
        const kbResults = await this.searchKnowledgeBase(
          kb.knowledge_base_id,
          queryEmbedding,
          kb.max_results || query.maxResults || 5,
          kb.similarity_threshold || query.similarityThreshold || 0.70
        );

        // Add priority and KB metadata for sorting (lower priority = higher importance)
        allResults.push(
          ...kbResults.map((r) => ({
            ...r,
            priority: kb.priority,
            knowledgeBaseId: kb.knowledge_base_id,
            knowledgeBaseName: kb.knowledge_base_name,
            knowledgeBaseMetadata: kb.knowledge_base_metadata,
          }))
        );
      }

      // 4. Sort by priority first, then similarity
      allResults.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return b.similarity - a.similarity;
      });

      // 5. Take top N results (increase default to get more context)
      const maxResults = query.maxResults || 8; // Increased from 5 to 8 for better context
      const topResults = allResults.slice(0, maxResults);

      // 6. Format results
      const chunks: RAGChunk[] = topResults.map((r) => ({
        id: r.id,
        content: r.content,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        chunkIndex: r.chunkIndex,
        similarity: r.similarity,
        metadata: r.metadata,
        knowledgeBaseId: r.knowledgeBaseId,
        knowledgeBaseName: r.knowledgeBaseName,
        knowledgeBaseMetadata: r.knowledgeBaseMetadata,
      }));

      const processingTimeMs = Date.now() - startTime;

      logger.info('RAG search completed', {
        flowId: query.flowId,
        knowledgeBasesCount: knowledgeBases.length,
        totalResults: allResults.length,
        topResults: chunks.length,
        processingTimeMs,
      });

      // 7. Log query (async, don't wait)
      this.logQuery(query.flowId, knowledgeBases[0]?.knowledge_base_id, trimmedQueryText, queryEmbedding, chunks.length, processingTimeMs)
        .catch((err) => logger.debug('Failed to log RAG query', { error: err.message }));

      return {
        chunks,
        queryEmbedding,
        totalResults: chunks.length,
        processingTimeMs,
      };
    } catch (error: any) {
      logger.error('RAG search failed', {
        error: error.message,
        flowId: query.flowId,
        queryLength: query.queryText?.length || 0,
        queryText: query.queryText?.substring(0, 100) || '',
      });
      throw error;
    }
  }

  /**
   * Get knowledge bases assigned to a flow
   */
  private async getKnowledgeBasesForFlow(
    flowId: string,
    specificKbIds?: string[]
  ): Promise<Array<{
    knowledge_base_id: string;
    priority: number;
    similarity_threshold: number;
    max_results: number;
    knowledge_base_name: string;
    knowledge_base_description: string;
    knowledge_base_metadata: any;
  }>> {
    let query = `
      SELECT 
        fkb.knowledge_base_id,
        fkb.priority,
        fkb.similarity_threshold,
        fkb.max_results,
        kb.name as knowledge_base_name,
        kb.description as knowledge_base_description,
        kb.metadata as knowledge_base_metadata
      FROM flow_knowledge_bases fkb
      INNER JOIN knowledge_bases kb ON kb.id = fkb.knowledge_base_id
      WHERE fkb.flow_id = $1 
        AND fkb.active = true 
        AND kb.active = true
    `;

    const params: any[] = [flowId];

    if (specificKbIds && specificKbIds.length > 0) {
      query += ` AND fkb.knowledge_base_id = ANY($2)`;
      params.push(specificKbIds);
    }

    query += ` ORDER BY fkb.priority ASC, fkb.created_at ASC`;

    const result = await this.db.query(query, params);
    return result.rows.map((row) => ({
      ...row,
      knowledge_base_metadata: row.knowledge_base_metadata || {},
    }));
  }

  /**
   * Search a specific knowledge base using vector similarity
   */
  private async searchKnowledgeBase(
    knowledgeBaseId: string,
    queryEmbedding: number[],
    maxResults: number,
    similarityThreshold: number
  ): Promise<Array<RAGChunk & { similarity: number }>> {
    // Convert embedding array to PostgreSQL vector format
    const embeddingVector = `[${queryEmbedding.join(',')}]`;

    // Use cosine similarity (pgvector built-in function)
    const query = `
      SELECT 
        kbe.id,
        kbe.content,
        kbe.document_id as "documentId",
        kbd.title as "documentTitle",
        kbe.chunk_index as "chunkIndex",
        kbe.metadata,
        1 - (kbe.embedding <=> $1::vector) as similarity
      FROM knowledge_base_embeddings kbe
      INNER JOIN knowledge_base_documents kbd ON kbd.id = kbe.document_id
      WHERE kbe.knowledge_base_id = $2
        AND kbd.status = 'completed'
        AND 1 - (kbe.embedding <=> $1::vector) >= $3
      ORDER BY kbe.embedding <=> $1::vector
      LIMIT $4
    `;

    const result = await this.db.query(query, [
      embeddingVector,
      knowledgeBaseId,
      similarityThreshold,
      maxResults,
    ]);

    return result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      chunkIndex: row.chunkIndex,
      similarity: parseFloat(row.similarity),
      metadata: row.metadata || {},
    }));
  }

  /**
   * Format RAG context for LLM prompt
   */
  formatContextForPrompt(chunks: RAGChunk[]): string {
    if (chunks.length === 0) {
      return '';
    }

    let context = '\n\n## ⚠️ INFORMACIÓN DE BASE DE CONOCIMIENTO - USAR SOLO ESTA INFORMACIÓN ⚠️\n\n';
    context += 'IMPORTANTE: La siguiente información proviene de la base de conocimiento oficial.\n';
    context += 'DEBES usar ÚNICAMENTE estos datos. NO inventes, asumas o modifiques precios o características.\n\n';
    
    // Group chunks by knowledge base to include KB metadata
    const chunksByKB = new Map<string, RAGChunk[]>();
    const kbMetadata = new Map<string, { name: string; metadata: any }>();
    
    chunks.forEach((chunk) => {
      const kbId = chunk.knowledgeBaseId || 'unknown';
      if (!chunksByKB.has(kbId)) {
        chunksByKB.set(kbId, []);
        if (chunk.knowledgeBaseName) {
          kbMetadata.set(kbId, {
            name: chunk.knowledgeBaseName,
            metadata: chunk.knowledgeBaseMetadata || {},
          });
        }
      }
      chunksByKB.get(kbId)!.push(chunk);
    });
    
    // Format context with KB metadata
    chunksByKB.forEach((kbChunks, kbId) => {
      const kbInfo = kbMetadata.get(kbId);
      
      if (kbInfo) {
        context += `\n📚 BASE DE CONOCIMIENTO: ${kbInfo.name}\n`;
        
        // Include KB metadata if available
        if (kbInfo.metadata && Object.keys(kbInfo.metadata).length > 0) {
          context += '📋 Metadata de la Base de Conocimiento:\n';
          Object.entries(kbInfo.metadata).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
              context += `  • ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
            }
          });
          context += '\n';
        }
      }
      
      context += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      
      kbChunks.forEach((chunk, index) => {
        context += `[Fuente ${index + 1}] ${chunk.documentTitle || 'Documento'}\n`;
        context += `${chunk.content}\n\n`;
        if (chunk.metadata?.source_url) {
          context += `Fuente: ${chunk.metadata.source_url}\n\n`;
        }
        // Include document metadata if available
        if (chunk.metadata && Object.keys(chunk.metadata).length > 0) {
          const relevantMetadata = { ...chunk.metadata };
          delete relevantMetadata.source_url; // Already shown above
          if (Object.keys(relevantMetadata).length > 0) {
            context += 'Metadata del documento:\n';
            Object.entries(relevantMetadata).forEach(([key, value]) => {
              if (value !== null && value !== undefined && value !== '') {
                context += `  • ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
              }
            });
            context += '\n';
          }
        }
        context += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      });
    });

    context += 'FIN DE INFORMACIÓN DE BASE DE CONOCIMIENTO\n';
    context += 'Recuerda: Usa SOLO la información de arriba. Los precios deben ser EXACTOS según lo indicado.\n\n';

    return context;
  }

  /**
   * Log RAG query for analytics
   */
  private async logQuery(
    flowId: string,
    knowledgeBaseId: string | undefined,
    queryText: string,
    queryEmbedding: number[],
    resultsCount: number,
    processingTimeMs: number
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO rag_queries 
         (flow_id, knowledge_base_id, query_text, query_embedding, results_count, processing_time_ms)
         VALUES ($1, $2, $3, $4::vector, $5, $6)`,
        [
          flowId,
          knowledgeBaseId,
          queryText,
          `[${queryEmbedding.join(',')}]`,
          resultsCount,
          processingTimeMs,
        ]
      );
    } catch (error: any) {
      // Don't throw - logging is non-critical
      logger.debug('Failed to log RAG query', { error: error.message });
    }
  }
}

