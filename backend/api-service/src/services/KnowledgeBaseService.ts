import { Pool } from 'pg';
import { createLogger } from '@cortex/shared';
import { EmbeddingService } from './EmbeddingService';
import { getQueueManager, QueueName } from '@cortex/queue-service';

const logger = createLogger('KnowledgeBaseService');

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  embedding_model_id?: string;
  chunk_size: number;
  chunk_overlap: number;
  chunking_strategy: string;
  active: boolean;
  metadata: any;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeBaseDocument {
  id: string;
  knowledge_base_id: string;
  title?: string;
  content: string;
  source_type: string;
  source_url?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  metadata: any;
  status: string;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ChunkResult {
  chunks: string[];
  metadata: Array<{ startIndex: number; endIndex: number; tokenCount?: number }>;
}

/**
 * Knowledge Base Service
 * Manages knowledge bases, documents, and embeddings
 */
export class KnowledgeBaseService {
  private queueManager: ReturnType<typeof getQueueManager> | null = null;
  private useQueue: boolean = false;

  constructor(
    private db: Pool,
    private embeddingService: EmbeddingService,
    enableQueue: boolean = false
  ) {
    // Try to get queue manager if enabled
    if (enableQueue) {
      try {
        this.queueManager = getQueueManager();
        this.useQueue = true;
        logger.info('Document processing queue enabled');
      } catch (error: any) {
        logger.warn('Queue manager not available, using synchronous processing', {
          error: error.message,
        });
        this.useQueue = false;
      }
    }
  }

  /**
   * Create a new knowledge base
   */
  async createKnowledgeBase(data: {
    name: string;
    description?: string;
    embedding_model_id?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    chunking_strategy?: string;
    metadata?: any;
  }): Promise<KnowledgeBase> {
    const result = await this.db.query(
      `INSERT INTO knowledge_bases 
       (name, description, embedding_model_id, chunk_size, chunk_overlap, chunking_strategy, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.name,
        data.description || null,
        data.embedding_model_id || null,
        data.chunk_size || 1000,
        data.chunk_overlap || 200,
        data.chunking_strategy || 'recursive',
        JSON.stringify(data.metadata || {}),
      ]
    );

    return this.mapKnowledgeBase(result.rows[0]);
  }

  /**
   * Get knowledge base by ID
   */
  async getKnowledgeBase(id: string): Promise<KnowledgeBase | null> {
    const result = await this.db.query(
      'SELECT * FROM knowledge_bases WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapKnowledgeBase(result.rows[0]);
  }

  /**
   * List all knowledge bases
   */
  async listKnowledgeBases(activeOnly: boolean = false): Promise<KnowledgeBase[]> {
    let query = 'SELECT * FROM knowledge_bases';
    const params: any[] = [];

    if (activeOnly) {
      query += ' WHERE active = true';
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query(query, params);
    return result.rows.map((row) => this.mapKnowledgeBase(row));
  }

  /**
   * Update knowledge base
   */
  async updateKnowledgeBase(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      embedding_model_id: string;
      chunk_size: number;
      chunk_overlap: number;
      chunking_strategy: string;
      active: boolean;
      metadata: any;
    }>
  ): Promise<KnowledgeBase> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.embedding_model_id !== undefined) {
      fields.push(`embedding_model_id = $${paramIndex++}`);
      values.push(updates.embedding_model_id);
    }
    if (updates.chunk_size !== undefined) {
      fields.push(`chunk_size = $${paramIndex++}`);
      values.push(updates.chunk_size);
    }
    if (updates.chunk_overlap !== undefined) {
      fields.push(`chunk_overlap = $${paramIndex++}`);
      values.push(updates.chunk_overlap);
    }
    if (updates.chunking_strategy !== undefined) {
      fields.push(`chunking_strategy = $${paramIndex++}`);
      values.push(updates.chunking_strategy);
    }
    if (updates.active !== undefined) {
      fields.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) {
      const kb = await this.getKnowledgeBase(id);
      if (!kb) {
        throw new Error('Knowledge base not found');
      }
      return kb;
    }

    values.push(id);
    const result = await this.db.query(
      `UPDATE knowledge_bases 
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    return this.mapKnowledgeBase(result.rows[0]);
  }

  /**
   * Delete knowledge base (cascades to documents and embeddings)
   */
  async deleteKnowledgeBase(id: string): Promise<void> {
    await this.db.query('DELETE FROM knowledge_bases WHERE id = $1', [id]);
  }

  /**
   * Add document to knowledge base
   */
  async addDocument(
    knowledgeBaseId: string,
    data: {
      title?: string;
      content: string;
      source_type?: string;
      source_url?: string;
      file_name?: string;
      file_type?: string;
      file_size?: number;
      metadata?: any;
    }
  ): Promise<KnowledgeBaseDocument> {
    try {
      logger.info('KnowledgeBaseService.addDocument called', {
        knowledgeBaseId,
        hasContent: !!data.content,
        contentLength: data.content?.length || 0,
        fileName: data.file_name,
        fileType: data.file_type,
        fileSize: data.file_size,
        sourceType: data.source_type,
      });

      // Validate required fields
      if (!data.content || data.content.trim().length === 0) {
        throw new Error('Content is required and cannot be empty');
      }

      if (!knowledgeBaseId) {
        throw new Error('Knowledge base ID is required');
      }

      // Verify knowledge base exists
      const kbCheck = await this.db.query(
        'SELECT id FROM knowledge_bases WHERE id = $1',
        [knowledgeBaseId]
      );

      if (kbCheck.rows.length === 0) {
        throw new Error(`Knowledge base with ID ${knowledgeBaseId} not found`);
      }

      logger.info('Inserting document into database', {
        knowledgeBaseId,
        contentLength: data.content.length,
      });

      const result = await this.db.query(
        `INSERT INTO knowledge_base_documents
         (knowledge_base_id, title, content, source_type, source_url, file_name, file_type, file_size, metadata, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING *`,
        [
          knowledgeBaseId,
          data.title || null,
          data.content,
          data.source_type || 'manual',
          data.source_url || null,
          data.file_name || null,
          data.file_type || null,
          data.file_size || null,
          JSON.stringify(data.metadata || {}),
        ]
      );

      if (result.rows.length === 0) {
        throw new Error('Failed to insert document - no rows returned');
      }

      logger.info('Document inserted successfully', {
        documentId: result.rows[0].id,
        knowledgeBaseId,
      });

      const document = this.mapDocument(result.rows[0]);

      // Process document asynchronously using queue if available, otherwise fire-and-forget
      if (this.useQueue && this.queueManager) {
        try {
          await this.queueManager.addJob(
            QueueName.DOCUMENT_PROCESSING,
            'process-document',
            {
              documentId: document.id,
              knowledgeBaseId,
            },
            {
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 5000, // 5 seconds initial delay
              },
            }
          );
          logger.info('Document processing job queued', {
            documentId: document.id,
            knowledgeBaseId,
          });
        } catch (error: any) {
          logger.error('Failed to queue document processing, falling back to direct processing', {
            documentId: document.id,
            error: error.message,
          });
          // Fallback to direct processing if queue fails
          this.processDocument(document.id, knowledgeBaseId).catch((err) => {
            logger.error('Failed to process document', {
              documentId: document.id,
              error: err.message,
            });
          });
        }
      } else {
        // Fallback: process directly (fire-and-forget)
        this.processDocument(document.id, knowledgeBaseId).catch((error) => {
          logger.error('Failed to process document', {
            documentId: document.id,
            error: error.message,
            errorStack: error.stack,
          });
        });
      }

      return document;
    } catch (error: any) {
      logger.error('KnowledgeBaseService.addDocument failed', {
        knowledgeBaseId,
        errorMessage: error.message,
        errorStack: error.stack,
        errorName: error.name,
        errorCode: error.code,
      });
      throw error;
    }
  }

  /**
   * Process document: chunk text and generate embeddings
   */
  async processDocument(
    documentId: string,
    knowledgeBaseId: string
  ): Promise<void> {
    try {
      // Update status to processing
      await this.db.query(
        'UPDATE knowledge_base_documents SET status = $1 WHERE id = $2',
        ['processing', documentId]
      );

      // Get document and knowledge base
      const docResult = await this.db.query(
        'SELECT * FROM knowledge_base_documents WHERE id = $1',
        [documentId]
      );

      if (docResult.rows.length === 0) {
        throw new Error('Document not found');
      }

      const document = this.mapDocument(docResult.rows[0]);
      const kb = await this.getKnowledgeBase(knowledgeBaseId);

      if (!kb) {
        throw new Error('Knowledge base not found');
      }

      // Get embedding model to validate dimensions
      const embeddingModel = await this.embeddingService.getModel(kb.embedding_model_id);
      if (!embeddingModel) {
        throw new Error(`Embedding model not found for knowledge base. Model ID: ${kb.embedding_model_id}`);
      }

      logger.info('Using embedding model', {
        documentId,
        modelId: kb.embedding_model_id,
        modelName: embeddingModel.name,
        provider: embeddingModel.provider,
        expectedDimensions: embeddingModel.dimensions,
      });

      // Chunk the document
      const chunkResult = this.chunkText(document.content, {
        chunkSize: kb.chunk_size,
        chunkOverlap: kb.chunk_overlap,
        strategy: kb.chunking_strategy,
      });

      logger.info('Document chunked', {
        documentId,
        chunksCount: chunkResult.chunks.length,
        contentLength: document.content.length,
      });

      // Generate embeddings for all chunks (batch if possible)
      logger.info('Starting embedding generation', {
        documentId,
        chunksCount: chunkResult.chunks.length,
        modelId: kb.embedding_model_id,
        expectedDimensions: embeddingModel.dimensions,
      });
      
      const embeddingStartTime = Date.now();
      const embeddingResults = await this.embeddingService.generateEmbeddings(
        chunkResult.chunks,
        kb.embedding_model_id
      );
      
      const embeddingTime = Date.now() - embeddingStartTime;
      logger.info('Embeddings generated', {
        documentId,
        embeddingsCount: embeddingResults.length,
        timeMs: embeddingTime,
      });

      // Validate embedding dimensions
      if (embeddingResults.length > 0) {
        const actualDimensions = embeddingResults[0].dimensions;
        if (actualDimensions !== embeddingModel.dimensions) {
          throw new Error(
            `Embedding dimension mismatch: Model "${embeddingModel.name}" expects ${embeddingModel.dimensions} dimensions, but generated embeddings have ${actualDimensions} dimensions. ` +
            `Please check the embedding model configuration or use a different model.`
          );
        }
      }

      // Store embeddings in database
      logger.info('Storing embeddings in database', {
        documentId,
        embeddingsCount: embeddingResults.length,
      });
      
      const storeStartTime = Date.now();
      for (let i = 0; i < chunkResult.chunks.length; i++) {
        const chunk = chunkResult.chunks[i];
        const embedding = embeddingResults[i];

        try {
          await this.db.query(
            `INSERT INTO knowledge_base_embeddings
             (document_id, knowledge_base_id, chunk_index, content, embedding, token_count, metadata)
             VALUES ($1, $2, $3, $4, $5::vector, $6, $7)`,
            [
              documentId,
              knowledgeBaseId,
              i,
              chunk,
              `[${embedding.embedding.join(',')}]`,
              embedding.tokenCount || null,
              JSON.stringify({}),
            ]
          );
          
          // Log progress every 10 chunks
          if ((i + 1) % 10 === 0) {
            logger.debug('Storing embeddings progress', {
              documentId,
              stored: i + 1,
              total: chunkResult.chunks.length,
            });
          }
        } catch (dbError: any) {
          logger.error('Failed to store embedding chunk', {
            documentId,
            chunkIndex: i,
            error: dbError.message,
            code: dbError.code,
          });
          throw dbError;
        }
      }
      
      const storeTime = Date.now() - storeStartTime;
      logger.info('Embeddings stored in database', {
        documentId,
        embeddingsCount: embeddingResults.length,
        timeMs: storeTime,
      });

      // Update document status to completed
      await this.db.query(
        'UPDATE knowledge_base_documents SET status = $1 WHERE id = $2',
        ['completed', documentId]
      );

      logger.info('Document processed successfully', {
        documentId,
        embeddingsCount: chunkResult.chunks.length,
      });
    } catch (error: any) {
      logger.error('Document processing failed', {
        documentId,
        error: error.message,
      });

      // Update document status to failed
      await this.db.query(
        `UPDATE knowledge_base_documents 
         SET status = $1, error_message = $2 
         WHERE id = $3`,
        ['failed', error.message, documentId]
      );

      throw error;
    }
  }

  /**
   * Chunk text based on strategy
   */
  private chunkText(
    text: string,
    options: {
      chunkSize: number;
      chunkOverlap: number;
      strategy: string;
    }
  ): ChunkResult {
    switch (options.strategy) {
      case 'recursive':
        return this.recursiveChunk(text, options.chunkSize, options.chunkOverlap);
      case 'fixed':
        return this.fixedChunk(text, options.chunkSize, options.chunkOverlap);
      case 'semantic':
        // For now, fall back to recursive. Semantic chunking requires NLP analysis
        return this.recursiveChunk(text, options.chunkSize, options.chunkOverlap);
      default:
        return this.recursiveChunk(text, options.chunkSize, options.chunkOverlap);
    }
  }

  /**
   * Recursive chunking (smart splitting by paragraphs, sentences, then characters)
   */
  private recursiveChunk(
    text: string,
    chunkSize: number,
    chunkOverlap: number
  ): ChunkResult {
    const chunks: string[] = [];
    const metadata: Array<{ startIndex: number; endIndex: number }> = [];

    // Try to split by paragraphs first
    const paragraphs = text.split(/\n\s*\n/);

    let currentChunk = '';
    let startIndex = 0;

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 2 <= chunkSize) {
        // Add paragraph to current chunk
        if (currentChunk) {
          currentChunk += '\n\n' + paragraph;
        } else {
          currentChunk = paragraph;
          startIndex = text.indexOf(paragraph);
        }
      } else {
        // Save current chunk
        if (currentChunk) {
          chunks.push(currentChunk);
          metadata.push({
            startIndex,
            endIndex: startIndex + currentChunk.length,
          });

          // Start new chunk with overlap
          const overlapText = currentChunk.slice(-chunkOverlap);
          currentChunk = overlapText + '\n\n' + paragraph;
          startIndex = text.indexOf(paragraph, startIndex + currentChunk.length - chunkOverlap - paragraph.length);
        } else {
          currentChunk = paragraph;
          startIndex = text.indexOf(paragraph);
        }

        // If paragraph itself is too large, split it by sentences
        if (currentChunk.length > chunkSize) {
          const sentences = currentChunk.split(/(?<=[.!?])\s+/);
          let sentenceChunk = '';
          let sentenceStartIndex = startIndex;

          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length + 1 <= chunkSize) {
              if (sentenceChunk) {
                sentenceChunk += ' ' + sentence;
              } else {
                sentenceChunk = sentence;
                sentenceStartIndex = text.indexOf(sentence, sentenceStartIndex);
              }
            } else {
              if (sentenceChunk) {
                chunks.push(sentenceChunk);
                metadata.push({
                  startIndex: sentenceStartIndex,
                  endIndex: sentenceStartIndex + sentenceChunk.length,
                });

                const overlapText = sentenceChunk.slice(-chunkOverlap);
                sentenceChunk = overlapText + ' ' + sentence;
                sentenceStartIndex = text.indexOf(sentence, sentenceStartIndex + sentenceChunk.length - chunkOverlap - sentence.length);
              } else {
                sentenceChunk = sentence;
                sentenceStartIndex = text.indexOf(sentence, sentenceStartIndex);
              }
            }
          }

          if (sentenceChunk) {
            currentChunk = sentenceChunk;
            startIndex = sentenceStartIndex;
          }
        }
      }
    }

    // Add remaining chunk
    if (currentChunk) {
      chunks.push(currentChunk);
      metadata.push({
        startIndex,
        endIndex: startIndex + currentChunk.length,
      });
    }

    return { chunks, metadata };
  }

  /**
   * Fixed-size chunking (simple character-based)
   */
  private fixedChunk(
    text: string,
    chunkSize: number,
    chunkOverlap: number
  ): ChunkResult {
    const chunks: string[] = [];
    const metadata: Array<{ startIndex: number; endIndex: number }> = [];

    let startIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + chunkSize, text.length);
      const chunk = text.slice(startIndex, endIndex);

      chunks.push(chunk);
      metadata.push({
        startIndex,
        endIndex,
      });

      startIndex = endIndex - chunkOverlap;
    }

    return { chunks, metadata };
  }

  /**
   * Get documents for a knowledge base
   */
  async getDocuments(knowledgeBaseId: string): Promise<KnowledgeBaseDocument[]> {
    const result = await this.db.query(
      'SELECT * FROM knowledge_base_documents WHERE knowledge_base_id = $1 ORDER BY created_at DESC',
      [knowledgeBaseId]
    );

    return result.rows.map((row) => this.mapDocument(row));
  }

  /**
   * Delete document (cascades to embeddings)
   */
  async deleteDocument(documentId: string): Promise<void> {
    await this.db.query('DELETE FROM knowledge_base_documents WHERE id = $1', [documentId]);
  }

  /**
   * Map database row to KnowledgeBase object
   */
  private mapKnowledgeBase(row: any): KnowledgeBase {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      embedding_model_id: row.embedding_model_id,
      chunk_size: row.chunk_size,
      chunk_overlap: row.chunk_overlap,
      chunking_strategy: row.chunking_strategy,
      active: row.active,
      metadata: row.metadata || {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Map database row to KnowledgeBaseDocument object
   */
  private mapDocument(row: any): KnowledgeBaseDocument {
    return {
      id: row.id,
      knowledge_base_id: row.knowledge_base_id,
      title: row.title,
      content: row.content,
      source_type: row.source_type,
      source_url: row.source_url,
      file_name: row.file_name,
      file_type: row.file_type,
      file_size: row.file_size,
      metadata: row.metadata || {},
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

