import { FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { AppError, createLogger } from '@cortex/shared';
import {
  KnowledgeBaseService,
  EmbeddingService,
  RAGService,
  DocumentParserService,
} from '../services';

const logger = createLogger('KnowledgeBasesController');

/**
 * Knowledge Bases Controller
 * Handles CRUD operations for knowledge bases, documents, and RAG functionality
 */
export class KnowledgeBasesController {
  private kbService: KnowledgeBaseService;
  private embeddingService: EmbeddingService;
  private ragService: RAGService;
  private documentParser: DocumentParserService;

  constructor(private db: Pool, enableQueue: boolean = false) {
    this.embeddingService = new EmbeddingService(db);
    this.kbService = new KnowledgeBaseService(db, this.embeddingService, enableQueue);
    this.ragService = new RAGService(db, this.embeddingService);
    this.documentParser = new DocumentParserService();
  }

  // ============================================================
  // KNOWLEDGE BASES CRUD
  // ============================================================

  /**
   * List all knowledge bases
   * GET /api/admin/knowledge-bases
   */
  async listKnowledgeBases(
    request: FastifyRequest<{
      Querystring: {
        activeOnly?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const activeOnly = request.query.activeOnly === 'true';
      const knowledgeBases = await this.kbService.listKnowledgeBases(activeOnly);

      // Add stats for each knowledge base
      const knowledgeBasesWithStats = await Promise.all(
        knowledgeBases.map(async (kb) => {
          // Get documents count and stats
          const docsResult = await this.db.query(
            `SELECT 
              COUNT(*) as total,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
              COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
              COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
              COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
             FROM knowledge_base_documents
             WHERE knowledge_base_id = $1`,
            [kb.id]
          );

          const embeddingsResult = await this.db.query(
            `SELECT COUNT(*) as total
             FROM knowledge_base_embeddings
             WHERE knowledge_base_id = $1`,
            [kb.id]
          );

          return {
            ...kb,
            stats: {
              documents: {
                total: parseInt(docsResult.rows[0].total) || 0,
                completed: parseInt(docsResult.rows[0].completed) || 0,
                processing: parseInt(docsResult.rows[0].processing) || 0,
                pending: parseInt(docsResult.rows[0].pending) || 0,
                failed: parseInt(docsResult.rows[0].failed) || 0,
              },
              embeddings: {
                total: parseInt(embeddingsResult.rows[0].total) || 0,
              },
            },
          };
        })
      );

      reply.send({
        success: true,
        data: knowledgeBasesWithStats,
      });
    } catch (error: any) {
      logger.error('List knowledge bases error', { 
        error: error.message,
        code: error.code,
        detail: error.detail,
        stack: error.stack
      });
      
      // Check if table doesn't exist
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        throw new AppError(
          'TABLE_NOT_FOUND',
          'The knowledge_bases table does not exist. Please run database migrations (006_knowledge_bases_rag.sql) first.',
          500
        );
      }
      
      throw new AppError(
        'LIST_KB_FAILED',
        `Failed to list knowledge bases: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get knowledge base by ID
   * GET /api/admin/knowledge-bases/:id
   */
  async getKnowledgeBase(
    request: FastifyRequest<{
      Params: {
        id: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const knowledgeBase = await this.kbService.getKnowledgeBase(id);

      if (!knowledgeBase) {
        throw new AppError('KB_NOT_FOUND', 'Knowledge base not found', 404);
      }

      // Get documents count and stats
      const docsResult = await this.db.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
         FROM knowledge_base_documents
         WHERE knowledge_base_id = $1`,
        [id]
      );

      const embeddingsResult = await this.db.query(
        `SELECT COUNT(*) as total
         FROM knowledge_base_embeddings
         WHERE knowledge_base_id = $1`,
        [id]
      );

      reply.send({
        success: true,
        data: {
          ...knowledgeBase,
          stats: {
            documents: {
              total: parseInt(docsResult.rows[0].total) || 0,
              completed: parseInt(docsResult.rows[0].completed) || 0,
              processing: parseInt(docsResult.rows[0].processing) || 0,
              failed: parseInt(docsResult.rows[0].failed) || 0,
            },
            embeddings: {
              total: parseInt(embeddingsResult.rows[0].total) || 0,
            },
          },
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get knowledge base error', { error: error.message });
      throw new AppError(
        'GET_KB_FAILED',
        `Failed to get knowledge base: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create knowledge base
   * POST /api/admin/knowledge-bases
   */
  async createKnowledgeBase(
    request: FastifyRequest<{
      Body: {
        name: string;
        description?: string;
        embedding_model_id?: string;
        chunk_size?: number;
        chunk_overlap?: number;
        chunking_strategy?: string;
        metadata?: any;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const data = request.body;

      if (!data.name) {
        throw new AppError('VALIDATION_ERROR', 'name is required', 400);
      }

      const knowledgeBase = await this.kbService.createKnowledgeBase(data);

      reply.send({
        success: true,
        data: knowledgeBase,
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Create knowledge base error', { error: error.message });
      throw new AppError(
        'CREATE_KB_FAILED',
        `Failed to create knowledge base: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update knowledge base
   * PUT /api/admin/knowledge-bases/:id
   */
  async updateKnowledgeBase(
    request: FastifyRequest<{
      Params: {
        id: string;
      };
      Body: {
        name?: string;
        description?: string;
        embedding_model_id?: string;
        chunk_size?: number;
        chunk_overlap?: number;
        chunking_strategy?: string;
        active?: boolean;
        metadata?: any;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const updates = request.body;

      const knowledgeBase = await this.kbService.updateKnowledgeBase(id, updates);

      reply.send({
        success: true,
        data: knowledgeBase,
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update knowledge base error', { error: error.message });
      throw new AppError(
        'UPDATE_KB_FAILED',
        `Failed to update knowledge base: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete knowledge base
   * DELETE /api/admin/knowledge-bases/:id
   */
  async deleteKnowledgeBase(
    request: FastifyRequest<{
      Params: {
        id: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      await this.kbService.deleteKnowledgeBase(id);

      reply.send({
        success: true,
        message: 'Knowledge base deleted successfully',
      });
    } catch (error: any) {
      logger.error('Delete knowledge base error', { error: error.message });
      throw new AppError(
        'DELETE_KB_FAILED',
        `Failed to delete knowledge base: ${error.message}`,
        500
      );
    }
  }

  // ============================================================
  // DOCUMENTS
  // ============================================================

  /**
   * Get documents for a knowledge base
   * GET /api/admin/knowledge-bases/:id/documents
   */
  async getDocuments(
    request: FastifyRequest<{
      Params: {
        id: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const documents = await this.kbService.getDocuments(id);

      // Add processing progress info and embeddings count for each document
      const documentsWithProgress = await Promise.all(
        documents.map(async (doc) => {
          // Always get embeddings count to verify if document is really processed
          const embeddingsResult = await this.db.query(
            'SELECT COUNT(*) as count FROM knowledge_base_embeddings WHERE document_id = $1',
            [doc.id]
          );
          const embeddingsCount = parseInt(embeddingsResult.rows[0].count, 10);
          
          // Estimate total chunks (rough estimate: ~1000 chars per chunk)
          const estimatedChunks = doc.content ? Math.ceil(doc.content.length / 1000) : 0;
          
          const docWithProgress = {
            ...doc,
            embeddings_count: embeddingsCount,
            estimated_chunks: estimatedChunks,
          };
          
          if (doc.status === 'processing' || doc.status === 'pending') {
            return {
              ...docWithProgress,
              progress: {
                embeddingsCreated: embeddingsCount,
                estimatedTotal: estimatedChunks,
                percentage: estimatedChunks > 0 ? Math.min(100, Math.round((embeddingsCount / estimatedChunks) * 100)) : 0,
              },
            };
          }
          
          return docWithProgress;
        })
      );

      reply.send({
        success: true,
        data: documentsWithProgress,
      });
    } catch (error: any) {
      logger.error('Get documents error', { error: error.message });
      throw new AppError(
        'GET_DOCUMENTS_FAILED',
        `Failed to get documents: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get document status and progress
   * GET /api/admin/knowledge-bases/:kbId/documents/:docId/status
   */
  async getDocumentStatus(
    request: FastifyRequest<{
      Params: {
        kbId: string;
        docId: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { docId } = request.params;
      
      const docResult = await this.db.query(
        `SELECT 
          d.*,
          kb.name as kb_name,
          (SELECT COUNT(*) FROM knowledge_base_embeddings WHERE document_id = d.id) as embeddings_count
        FROM knowledge_base_documents d
        LEFT JOIN knowledge_bases kb ON d.knowledge_base_id = kb.id
        WHERE d.id = $1`,
        [docId]
      );

      if (docResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Document not found', 404);
      }

      const doc = docResult.rows[0];
      const embeddingsCount = parseInt(doc.embeddings_count, 10);
      
      // Estimate total chunks
      const contentLength = doc.content?.length || 0;
      const estimatedChunks = contentLength > 0 ? Math.ceil(contentLength / 1000) : 0;
      
      const status = {
        id: doc.id,
        title: doc.title || doc.file_name,
        status: doc.status,
        error_message: doc.error_message,
        embeddingsCreated: embeddingsCount,
        estimatedTotal: estimatedChunks,
        percentage: estimatedChunks > 0 ? Math.min(100, Math.round((embeddingsCount / estimatedChunks) * 100)) : 0,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        processingTime: doc.status === 'processing' 
          ? Date.now() - new Date(doc.updated_at).getTime() 
          : null,
      };

      reply.send({
        success: true,
        data: status,
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Get document status error', { error: error.message });
      throw new AppError(
        'GET_DOCUMENT_STATUS_FAILED',
        `Failed to get document status: ${error.message}`,
        500
      );
    }
  }

  /**
   * Add document to knowledge base
   * POST /api/admin/knowledge-bases/:id/documents
   * Supports both JSON (content) and multipart/form-data (file upload)
   */
  async addDocument(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      
      logger.info('Add document request received', {
        kbId: id,
        isMultipart: request.isMultipart(),
        contentType: request.headers['content-type'],
        method: request.method,
        url: request.url,
      });
      
      let title: string | undefined;
      let content: string | undefined;
      let fileName: string | undefined;
      let fileType: string | undefined;
      let fileSize: number | undefined;
      let sourceType = 'manual';
      let metadata: any = {};

      // Check if request is multipart (file upload)
      if (request.isMultipart()) {
        logger.info('Processing multipart file upload', { kbId: id });
        const parts = request.parts();
        
        for await (const part of parts) {
          if (part.type === 'file') {
            // Handle file upload
            const file = part as any;
            const buffer = await file.toBuffer();
            fileName = file.filename;
            fileType = file.mimetype;
            fileSize = buffer.length;

            // Validate required fields
            if (!fileName) {
              throw new AppError('VALIDATION_ERROR', 'File name is required', 400);
            }
            if (fileSize === undefined) {
              throw new AppError('VALIDATION_ERROR', 'File size could not be determined', 400);
            }

            // Validate file size
            const maxSize = this.documentParser.getMaxFileSize(fileName);
            if (fileSize > maxSize) {
              throw new AppError(
                'VALIDATION_ERROR',
                `File size (${(fileSize / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed size (${(maxSize / 1024 / 1024).toFixed(2)} MB)`,
                400
              );
            }

            // Check if file type is supported
            if (!this.documentParser.isSupported(fileName, fileType || '')) {
              throw new AppError(
                'VALIDATION_ERROR',
                `File type ${fileType || 'unknown'} is not supported. Supported types: PDF, DOCX, XLSX, XLS, TXT, MD, CSV`,
                400
              );
            }

            // Parse the file
            logger.info('Parsing uploaded file', {
              fileName,
              fileType,
              size: fileSize,
            });

            const parseResult = await this.documentParser.parseDocument(buffer, fileName, fileType || '');
            content = parseResult.content;
            sourceType = 'file';
            metadata = parseResult.metadata || {};

            if (!content || content.trim().length === 0) {
              throw new AppError(
                'VALIDATION_ERROR',
                'File appears to be empty or could not be parsed',
                400
              );
            }

            logger.info('File parsed successfully', {
              fileName,
              contentLength: content.length,
              metadata,
            });
          } else {
            // Handle form fields
            const fieldName = (part as any).fieldname;
            const fieldValue = (part as any).value as string;

            if (fieldName === 'title') {
              title = fieldValue;
            } else if (fieldName === 'category') {
              // Add category to metadata
              if (!metadata.category) {
                metadata.category = fieldValue;
              }
            } else if (fieldName === 'metadata') {
              // If metadata is provided as JSON string, parse it
              try {
                const parsedMetadata = JSON.parse(fieldValue);
                metadata = { ...metadata, ...parsedMetadata };
              } catch {
                // If not JSON, ignore
              }
            }
          }
        }

        if (!content) {
          throw new AppError('VALIDATION_ERROR', 'No file or content provided', 400);
        }
      } else {
        // Handle JSON request (existing behavior)
        const data = request.body as {
          title?: string;
          content: string;
          source_type?: string;
          source_url?: string;
          file_name?: string;
          file_type?: string;
          file_size?: number;
          metadata?: any;
        };

        if (!data.content) {
          throw new AppError('VALIDATION_ERROR', 'content is required', 400);
        }

        title = data.title;
        content = data.content;
        sourceType = data.source_type || 'manual';
        fileName = data.file_name;
        fileType = data.file_type;
        fileSize = data.file_size;
        metadata = data.metadata || {};
      }

      logger.info('Calling kbService.addDocument', {
        kbId: id,
        hasContent: !!content,
        contentLength: content?.length || 0,
        fileName,
        fileType,
        fileSize,
        sourceType,
      });

      const document = await this.kbService.addDocument(id, {
        title,
        content,
        source_type: sourceType,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        metadata,
      });

      logger.info('Document added successfully', {
        kbId: id,
        documentId: document.id,
        status: document.status,
      });

      reply.send({
        success: true,
        data: document,
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        logger.error('Add document error (AppError)', {
          kbId: (request.params as any)?.id,
          errorCode: error.code,
          errorMessage: error.message,
          statusCode: error.statusCode,
        });
        throw error;
      }
      logger.error('Add document error (unexpected)', {
        kbId: (request.params as any)?.id,
        errorMessage: error.message,
        errorStack: error.stack,
        errorName: error.name,
        errorKeys: Object.keys(error),
      });
      throw new AppError(
        'ADD_DOCUMENT_FAILED',
        `Failed to add document: ${error.message}`,
        500
      );
    }
  }

  /**
   * Add multiple documents in batch
   * POST /api/admin/knowledge-bases/:id/documents/batch
   */
  async addDocumentsBatch(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      
      if (!request.isMultipart()) {
        throw new AppError('VALIDATION_ERROR', 'Request must be multipart/form-data', 400);
      }

      logger.info('Batch document upload request received', {
        kbId: id,
        contentType: request.headers['content-type'],
      });

      const parts = request.parts();
      const files: Array<{ buffer: Buffer; filename: string; mimetype?: string }> = [];
      let category: string | undefined;
      let defaultTitle: string | undefined;

      // Process all parts
      for await (const part of parts) {
        if (part.type === 'file') {
          const file = part as any;
          const buffer = await file.toBuffer();
          files.push({
            buffer,
            filename: file.filename,
            mimetype: file.mimetype,
          });
        } else {
          // Handle form fields
          const fieldName = (part as any).fieldname;
          const fieldValue = (part as any).value as string;

          if (fieldName === 'category') {
            category = fieldValue;
          } else if (fieldName === 'defaultTitle') {
            defaultTitle = fieldValue;
          }
        }
      }

      if (files.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No files provided', 400);
      }

      logger.info('Processing batch upload', {
        kbId: id,
        fileCount: files.length,
        category,
      });

      const results: Array<{ success: boolean; document?: any; error?: string; fileName: string }> = [];

      // Process each file
      for (const file of files) {
        try {
          const fileName = file.filename;
          const fileType = file.mimetype || '';
          const fileSize = file.buffer.length;

          // Validate file size
          const maxSize = this.documentParser.getMaxFileSize(fileName);
          if (fileSize > maxSize) {
            results.push({
              success: false,
              fileName,
              error: `File size (${(fileSize / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed size (${(maxSize / 1024 / 1024).toFixed(2)} MB)`,
            });
            continue;
          }

          // Check if file type is supported
          if (!this.documentParser.isSupported(fileName, fileType)) {
            results.push({
              success: false,
              fileName,
              error: `File type ${fileType || 'unknown'} is not supported`,
            });
            continue;
          }

          // Parse the file
          const parseResult = await this.documentParser.parseDocument(
            file.buffer,
            fileName,
            fileType
          );

          if (!parseResult.content || parseResult.content.trim().length === 0) {
            results.push({
              success: false,
              fileName,
              error: 'File appears to be empty or could not be parsed',
            });
            continue;
          }

          // Prepare metadata with category
          const metadata: any = {
            ...parseResult.metadata,
            category: category || 'uncategorized',
            uploadedInBatch: true,
            batchUploadDate: new Date().toISOString(),
          };

          // Add document
          const document = await this.kbService.addDocument(id, {
            title: defaultTitle || fileName,
            content: parseResult.content,
            source_type: 'file',
            file_name: fileName,
            file_type: fileType,
            file_size: fileSize,
            metadata,
          });

          results.push({
            success: true,
            document,
            fileName,
          });

          logger.info('Document added in batch', {
            kbId: id,
            documentId: document.id,
            fileName,
            category,
          });
        } catch (error: any) {
          logger.error('Error processing file in batch', {
            kbId: id,
            fileName: file.filename,
            error: error.message,
          });
          results.push({
            success: false,
            fileName: file.filename,
            error: error.message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      logger.info('Batch upload completed', {
        kbId: id,
        totalFiles: files.length,
        successCount,
        failureCount,
      });

      reply.send({
        success: true,
        data: {
          totalFiles: files.length,
          successCount,
          failureCount,
          results,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Batch upload error', {
        kbId: (request.params as any)?.id,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      throw new AppError(
        'BATCH_UPLOAD_FAILED',
        `Failed to upload documents in batch: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete document
   * DELETE /api/admin/knowledge-bases/:kbId/documents/:docId
   */
  async deleteDocument(
    request: FastifyRequest<{
      Params: {
        kbId: string;
        docId: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { docId } = request.params;
      await this.kbService.deleteDocument(docId);

      reply.send({
        success: true,
        message: 'Document deleted successfully',
      });
    } catch (error: any) {
      logger.error('Delete document error', { error: error.message });
      throw new AppError(
        'DELETE_DOCUMENT_FAILED',
        `Failed to delete document: ${error.message}`,
        500
      );
    }
  }

  // ============================================================
  // FLOW ASSIGNMENTS
  // ============================================================

  /**
   * Assign knowledge base to flow
   * POST /api/admin/knowledge-bases/:id/flows/:flowId
   */
  async assignToFlow(
    request: FastifyRequest<{
      Params: {
        id: string;
        flowId: string;
      };
      Body: {
        priority?: number;
        similarity_threshold?: number;
        max_results?: number;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id, flowId } = request.params;
      const { priority, similarity_threshold, max_results } = request.body;

      // Use provided values or defaults only for new assignments
      // For updates, use the provided values explicitly (even if 0 or undefined)
      const finalPriority = priority !== undefined ? priority : 0;
      const finalSimilarityThreshold = similarity_threshold !== undefined ? similarity_threshold : 0.35;
      const finalMaxResults = max_results !== undefined ? max_results : 15;

      const result = await this.db.query(
        `INSERT INTO flow_knowledge_bases
         (flow_id, knowledge_base_id, priority, similarity_threshold, max_results)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (flow_id, knowledge_base_id)
         DO UPDATE SET
           priority = EXCLUDED.priority,
           similarity_threshold = EXCLUDED.similarity_threshold,
           max_results = EXCLUDED.max_results,
           updated_at = NOW()
         RETURNING *`,
        [
          flowId,
          id,
          finalPriority,
          finalSimilarityThreshold,
          finalMaxResults,
        ]
      );

      reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error: any) {
      logger.error('Assign to flow error', { error: error.message });
      throw new AppError(
        'ASSIGN_FLOW_FAILED',
        `Failed to assign knowledge base to flow: ${error.message}`,
        500
      );
    }
  }

  /**
   * Unassign knowledge base from flow
   * DELETE /api/admin/knowledge-bases/:id/flows/:flowId
   */
  async unassignFromFlow(
    request: FastifyRequest<{
      Params: {
        id: string;
        flowId: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id, flowId } = request.params;

      await this.db.query(
        'DELETE FROM flow_knowledge_bases WHERE flow_id = $1 AND knowledge_base_id = $2',
        [flowId, id]
      );

      reply.send({
        success: true,
        message: 'Knowledge base unassigned from flow',
      });
    } catch (error: any) {
      logger.error('Unassign from flow error', { error: error.message });
      throw new AppError(
        'UNASSIGN_FLOW_FAILED',
        `Failed to unassign knowledge base from flow: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get knowledge bases for a flow
   * GET /api/admin/flows/:flowId/knowledge-bases
   */
  async getFlowKnowledgeBases(
    request: FastifyRequest<{
      Params: {
        flowId: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { flowId } = request.params;

      const result = await this.db.query(
        `SELECT 
          fkb.*,
          kb.name as knowledge_base_name,
          kb.description as knowledge_base_description,
          kb.active as knowledge_base_active
         FROM flow_knowledge_bases fkb
         INNER JOIN knowledge_bases kb ON kb.id = fkb.knowledge_base_id
         WHERE fkb.flow_id = $1
         ORDER BY fkb.priority ASC, fkb.created_at ASC`,
        [flowId]
      );

      reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error: any) {
      logger.error('Get flow knowledge bases error', { error: error.message });
      throw new AppError(
        'GET_FLOW_KB_FAILED',
        `Failed to get flow knowledge bases: ${error.message}`,
        500
      );
    }
  }

  // ============================================================
  // EMBEDDING MODELS
  // ============================================================

  /**
   * List embedding models
   * GET /api/admin/embedding-models
   */
  async listEmbeddingModels(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const result = await this.db.query(
        'SELECT * FROM embedding_models ORDER BY is_default DESC, name ASC'
      );

      reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error: any) {
      logger.error('List embedding models error', { 
        error: error.message,
        code: error.code,
        detail: error.detail,
        stack: error.stack
      });
      
      // Check if table doesn't exist
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        throw new AppError(
          'TABLE_NOT_FOUND',
          'The embedding_models table does not exist. Please run database migrations (006_knowledge_bases_rag.sql) first.',
          500
        );
      }
      
      throw new AppError(
        'LIST_EMBEDDING_MODELS_FAILED',
        `Failed to list embedding models: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create embedding model
   * POST /api/admin/embedding-models
   */
  async createEmbeddingModel(
    request: FastifyRequest<{
      Body: {
        name: string;
        provider: string;
        model_name: string;
        dimensions: number;
        api_key_encrypted?: string;
        config?: any;
        active?: boolean;
        is_default?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const data = request.body;

      if (!data.name || !data.provider || !data.model_name || !data.dimensions) {
        throw new AppError('VALIDATION_ERROR', 'name, provider, model_name, and dimensions are required', 400);
      }

      // If setting as default, unset other defaults
      if (data.is_default) {
        await this.db.query('UPDATE embedding_models SET is_default = false WHERE is_default = true');
      }

      const result = await this.db.query(
        `INSERT INTO embedding_models 
         (name, provider, model_name, dimensions, api_key_encrypted, config, active, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.name,
          data.provider,
          data.model_name,
          data.dimensions,
          data.api_key_encrypted || null,
          JSON.stringify(data.config || {}),
          data.active !== undefined ? data.active : true,
          data.is_default || false,
        ]
      );

      reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Create embedding model error', { 
        error: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        stack: error.stack
      });
      
      // Check if table doesn't exist
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        throw new AppError(
          'TABLE_NOT_FOUND',
          'The embedding_models table does not exist. Please run database migrations (006_knowledge_bases_rag.sql) first.',
          500
        );
      }
      
      // Check for unique constraint violation
      if (error.code === '23505' || error.constraint) {
        throw new AppError(
          'DUPLICATE_ENTRY',
          `An embedding model with this name already exists: ${error.detail || error.message}`,
          409
        );
      }
      
      throw new AppError(
        'CREATE_EMBEDDING_MODEL_FAILED',
        `Failed to create embedding model: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update embedding model
   * PUT /api/admin/embedding-models/:id
   */
  async updateEmbeddingModel(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        provider?: string;
        model_name?: string;
        dimensions?: number;
        api_key_encrypted?: string;
        config?: any;
        active?: boolean;
        is_default?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const updates = request.body;

      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        fields.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.provider !== undefined) {
        fields.push(`provider = $${paramIndex++}`);
        values.push(updates.provider);
      }
      if (updates.model_name !== undefined) {
        fields.push(`model_name = $${paramIndex++}`);
        values.push(updates.model_name);
      }
      if (updates.dimensions !== undefined) {
        fields.push(`dimensions = $${paramIndex++}`);
        values.push(updates.dimensions);
      }
      if (updates.api_key_encrypted !== undefined) {
        fields.push(`api_key_encrypted = $${paramIndex++}`);
        values.push(updates.api_key_encrypted || null);
      }
      if (updates.config !== undefined) {
        fields.push(`config = $${paramIndex++}`);
        values.push(JSON.stringify(updates.config));
      }
      if (updates.active !== undefined) {
        fields.push(`active = $${paramIndex++}`);
        values.push(updates.active);
      }
      if (updates.is_default !== undefined) {
        // If setting as default, unset other defaults
        if (updates.is_default) {
          await this.db.query('UPDATE embedding_models SET is_default = false WHERE is_default = true AND id != $1', [id]);
        }
        fields.push(`is_default = $${paramIndex++}`);
        values.push(updates.is_default);
      }

      if (fields.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No fields to update', 400);
      }

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await this.db.query(
        `UPDATE embedding_models 
         SET ${fields.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Update embedding model error', { error: error.message });
      throw new AppError(
        'UPDATE_EMBEDDING_MODEL_FAILED',
        `Failed to update embedding model: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete embedding model
   * DELETE /api/admin/embedding-models/:id
   */
  async deleteEmbeddingModel(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      // Check if embedding model exists
      const modelResult = await this.db.query(
        'SELECT * FROM embedding_models WHERE id = $1',
        [id]
      );

      if (modelResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Embedding model not found', 404);
      }

      // Check if embedding model is being used by any knowledge bases
      const kbResult = await this.db.query(
        'SELECT COUNT(*) as count FROM knowledge_bases WHERE embedding_model_id = $1',
        [id]
      );

      const usageCount = parseInt(kbResult.rows[0].count, 10);
      if (usageCount > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Cannot delete embedding model: it is being used by ${usageCount} knowledge base(s). Please update or delete those knowledge bases first.`,
          400
        );
      }

      // Check if it's the default model
      if (modelResult.rows[0].is_default) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Cannot delete the default embedding model. Please set another model as default first.',
          400
        );
      }

      // Delete the embedding model
      await this.db.query('DELETE FROM embedding_models WHERE id = $1', [id]);

      reply.send({
        success: true,
        message: 'Embedding model deleted successfully',
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Delete embedding model error', { error: error.message });
      throw new AppError(
        'DELETE_EMBEDDING_MODEL_FAILED',
        `Failed to delete embedding model: ${error.message}`,
        500
      );
    }
  }

  // ============================================================
  // RAG SEARCH (for testing/debugging)
  // ============================================================

  /**
   * Search knowledge bases (RAG query)
   * POST /api/admin/knowledge-bases/search
   */
  async search(
    request: FastifyRequest<{
      Body: {
        flow_id: string;
        query_text: string;
        knowledge_base_ids?: string[];
        max_results?: number;
        similarity_threshold?: number;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { flow_id, query_text, knowledge_base_ids, max_results, similarity_threshold } =
        request.body;

      if (!flow_id || !query_text) {
        throw new AppError(
          'VALIDATION_ERROR',
          'flow_id and query_text are required',
          400
        );
      }

      const result = await this.ragService.search({
        flowId: flow_id,
        queryText: query_text,
        knowledgeBaseIds: knowledge_base_ids,
        maxResults: max_results,
        similarityThreshold: similarity_threshold,
      });

      reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('RAG search error', { error: error.message });
      throw new AppError(
        'RAG_SEARCH_FAILED',
        `Failed to search knowledge bases: ${error.message}`,
        500
      );
    }
  }
}

