import { FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { AIOrchestrator } from '@cortex/core';
import { FlowBasedMessageRouter } from '@cortex/core/src/router/FlowBasedMessageRouter';
import { IncomingMessage, ChannelType, AppError, createLogger } from '@cortex/shared';
import { EmbeddingService, RAGService } from '../services';

const logger = createLogger('MessagesController');

/**
 * Messages Controller
 */
export class MessagesController {
  private ragService: RAGService | null = null;

  constructor(
    private orchestrator: AIOrchestrator,
    private flowRouter?: FlowBasedMessageRouter,
    private db?: Pool
  ) {
    // Initialize RAG service if database is available
    if (this.db) {
      const embeddingService = new EmbeddingService(this.db);
      this.ragService = new RAGService(this.db, embeddingService);
    }
  }

  /**
   * Load conversation history from database and restore to context
   * Returns the database conversationId for use in saving messages
   */
  private async loadHistoryFromDatabase(
    conversationId: string,
    channelType: ChannelType,
    userId: string
  ): Promise<string | null> {
    if (!this.db) {
      logger.debug('Database not available, skipping history load');
      return null;
    }

    try {
      // Get or create conversation
      let convResult = await this.db.query(
        `SELECT id FROM conversations 
         WHERE channel = $1 AND channel_user_id = $2 
         LIMIT 1`,
        [channelType, userId]
      );

      let conversationId_db: string;
      if (convResult.rows.length === 0) {
        // Create new conversation
        const insertResult = await this.db.query(
          `INSERT INTO conversations (channel, channel_user_id, started_at, last_activity, status)
           VALUES ($1, $2, NOW(), NOW(), 'active')
           RETURNING id`,
          [channelType, userId]
        );
        conversationId_db = insertResult.rows[0].id;
        logger.debug('Created new conversation in database', { conversationId: conversationId_db });
      } else {
        conversationId_db = convResult.rows[0].id;
      }

      // Load messages from database
      const messagesResult = await this.db.query(
        `SELECT role, content, timestamp, llm_provider, llm_model
         FROM messages
         WHERE conversation_id = $1
         ORDER BY timestamp ASC
         LIMIT 100`,
        [conversationId_db]
      );

      if (messagesResult.rows.length === 0) {
        logger.debug('No existing messages in database for this conversation');
        return conversationId_db; // Return conversationId even if no messages
      }

      // Get orchestrator's context manager
      const contextManager = (this.orchestrator as any).contextManager;
      if (!contextManager) {
        logger.warn('ContextManager not available, cannot restore history');
        return conversationId_db; // Return conversationId even if can't restore
      }

      // Get or create context using the same channelType and userId
      // This ensures we use the same sessionId that the orchestrator will use
      // The conversationId_db is stored in the context but sessionId is based on channelType:userId
      const mcpContext = await contextManager.getOrCreateContext(
        conversationId_db, // Use DB conversationId for context metadata
        channelType,
        userId
      );
      
      // Update context with the correct conversationId from database
      await (this.orchestrator as any).mcpServer.updateContext(mcpContext.sessionId, {
        conversationId: conversationId_db,
      });

      // Check if context already has history
      // If it does, we should still verify it's complete by comparing with DB
      const existingContext = await (this.orchestrator as any).mcpServer.getContext(mcpContext.sessionId);
      if (existingContext && existingContext.conversationHistory.length > 0) {
        // If context has history but DB has more messages, we should update
        if (messagesResult.rows.length > existingContext.conversationHistory.length) {
          logger.info('Context has history but DB has more messages, updating context', {
            contextHistoryLength: existingContext.conversationHistory.length,
            dbHistoryLength: messagesResult.rows.length,
          });
          // Clear existing history and restore from DB
          await contextManager.clearHistory(mcpContext.sessionId);
          // Restore all messages from DB
          for (const msg of messagesResult.rows) {
            await contextManager.addMessage(
              mcpContext.sessionId,
              msg.role as 'user' | 'assistant' | 'system',
              msg.content
            );
          }
        } else {
          logger.debug('Context already has history, not restoring from database', {
            existingHistoryLength: existingContext.conversationHistory.length,
            dbHistoryLength: messagesResult.rows.length,
          });
        }
        return conversationId_db; // Return conversationId even if not restoring
      }

      // Restore messages to context
      for (const msg of messagesResult.rows) {
        await contextManager.addMessage(
          mcpContext.sessionId,
          msg.role as 'user' | 'assistant' | 'system',
          msg.content
        );
      }

      logger.info('Restored conversation history from database', {
        conversationId: conversationId_db,
        messageCount: messagesResult.rows.length,
      });

      return conversationId_db;
    } catch (error: any) {
      logger.error('Failed to load history from database', {
        error: error.message,
        conversationId,
      });
      // Don't throw - continue processing even if history load fails
      return null;
    }
  }

  /**
   * Save messages to database
   */
  private async saveMessagesToDatabase(
    conversationId: string,
    channelType: ChannelType,
    userId: string,
    userMessage: string,
    assistantMessage: string,
    llmProvider?: string,
    llmModel?: string,
    tokensUsed?: any,
    cost?: number
  ): Promise<void> {
    if (!this.db) {
      logger.debug('Database not available, skipping message save');
      return;
    }

    try {
      // Try to find conversation by ID first, then by channel and userId
      let convResult = await this.db.query(
        `SELECT id FROM conversations 
         WHERE id = $1 OR (channel = $2 AND channel_user_id = $3)
         LIMIT 1`,
        [conversationId, channelType, userId]
      );

      let conversationId_db: string;
      if (convResult.rows.length === 0) {
        // Create new conversation
        const insertResult = await this.db.query(
          `INSERT INTO conversations (channel, channel_user_id, started_at, last_activity, status)
           VALUES ($1, $2, NOW(), NOW(), 'active')
           RETURNING id`,
          [channelType, userId]
        );
        conversationId_db = insertResult.rows[0].id;
        logger.debug('Created new conversation in database for message save', {
          conversationId: conversationId_db,
          channelType,
          userId,
        });
      } else {
        conversationId_db = convResult.rows[0].id;
      }

      // Update conversation last_activity
      await this.db.query(
        `UPDATE conversations SET last_activity = NOW() WHERE id = $1`,
        [conversationId_db]
      );

      // Save user message
      await this.db.query(
        `INSERT INTO messages (conversation_id, role, content, timestamp)
         VALUES ($1, 'user', $2, NOW())`,
        [conversationId_db, userMessage]
      );

      // Save assistant message
      await this.db.query(
        `INSERT INTO messages (conversation_id, role, content, timestamp, llm_provider, llm_model, tokens_used, cost)
         VALUES ($1, 'assistant', $2, NOW(), $3, $4, $5, $6)`,
        [
          conversationId_db,
          assistantMessage,
          llmProvider || null,
          llmModel || null,
          tokensUsed ? JSON.stringify(tokensUsed) : null,
          cost || null,
        ]
      );

      logger.info('Saved messages to database', {
        conversationId: conversationId_db,
        channelType,
        userId,
        userMessageLength: userMessage.length,
        assistantMessageLength: assistantMessage.length,
      });
    } catch (error: any) {
      logger.error('Failed to save messages to database', {
        error: error.message,
        stack: error.stack,
        conversationId,
        channelType,
        userId,
      });
      // Don't throw - continue even if save fails
    }
  }

  /**
   * Enhance routing result with RAG context from knowledge bases
   */
  private async enhanceWithRAGContext(
    routingResult: any,
    queryText: string
  ): Promise<any> {
    logger.debug('enhanceWithRAGContext called', {
      hasRagService: !!this.ragService,
      hasFlow: !!routingResult?.flow,
      flowId: routingResult?.flow?.id,
      flowName: routingResult?.flow?.name,
    });

    if (!this.ragService) {
      logger.debug('RAG service not available, skipping RAG enhancement');
      return routingResult;
    }

    if (!routingResult?.flow?.id) {
      logger.debug('No flow ID in routing result, skipping RAG enhancement');
      return routingResult;
    }

    try {
      logger.info('Executing RAG search', {
        flowId: routingResult.flow.id,
        flowName: routingResult.flow.name,
        queryLength: queryText.length,
      });

      const ragResult = await this.ragService.search({
        flowId: routingResult.flow.id,
        queryText,
      });

      logger.info('RAG search completed', {
        flowId: routingResult.flow.id,
        chunksFound: ragResult.chunks.length,
        processingTimeMs: ragResult.processingTimeMs,
      });

      if (ragResult.chunks.length > 0) {
        const ragContext = this.ragService.formatContextForPrompt(ragResult.chunks);
        
        // Add RAG context to system prompt
        const currentSystemPrompt = routingResult.flow.flow_config?.systemPrompt || '';
        const enhancedSystemPrompt = currentSystemPrompt + ragContext;

        logger.info('RAG context added to system prompt', {
          flowId: routingResult.flow.id,
          originalPromptLength: currentSystemPrompt.length,
          enhancedPromptLength: enhancedSystemPrompt.length,
          contextLength: ragContext.length,
        });

        // Update routing result with enhanced system prompt
        return {
          ...routingResult,
          flow: {
            ...routingResult.flow,
            flow_config: {
              ...routingResult.flow.flow_config,
              systemPrompt: enhancedSystemPrompt,
            },
          },
        };
      } else {
        logger.debug('No RAG chunks found, continuing without context enhancement');
      }
    } catch (error: any) {
      logger.warn('RAG search failed, continuing without context', {
        error: error.message,
        flowId: routingResult.flow.id,
        stack: error.stack,
      });
    }

    return routingResult;
  }

  /**
   * Send a message through the orchestrator
   * POST /api/v1/messages/send
   */
  async sendMessage(
    request: FastifyRequest<{
      Body: {
        channelType: ChannelType;
        userId: string;
        content: string;
        metadata?: any;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { channelType, userId, content, metadata } = request.body;

    // Validate input
    if (!channelType || !userId || !content) {
      throw new AppError(
        'VALIDATION_ERROR',
        'channelType, userId, and content are required',
        400
      );
    }

    // Validate channelType is valid
    const validChannels = Object.values(ChannelType);
    if (!validChannels.includes(channelType)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Invalid channelType. Must be one of: ${validChannels.join(', ')}`,
        400
      );
    }

    // Create incoming message
    const message: IncomingMessage = {
      channelType,
      channelUserId: userId,
      content,
      metadata: metadata || {},
    };

    try {
      // Try to route message using FlowBasedMessageRouter if available
      let routingResult = null;
      
      // If flowId is explicitly provided (e.g., from Playground), use that flow directly
      if (metadata?.flowId && this.db) {
        logger.debug('Using explicitly specified flowId from metadata', {
          flowId: metadata.flowId,
          channelType,
        });
        
        try {
          // Get flow with channel matching the message channelType
          // Use flow_channels table for M:M relationship
          // Use channelId from metadata if provided, otherwise use any channel of this type
          const requestedChannelId = message.metadata?.channelId || message.metadata?.channel_config_id;
          
          const flowResult = await this.db.query(`
            SELECT DISTINCT
              f.*,
              l.provider as llm_provider,
              l.model as llm_model,
              l.config as llm_config,
              c.channel_type,
              c.config as channel_config,
              c.id as channel_config_id,
              fc.priority as channel_priority,
              CASE 
                WHEN c.id = $3 THEN 1
                ELSE 2
              END as channel_match_priority
            FROM orchestration_flows f
            JOIN llm_configs l ON f.llm_id = l.id
            JOIN flow_channels fc ON f.id = fc.flow_id AND fc.active = true
            JOIN channel_configs c ON fc.channel_id = c.id
            WHERE f.id = $1 
              AND f.active = true
              AND c.channel_type = $2
              AND c.is_active = true
            ORDER BY channel_match_priority ASC, fc.priority ASC
            LIMIT 1
          `, [metadata.flowId, channelType, requestedChannelId || '']);
          
          if (flowResult.rows.length > 0) {
            const flow = flowResult.rows[0];
            
            // Parse flow_config if it's a string
            let flowConfig: any = flow.flow_config;
            if (typeof flowConfig === 'string') {
              try {
                flowConfig = JSON.parse(flowConfig);
              } catch (e) {
                logger.warn('Failed to parse flow_config', { flowId: metadata.flowId });
                flowConfig = {};
              }
            }
            
            routingResult = {
              flow: {
                ...flow,
                flow_config: flowConfig,
              },
              llmProvider: flow.llm_provider,
              llmModel: flow.llm_model,
              llmConfig: flow.llm_config || {},
              enabledTools: flow.enabled_tools || [],
              channelConfig: flow.channel_config,
              channelConfigId: flow.channel_config_id,
            };
            
            logger.info('Using explicitly specified flow', {
              flowId: metadata.flowId,
              flowName: flow.name,
              llmProvider: flow.llm_provider,
              llmModel: flow.llm_model,
              channelType: flow.channel_type,
              channelConfigId: flow.channel_config_id,
            });

            // Enhance with RAG context for explicit flow too
            routingResult = await this.enhanceWithRAGContext(
              routingResult,
              message.content
            );
          } else {
            logger.warn('Explicit flowId provided but no matching channel found', {
              flowId: metadata.flowId,
              channelType,
              instanceId: message.metadata?.instanceId || message.metadata?.toNumber,
            });
          }
        } catch (error: any) {
          logger.warn('Failed to load explicit flow, falling back to routing', {
            flowId: metadata.flowId,
            error: error.message,
          });
        }
      }
      
      // Load conversation history from database before processing
      // This ensures the AI has access to previous conversation context
      const conversationId = message.metadata?.conversationId || message.channelUserId;
      const conversationId_db = await this.loadHistoryFromDatabase(conversationId, channelType, userId);
      
      // Option A: Prioritize flow_id from conversation (ensures we use the flow from the last campaign)
      // This guarantees that when a client responds, we use the correct flow/agent
      // Priority order: 1) Explicit flowId from metadata, 2) flow_id from conversation, 3) Router
      if (!routingResult && this.db && conversationId_db) {
        try {
          // Get conversation with its flow_id
          const convFlowResult = await this.db.query(
            `SELECT flow_id FROM conversations WHERE id = $1`,
            [conversationId_db]
          );
          
          if (convFlowResult.rows.length > 0 && convFlowResult.rows[0].flow_id) {
            const conversationFlowId = convFlowResult.rows[0].flow_id as string;
            const requestedChannelId = message.metadata?.channel_config_id as string | undefined;
            
            logger.info('Found flow_id in conversation, using it as first option (sendMessage)', {
              conversationId: conversationId_db,
              flowId: conversationFlowId,
              channelType,
              userId,
            });
            
            // Try to load the flow directly
            const flowResult = await this.db.query(
              `
              SELECT DISTINCT
                f.*,
                l.provider as llm_provider,
                l.model as llm_model,
                l.config as llm_config,
                c.channel_type,
                c.config as channel_config,
                c.id as channel_config_id
              FROM orchestration_flows f
              JOIN llm_configs l ON f.llm_id = l.id
              JOIN flow_channels fc ON f.id = fc.flow_id AND fc.active = true
              JOIN channel_configs c ON fc.channel_id = c.id
              WHERE f.id = $1 
                AND f.active = true
                AND c.channel_type = $2
                AND c.is_active = true
                ${requestedChannelId ? 'AND c.id = $3' : ''}
              ORDER BY ${requestedChannelId ? 'CASE WHEN c.id = $3 THEN 1 ELSE 2 END ASC,' : ''} fc.priority ASC
              LIMIT 1
              `,
              requestedChannelId 
                ? [conversationFlowId, channelType, requestedChannelId]
                : [conversationFlowId, channelType]
            );
            
            if (flowResult.rows.length > 0) {
              const flow = flowResult.rows[0];
              let flowConfig: any = flow.flow_config;
              if (typeof flowConfig === 'string') {
                try {
                  flowConfig = JSON.parse(flowConfig);
                } catch {
                  flowConfig = {};
                }
              }
              
              routingResult = {
                flow: {
                  ...flow,
                  flow_config: flowConfig,
                },
                llmProvider: flow.llm_provider,
                llmModel: flow.llm_model,
                llmConfig: flow.llm_config || {},
                enabledTools: flow.enabled_tools || [],
                channelConfig: flow.channel_config,
                channelConfigId: flow.channel_config_id,
              };
              
              logger.info('Using flow_id from conversation (Option A - sendMessage)', {
                flowId: routingResult.flow.id,
                flowName: routingResult.flow.name,
                channelType,
                userId,
              });
              
            }
          }
        } catch (e: any) {
          logger.debug('Failed to load flow from conversation (non-fatal - sendMessage)', { 
            error: e.message, 
            conversationId: conversationId_db 
          });
        }
      }

      // If no explicit flow or failed to load, use FlowBasedMessageRouter
      if (!routingResult && this.flowRouter) {
        logger.debug('Attempting to route message using FlowBasedMessageRouter', {
          channelType,
          userId,
        });
        routingResult = await this.flowRouter.route(message as any);
        
        if (routingResult) {
          logger.info('Message routed to orchestration flow', {
            flowName: routingResult.flow.name,
            llmProvider: routingResult.llmProvider,
            llmModel: routingResult.llmModel,
            enabledTools: routingResult.enabledTools,
          });
        } else {
          logger.debug('No matching flow found, using default orchestration');
        }
      }

      // Enhance with RAG context if flow is available
      if (routingResult) {
        routingResult = await this.enhanceWithRAGContext(
          routingResult,
          message.content
        );
      }

      // Process message through orchestrator (with or without routing)
      const result = await this.orchestrator.processMessage(message, routingResult);

      // Save messages to database after processing
      // This ensures conversation history is persisted for future interactions
      // Use conversationId_db if available, otherwise use result.conversationId
      const dbConversationId = conversationId_db || result.conversationId;
      await this.saveMessagesToDatabase(
        dbConversationId,
        channelType,
        userId,
        message.content,
        result.outgoingMessage.content,
        result.llmProvider,
        result.llmModel,
        result.tokensUsed,
        result.cost
      );

      // Log orchestrator errors to system_logs for frontend visibility
      if (result.metadata?.error && this.db) {
        try {
          await this.db.query(
            `INSERT INTO system_logs (level, message, service, metadata, stack_trace, user_id, conversation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              'error',
              `Orchestrator error: ${result.metadata.error}`,
              'orchestrator',
              JSON.stringify({
                errorMessage: result.metadata.error,
                errorCode: result.metadata.errorCode,
                conversationId: result.conversationId,
                channel: message.channelType,
                userId: message.channelUserId,
                processingTimeMs: result.processingTimeMs,
              }),
              result.metadata.error || null,
              message.channelUserId,
              message.metadata?.conversationId || result.conversationId || null,
            ]
          );
        } catch (error: any) {
          logger.debug('Failed to log orchestrator error to system_logs', { error: error.message });
        }
      }

      // Log tool execution errors to system_logs for frontend visibility
      if (result.toolExecutions && result.toolExecutions.length > 0 && this.db) {
        for (const toolExec of result.toolExecutions) {
          if (toolExec.status === 'failed') {
            try {
              await this.db.query(
                `INSERT INTO system_logs (level, message, service, metadata, stack_trace, user_id, conversation_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  'error',
                  `Tool execution failed: ${toolExec.toolName}`,
                  'tools',
                  JSON.stringify({
                    toolName: toolExec.toolName,
                    parameters: toolExec.parameters,
                    error: toolExec.error,
                    executionTimeMs: toolExec.executionTimeMs,
                    channel: message.channelType,
                    userId: message.channelUserId,
                  }),
                  toolExec.error || null,
                  message.channelUserId,
                  message.metadata?.conversationId || null,
                ]
              );
            } catch (error: any) {
              logger.debug('Failed to log tool error to system_logs', { error: error.message });
            }
          }
        }
      }

      reply.send({
        success: true,
        data: {
          response: result.outgoingMessage.content,
          conversationId: result.conversationId,
          tokensUsed: result.tokensUsed,
          cost: result.cost,
          llmProvider: result.llmProvider,
          llmModel: result.llmModel,
          toolsExecuted: result.toolExecutions?.map((te) => ({
            toolName: te.toolName,
            status: te.status,
            result: te.result, // Include full tool result for debugging
          })),
          flowUsed: routingResult?.flow.name, // Include flow info
        },
      });
    } catch (error: any) {
      throw new AppError(
        'MESSAGE_PROCESSING_FAILED',
        `Failed to process message: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get conversation history
   * GET /api/v1/conversations/:conversationId
   */
  async getConversation(
    request: FastifyRequest<{
      Params: { conversationId: string };
      Querystring: { limit?: number };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { conversationId } = request.params;
    const { limit = 50 } = request.query;

    try {
      // Get context from MCP server
      // Access mcpServer through orchestrator (it's private, so we use bracket notation)
      const mcpServer = (this.orchestrator as any).mcpServer;
      
      // Try to get context using conversationId as sessionId
      // Note: In some cases, conversationId might be the same as sessionId
      let context = await mcpServer.getContext(conversationId);
      
      // If not found, we might need to search by conversationId
      // For now, we'll return 404 if not found
      if (!context) {
        throw new AppError('NOT_FOUND', 'Conversation not found', 404);
      }

      // Return conversation history
      const history = context.conversationHistory.slice(-limit);

      reply.send({
        success: true,
        data: {
          conversationId,
          userId: context.userId,
          channelType: context.channelType,
          messageCount: context.conversationHistory.length,
          history,
          metadata: context.metadata,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'CONVERSATION_RETRIEVAL_FAILED',
        `Failed to retrieve conversation: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get user conversations
   * GET /api/v1/conversations/user/:userId
   */
  async getUserConversations(
    request: FastifyRequest<{
      Params: { userId: string };
      Querystring: { channelType?: ChannelType; limit?: number };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { userId } = request.params;
    const { channelType, limit = 20 } = request.query;

    try {
      if (!this.db) {
        throw new AppError('DB_NOT_AVAILABLE', 'Database not available', 503);
      }

      // Build query
      let query = `
        SELECT 
          c.id as conversation_id,
          c.channel,
          c.channel_user_id,
          c.started_at,
          c.last_activity,
          c.status,
          c.metadata,
          COUNT(DISTINCT m.id) as message_count,
          MAX(m.timestamp) as last_message_at,
          (
            SELECT content 
            FROM messages 
            WHERE conversation_id = c.id 
            ORDER BY timestamp DESC 
            LIMIT 1
          ) as last_message_content
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.channel_user_id = $1
      `;
      const params: any[] = [userId];
      let paramIndex = 2;

      if (channelType) {
        query += ` AND c.channel = $${paramIndex}`;
        params.push(channelType);
        paramIndex++;
      }

      query += `
        GROUP BY c.id, c.channel, c.channel_user_id, c.started_at, c.last_activity, c.status, c.metadata
        ORDER BY c.last_activity DESC
        LIMIT $${paramIndex}
      `;
      params.push(limit);

      const result = await this.db.query(query, params);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total
        FROM conversations
        WHERE channel_user_id = $1
      `;
      const countParams: any[] = [userId];
      if (channelType) {
        countQuery += ` AND channel = $2`;
        countParams.push(channelType);
      }
      const countResult = await this.db.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total) || 0;

      reply.send({
        success: true,
        data: {
          userId,
          channelType,
          conversations: result.rows.map((row) => ({
            conversationId: row.conversation_id,
            channelType: row.channel,
            channelUserId: row.channel_user_id,
            startedAt: row.started_at,
            lastActivity: row.last_activity,
            status: row.status,
            metadata: row.metadata,
            lastMessage: row.last_message_content || '',
            lastMessageAt: row.last_message_at,
            messageCount: parseInt(row.message_count) || 0,
          })),
          total,
          limit,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error getting user conversations', { error: error.message });
      throw new AppError(
        'GET_USER_CONVERSATIONS_ERROR',
        `Failed to get user conversations: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete conversation
   * DELETE /api/v1/conversations/:conversationId
   */
  async deleteConversation(
    request: FastifyRequest<{
      Params: { conversationId: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { conversationId } = request.params;

    try {
      // Delete from MCP context store
      // Access mcpServer through orchestrator (it's private, so we use bracket notation)
      const mcpServer = (this.orchestrator as any).mcpServer;
      await mcpServer.deleteContext(conversationId);

      reply.send({
        success: true,
        message: 'Conversation deleted successfully',
      });
    } catch (error: any) {
      throw new AppError(
        'CONVERSATION_DELETE_FAILED',
        `Failed to delete conversation: ${error.message}`,
        500
      );
    }
  }
}
