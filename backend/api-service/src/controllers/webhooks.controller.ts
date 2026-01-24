import { FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { AIOrchestrator } from '@cortex/core';
import { FlowBasedMessageRouter } from '@cortex/core/src/router/FlowBasedMessageRouter';
import {
  WhatsAppAdapter,
  TelegramAdapter,
  EmailAdapter,
} from '@cortex/channel-adapters';
import { IncomingMessage, ChannelType, AppError, createLogger, generateSessionId } from '@cortex/shared';
import { EmbeddingService, RAGService } from '../services';
import { getQueueManager, QueueName } from '@cortex/queue-service';

const logger = createLogger('WebhooksController');

/**
 * Webhooks Controller
 * Handles incoming webhooks from various channels
 */
export class WebhooksController {
  private ragService: RAGService | null = null;
  private queueManager: ReturnType<typeof getQueueManager> | null = null;
  private useQueueForWhatsApp: boolean;

  constructor(
    private orchestrator: AIOrchestrator,
    private whatsappAdapter: WhatsAppAdapter,
    private telegramAdapter: TelegramAdapter,
    private emailAdapter: EmailAdapter,
    private flowRouter: FlowBasedMessageRouter,
    private db?: Pool
  ) {
    // Initialize RAG service if database is available
    if (this.db) {
      const embeddingService = new EmbeddingService(this.db);
      this.ragService = new RAGService(this.db, embeddingService);
    }

    // Initialize queue manager - REQUIRED for WhatsApp message sending
    // Queue system is mandatory, no fallback to synchronous sending
    this.useQueueForWhatsApp = process.env.USE_QUEUE_FOR_WHATSAPP !== 'false';
    
    if (this.useQueueForWhatsApp) {
      try {
        this.queueManager = getQueueManager();
        logger.info('WhatsApp queue enabled for message sending');
      } catch (error: any) {
        // CRITICAL ERROR: Queue system is required, fail explicitly
        logger.error('CRITICAL: Failed to initialize queue manager. WhatsApp message sending will fail.', {
          error: error.message,
          stack: error.stack,
        });
        // Keep useQueueForWhatsApp = true so sendWhatsAppMessage will fail explicitly
        // Don't silently fall back to synchronous sending
      }
    } else {
      // If queue is explicitly disabled via env var, log warning
      // sendWhatsAppMessage will still fail explicitly when called
      logger.warn('WhatsApp queue disabled via USE_QUEUE_FOR_WHATSAPP=false. Message sending will fail.');
    }
  }

  /**
   * Enhance routing result with RAG context from knowledge bases
   */
  private async enhanceWithRAGContext(
    routingResult: any,
    queryText: string
  ): Promise<any> {
    if (!this.ragService || !routingResult?.flow?.id) {
      logger.debug('RAG enhancement skipped', {
        hasRagService: !!this.ragService,
        hasFlow: !!routingResult?.flow,
        flowId: routingResult?.flow?.id,
      });
      return routingResult;
    }

    // Skip RAG if query text is empty
    const trimmedQueryText = queryText?.trim() || '';
    if (!trimmedQueryText || trimmedQueryText.length === 0) {
      logger.debug('RAG enhancement skipped: empty query text', {
        flowId: routingResult.flow.id,
        queryText: queryText,
      });
      return routingResult;
    }

    try {
      logger.info('Executing RAG search', {
        flowId: routingResult.flow.id,
        flowName: routingResult.flow.name,
        queryLength: trimmedQueryText.length,
        queryPreview: trimmedQueryText.substring(0, 100),
      });

      const ragResult = await this.ragService.search({
        flowId: routingResult.flow.id,
        queryText: trimmedQueryText,
      });

      logger.info('RAG search completed', {
        flowId: routingResult.flow.id,
        chunksFound: ragResult.chunks.length,
        totalResults: ragResult.totalResults,
        processingTimeMs: ragResult.processingTimeMs,
      });

      if (ragResult.chunks.length > 0) {
        const ragContext = this.ragService.formatContextForPrompt(ragResult.chunks);
        
        logger.debug('RAG context formatted', {
          flowId: routingResult.flow.id,
          contextLength: ragContext.length,
          chunksCount: ragResult.chunks.length,
        });
        
        // Add RAG context to system prompt
        const currentSystemPrompt = routingResult.flow.flow_config?.systemPrompt || '';
        const enhancedSystemPrompt = currentSystemPrompt + ragContext;

        logger.info('RAG context added to system prompt', {
          flowId: routingResult.flow.id,
          originalPromptLength: currentSystemPrompt.length,
          enhancedPromptLength: enhancedSystemPrompt.length,
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
        logger.warn('RAG search returned no chunks', {
          flowId: routingResult.flow.id,
          queryText: trimmedQueryText.substring(0, 100),
        });
      }
    } catch (error: any) {
      logger.error('RAG search failed, continuing without context', {
        error: error.message,
        errorStack: error.stack,
        flowId: routingResult.flow.id,
        queryText: trimmedQueryText.substring(0, 100),
      });
    }

    return routingResult;
  }

  /**
   * Attach conversation metadata (from DB) to MCP context + optionally enrich system prompt
   * - No-op if DB not available or conversation doesn't exist yet
   * - Only affects conversations that already have `metadata.external_context`
   * This is intentionally additive to avoid impacting existing production flows.
   */
  private async attachExternalContextToProcessing(
    normalizedMessage: IncomingMessage,
    routingResult: any | null,
    preferredConversationId?: string | null
  ): Promise<{ routingResult: any | null; conversationId?: string; conversationMetadata?: any }> {
    if (!this.db) return { routingResult };

    const channelType = normalizedMessage.channelType;
    const userId = normalizedMessage.channelUserId;

    try {
      let conv: { rows: Array<{ id: string; metadata: any }> };
      if (preferredConversationId && this.isUuid(preferredConversationId)) {
        conv = await this.db.query(
          `SELECT id, metadata FROM conversations WHERE id = $1 LIMIT 1`,
          [preferredConversationId]
        );
      } else {
        conv = await this.db.query(
          `SELECT id, metadata FROM conversations WHERE channel = $1 AND channel_user_id = $2 ORDER BY last_activity DESC LIMIT 1`,
          [channelType, userId]
        );
      }

      if (conv.rows.length === 0) {
        return { routingResult };
      }

      const conversationId = conv.rows[0].id as string;
      const conversationMetadata = conv.rows[0].metadata || {};

      if (!normalizedMessage.metadata) normalizedMessage.metadata = {};
      if (!normalizedMessage.metadata.conversationId) {
        normalizedMessage.metadata.conversationId = conversationId;
      }

      const externalContext = conversationMetadata?.external_context;
      if (!externalContext || typeof externalContext !== 'object') {
        return { routingResult, conversationId, conversationMetadata };
      }

      // Safe log (do not print seed values)
      try {
        const namespaces = Object.keys(externalContext || {});
        const sample = namespaces.slice(0, 5).reduce((acc: any, ns: string) => {
          const entry = externalContext?.[ns] || {};
          acc[ns] = {
            case_id: entry.case_id || null,
            refsKeys: entry.refs ? Object.keys(entry.refs) : [],
            seedKeys: entry.seed ? Object.keys(entry.seed) : [],
          };
          return acc;
        }, {});
        logger.info('External context detected for conversation (will attach to prompt)', {
          conversationId,
          channelType,
          userId,
          namespaces,
          sample,
        });
      } catch {
        // ignore
      }

      // Verbose log (PII risk): show the exact external_context JSON (truncated)
      if (this.envFlag('LOG_EXTERNAL_CONTEXT_JSON')) {
        logger.warn('External context JSON (VERBOSE)', {
          conversationId,
          channelType,
          userId,
          external_context: this.truncateText(externalContext, 4000),
        });
      }

      // Ensure MCP context exists and update its metadata before processing
      try {
        const mcpServer = (this.orchestrator as any).mcpServer;
        const contextManager = (this.orchestrator as any).contextManager;
        if (mcpServer && contextManager) {
          const mcpContext = await contextManager.getOrCreateContext(
            conversationId,
            channelType,
            userId
          );
          const sessionId = mcpContext.sessionId || generateSessionId(channelType, userId, conversationId);
          const existing = await mcpServer.getContext(sessionId);
          if (existing) {
            const merged = {
              ...(existing.metadata || {}),
              ...(conversationMetadata || {}),
              external_context: {
                ...(existing.metadata?.external_context || {}),
                ...(conversationMetadata?.external_context || {}),
              },
            };
            await mcpServer.updateContext(sessionId, {
              conversationId,
              metadata: merged,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (e: any) {
        logger.debug('Failed to sync external context into MCP context (non-fatal)', {
          error: e.message,
          userId,
        });
      }

      // Enrich system prompt only if flow routing exists
      if (routingResult?.flow?.flow_config) {
        const currentSystemPrompt = routingResult.flow.flow_config?.systemPrompt || '';
        const externalContextText = this.formatExternalContextForPrompt(externalContext);
        if (externalContextText) {
          const enhancedSystemPrompt =
            currentSystemPrompt +
            `\n\n` +
            externalContextText +
            `\n\n` +
            `You may use the external_context data above to personalize and handle this conversation. ` +
            `If you have tools available to fetch/update external case details using the provided identifiers, use them when needed.`;

          if (this.envFlag('LOG_ENHANCED_SYSTEM_PROMPT')) {
            logger.warn('Enhanced system prompt (VERBOSE)', {
              conversationId,
              channelType,
              userId,
              systemPrompt: this.truncateText(enhancedSystemPrompt, 4000),
            });
          }

          routingResult = {
            ...routingResult,
            flow: {
              ...routingResult.flow,
              flow_config: {
                ...routingResult.flow.flow_config,
                systemPrompt: enhancedSystemPrompt,
              },
            },
          };
        }
      }

      return { routingResult, conversationId, conversationMetadata };
    } catch (e: any) {
      logger.debug('Failed to attach external context (non-fatal)', { error: e.message });
      return { routingResult };
    }
  }

  private formatExternalContextForPrompt(externalContext: any): string | null {
    try {
      const json = JSON.stringify(externalContext, null, 2);
      if (!json || json === 'null' || json === '{}') return null;
      // Hard cap to avoid giant prompts
      const capped = json.length > 4000 ? json.substring(0, 4000) + '\n...truncated...' : json;
      return `EXTERNAL_CONTEXT_JSON:\n${capped}`;
    } catch {
      return null;
    }
  }

  private envFlag(name: string): boolean {
    const v = String(process.env[name] || '').toLowerCase().trim();
    return v === 'true' || v === '1' || v === 'yes';
  }

  /**
   * Load conversation history from DB and restore to MCP context for the given conversation.
   * Ensures the orchestrator uses only this conversation's history (avoids mixing between flows).
   */
  private async loadAndRestoreHistoryForConversation(
    conversationId: string,
    channelType: ChannelType,
    userId: string
  ): Promise<void> {
    if (!this.db || !this.isUuid(conversationId)) return;
    const contextManager = (this.orchestrator as any)?.contextManager;
    if (!contextManager) return;
    try {
      const messagesResult = await this.db.query(
        `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC LIMIT 100`,
        [conversationId]
      );
      if (messagesResult.rows.length === 0) return;

      const mcpContext = await contextManager.getOrCreateContext(conversationId, channelType, userId);
      await contextManager.clearHistory(mcpContext.sessionId);
      for (const msg of messagesResult.rows) {
        await contextManager.addMessage(
          mcpContext.sessionId,
          msg.role as 'user' | 'assistant' | 'system',
          msg.content
        );
      }
      logger.info('Restored conversation history from database for WhatsApp', {
        conversationId,
        messageCount: messagesResult.rows.length,
        channelType,
        userId,
      });
    } catch (e: any) {
      logger.debug('Failed to load/restore history for conversation (non-fatal)', {
        conversationId,
        error: e.message,
      });
    }
  }

  private truncateText(text: any, max = 2000): string {
    const s = typeof text === 'string' ? text : JSON.stringify(text);
    if (s.length <= max) return s;
    return s.slice(0, max) + '…[truncated]';
  }

  private isUuid(value: any): boolean {
    if (!value || typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private extractExplicitFlowIdFromConversationMetadata(conversationMetadata: any): string | undefined {
    if (!conversationMetadata || typeof conversationMetadata !== 'object') return undefined;
    if (typeof conversationMetadata.flowId === 'string' && this.isUuid(conversationMetadata.flowId)) {
      return conversationMetadata.flowId;
    }

    const external = conversationMetadata.external_context;
    if (!external || typeof external !== 'object') return undefined;
    for (const ns of Object.keys(external)) {
      const flowId = external?.[ns]?.routing?.flowId;
      if (typeof flowId === 'string' && this.isUuid(flowId)) return flowId;
    }
    return undefined;
  }

  /**
   * Try to load flow routing from conversation's flow_id (Option A: prioritize conversation flow_id)
   * This ensures that when a client responds, we use the flow from the last campaign sent
   * Now supports multiple conversations per number (one per flow_id)
   * Returns both routing result and conversationId so we use the same conversation for context/history.
   */
  private async tryLoadFlowFromConversation(
    channelType: ChannelType,
    userId: string,
    requestedChannelId?: string
  ): Promise<{ routingResult: any; conversationId: string } | null> {
    if (!this.db) return null;
    try {
      const convResult = await this.db.query(
        `SELECT id, flow_id FROM conversations 
         WHERE channel = $1 AND channel_user_id = $2 AND flow_id IS NOT NULL
         ORDER BY last_activity DESC
         LIMIT 1`,
        [channelType, userId]
      );

      if (convResult.rows.length === 0 || !convResult.rows[0].flow_id) {
        return null;
      }

      const conversationId = convResult.rows[0].id as string;
      const conversationFlowId = convResult.rows[0].flow_id as string;

      logger.info('Found flow_id in conversation, using it as first option', {
        conversationId,
        flowId: conversationFlowId,
        channelType,
        userId,
      });

      const routingResult = await this.tryLoadExplicitFlowRouting(conversationFlowId, channelType, requestedChannelId);
      if (!routingResult) return null;
      return { routingResult, conversationId };
    } catch (e: any) {
      logger.debug('Failed to load flow from conversation (non-fatal)', {
        error: e.message,
        channelType,
        userId,
      });
      return null;
    }
  }

  private async tryLoadExplicitFlowRouting(
    flowId: string,
    channelType: ChannelType,
    requestedChannelId?: string
  ): Promise<any | null> {
    if (!this.db) return null;
    try {
      const flowResult = await this.db.query(
        `
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
        `,
        [flowId, channelType, requestedChannelId || '']
      );

      if (flowResult.rows.length === 0) return null;

      const flow = flowResult.rows[0];
      let flowConfig: any = flow.flow_config;
      if (typeof flowConfig === 'string') {
        try {
          flowConfig = JSON.parse(flowConfig);
        } catch {
          flowConfig = {};
        }
      }

      return {
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
    } catch (e: any) {
      logger.debug('Failed to load explicit flow routing (non-fatal)', { error: e.message, flowId });
      return null;
    }
  }

  /**
   * Identify WhatsApp channel from webhook payload
   * Returns channel_id (UUID) by matching provider-specific identifiers
   */
  private async identifyWhatsAppChannelFromWebhook(
    webhookPayload: any
  ): Promise<string | undefined> {
    if (!this.db) {
      logger.debug('Cannot identify channel: no DB available');
      return undefined;
    }

    try {
      // Strategy 1: Ultramsg - match by instanceId
      if (webhookPayload.instanceId) {
        const instanceIdFromWebhook = String(webhookPayload.instanceId).trim();
        
        // Normalize: remove "instance" prefix if present in webhook (shouldn't happen, but handle it)
        const normalizedWebhookInstanceId = instanceIdFromWebhook.replace(/^instance/i, '');
        
        logger.debug('Identifying channel for Ultramsg webhook', {
          instanceId: instanceIdFromWebhook,
          normalizedInstanceId: normalizedWebhookInstanceId,
          instanceIdType: typeof webhookPayload.instanceId,
        });
        
        // Helper function to normalize instanceId (remove "instance" prefix)
        const normalizeInstanceId = (id: string | null): string | null => {
          if (!id) return null;
          const str = String(id).trim();
          // Remove "instance" prefix if present (case insensitive)
          return str.replace(/^instance/i, '');
        };
        
        // First try: exact string match (with and without prefix)
        let result = await this.db.query(
          `SELECT id, config->>'instanceId' as db_instance_id, config->>'provider' as db_provider
           FROM channel_configs
           WHERE channel_type = 'whatsapp'
             AND is_active = true
             AND (config->>'provider' = 'ultramsg' OR config->>'provider' IS NULL)
             AND (
               config->>'instanceId' = $1 
               OR config->>'instanceId' = $2
               OR config->>'instanceId' = $3
             )
           LIMIT 1`,
          [
            instanceIdFromWebhook,                    // Exact match
            `instance${normalizedWebhookInstanceId}`, // With prefix
            normalizedWebhookInstanceId                // Without prefix
          ]
        );

        if (result.rows.length > 0) {
          const channelId = result.rows[0].id;
          logger.info('Identified Ultramsg channel from webhook (exact match)', {
            instanceId: instanceIdFromWebhook,
            channelId,
            dbInstanceId: result.rows[0].db_instance_id,
            dbProvider: result.rows[0].db_provider,
          });
          return channelId;
        }

        // Second try: flexible match - get all WhatsApp channels and compare manually
        // This handles cases where provider is null or instanceId has different formats
        result = await this.db.query(
          `SELECT id, config->>'instanceId' as db_instance_id, config->>'provider' as db_provider, config
           FROM channel_configs
           WHERE channel_type = 'whatsapp'
             AND is_active = true
             AND (config->>'provider' = 'ultramsg' OR config->>'provider' IS NULL)`
        );

        logger.debug('Checking Ultramsg channels for instanceId match', {
          instanceIdFromWebhook,
          normalizedInstanceId: normalizedWebhookInstanceId,
          channelsFound: result.rows.length,
        });

        for (const row of result.rows) {
          const dbInstanceId = row.db_instance_id ? String(row.db_instance_id).trim() : null;
          
          if (!dbInstanceId) continue;
          
          // Normalize both IDs for comparison
          const normalizedDbInstanceId = normalizeInstanceId(dbInstanceId);
          const normalizedWebhookId = normalizedWebhookInstanceId;
          
          // Compare normalized IDs (handles "instance148415" vs "148415")
          if (normalizedDbInstanceId && normalizedDbInstanceId === normalizedWebhookId) {
            const channelId = row.id;
            logger.info('Identified Ultramsg channel from webhook (normalized match)', {
              instanceId: instanceIdFromWebhook,
              normalizedInstanceId: normalizedWebhookId,
              channelId,
              dbInstanceId,
              normalizedDbInstanceId,
              dbProvider: row.db_provider || 'null (defaulting to ultramsg)',
            });
            return channelId;
          }
        }

        // Log all available channels for debugging
        logger.debug('Available Ultramsg channels in database', {
          instanceIdFromWebhook,
          normalizedInstanceId: normalizedWebhookInstanceId,
          availableChannels: result.rows.map((r: any) => ({
            id: r.id,
            instanceId: r.db_instance_id,
            normalizedInstanceId: normalizeInstanceId(r.db_instance_id),
            provider: r.db_provider || 'null',
          })),
        });
      }

      // Strategy 2: Twilio - match by AccountSid
      if (webhookPayload.AccountSid) {
        logger.debug('Identifying channel for Twilio webhook', {
          accountSid: webhookPayload.AccountSid,
        });
        
        const result = await this.db.query(
          `SELECT id
           FROM channel_configs
           WHERE channel_type = 'whatsapp'
             AND is_active = true
             AND config->>'provider' = 'twilio'
             AND config->>'accountSid' = $1
           LIMIT 1`,
          [webhookPayload.AccountSid]
        );

        if (result.rows.length > 0) {
          const channelId = result.rows[0].id;
          logger.info('Identified Twilio channel from webhook', {
            accountSid: webhookPayload.AccountSid,
            channelId,
          });
          return channelId;
        }
      }

      // Strategy 3: 360dialog - match by phone_number_id
      if (webhookPayload.object === 'whatsapp_business_account' && webhookPayload.entry) {
        const entry = webhookPayload.entry[0];
        const changes = entry.changes?.[0];
        const value = changes?.value;
        const phoneNumberId = value?.metadata?.phone_number_id || entry.id;

        if (phoneNumberId) {
          logger.debug('Identifying channel for 360dialog webhook', {
            phoneNumberId,
          });
          
          const result = await this.db.query(
            `SELECT id
             FROM channel_configs
             WHERE channel_type = 'whatsapp'
               AND is_active = true
               AND config->>'provider' = '360dialog'
               AND config->>'phoneNumberId' = $1
             LIMIT 1`,
            [phoneNumberId]
          );

          if (result.rows.length > 0) {
            const channelId = result.rows[0].id;
            logger.info('Identified 360dialog channel from webhook', {
              phoneNumberId,
              channelId,
            });
            return channelId;
          }
        }
      }

      // Strategy 4: Try to match by phone number (fallback)
      // Extract phone number from different webhook formats
      let phoneNumber: string | undefined;
      
      if (webhookPayload.data?.to) {
        // Ultramsg format: data.to (e.g., "593995906687@c.us")
        phoneNumber = webhookPayload.data.to.split('@')[0];
      } else if (webhookPayload.To) {
        // Twilio format: To (e.g., "whatsapp:+593995906687")
        phoneNumber = webhookPayload.To.replace(/^whatsapp:/, '').replace(/^\+/, '');
      } else if (webhookPayload.object === 'whatsapp_business_account' && webhookPayload.entry) {
        // 360dialog format: extract from metadata (phone number might be in contacts or other fields)
        // Note: phone_number_id was already tried above, so we skip here
        // Could potentially extract from contacts if needed
      }

      if (phoneNumber) {
        // Normalize phone number: remove + and any non-digit characters except leading digits
        const normalizedPhone = phoneNumber.replace(/^\+/, '').replace(/\D/g, '');
        
        logger.debug('Trying to identify channel by phone number', {
          originalPhoneNumber: phoneNumber,
          normalizedPhone,
        });
        
        // Try exact match first
        let result = await this.db.query(
          `SELECT id
           FROM channel_configs
           WHERE channel_type = 'whatsapp'
             AND is_active = true
             AND (config->>'phoneNumber' = $1 OR config->>'phoneNumber' = $2)
           LIMIT 1`,
          [phoneNumber, normalizedPhone]
        );

        if (result.rows.length === 0 && normalizedPhone !== phoneNumber) {
          // Try with + prefix
          result = await this.db.query(
            `SELECT id
             FROM channel_configs
             WHERE channel_type = 'whatsapp'
               AND is_active = true
               AND config->>'phoneNumber' = $1
             LIMIT 1`,
            [`+${normalizedPhone}`]
          );
        }

        if (result.rows.length > 0) {
          const channelId = result.rows[0].id;
          logger.info('Identified channel by phone number', {
            phoneNumber,
            normalizedPhone,
            channelId,
          });
          return channelId;
        }
      }

      // Get all available WhatsApp channels for debugging
      const allChannels = await this.db.query(
        `SELECT id, config->>'provider' as provider, 
                config->>'instanceId' as instance_id,
                config->>'phoneNumber' as phone_number,
                config->>'accountSid' as account_sid
         FROM channel_configs
         WHERE channel_type = 'whatsapp'
           AND is_active = true`
      );

      logger.warn('Could not identify WhatsApp channel from webhook', {
        hasInstanceId: !!webhookPayload.instanceId,
        instanceId: webhookPayload.instanceId || null,
        hasAccountSid: !!webhookPayload.AccountSid,
        accountSid: webhookPayload.AccountSid || null,
        has360dialogFormat: webhookPayload.object === 'whatsapp_business_account',
        phoneNumber: phoneNumber || 'not found',
        availableChannels: allChannels.rows.map((r: any) => ({
          id: r.id,
          provider: r.provider,
          instanceId: r.instance_id,
          phoneNumber: r.phone_number,
          accountSid: r.account_sid,
        })),
        webhookPayloadKeys: Object.keys(webhookPayload),
      });

      return undefined;
    } catch (error: any) {
      logger.error('Error identifying WhatsApp channel from webhook', {
        error: error.message,
        stack: error.stack,
      });
      return undefined;
    }
  }

  /**
   * Get channel configuration from database by channel_id (UUID)
   */
  private async getChannelConfigById(
    channelId?: string
  ): Promise<any | undefined> {
    if (!this.db || !channelId) {
      logger.debug('Cannot get channel config: no DB or channelId', {
        hasDb: !!this.db,
        channelId,
      });
      return undefined;
    }

    try {
      logger.debug('Querying channel config from database by channel_id', { channelId });
      
      // Query for channel config by channel_id (UUID)
      const result = await this.db.query(
        `SELECT config, id as channel_id
         FROM channel_configs 
         WHERE id = $1 
           AND channel_type = 'whatsapp' 
           AND is_active = true
         LIMIT 1`,
        [channelId]
      );

      if (result.rows.length > 0 && result.rows[0].config) {
        const config = result.rows[0].config;
        const channelConfig = {
          provider: config.provider || 'ultramsg',
          apiToken: config.token || config.apiToken,
          instanceId: config.instanceId, // Ultramsg instanceId (from config, not channel identifier)
          phoneNumber: config.phoneNumber || '',
          phoneNumberId: config.phoneNumberId, // 360dialog
          accountSid: config.accountSid, // Twilio
          authToken: config.authToken, // Twilio
          webhookUrl: config.webhookUrl || '',
          webhookSecret: config.webhookSecret,
          wabaId: config.wabaId, // 360dialog (optional)
        };
        
        logger.info('Channel config retrieved from database', {
          channelId,
          foundInstanceId: channelConfig.instanceId,
          hasToken: !!channelConfig.apiToken,
        });
        
        // Return WhatsAppConfig format
        return channelConfig;
      } else {
        logger.warn('No channel config found in database', {
          channelId,
          rowsFound: result.rows.length,
        });
      }
    } catch (error: any) {
      logger.error('Failed to get channel config from database', { 
        error: error.message,
        channelId,
        stack: error.stack,
      });
    }

    return undefined;
  }

  /**
   * Get channel configuration from routing result
   */
  private async getChannelConfigFromRoutingResult(
    routingResult: any
  ): Promise<any | undefined> {
    logger.debug('Getting channel config from routing result', {
      hasChannelConfig: !!routingResult.channelConfig,
      channelConfigId: routingResult.channelConfigId,
    });

    // First try to use channel config from routing result
    if (routingResult.channelConfig) {
      try {
        const config = routingResult.channelConfig;
        const channelConfig = {
          provider: config.provider || 'ultramsg',
          apiToken: config.token || config.apiToken,
          instanceId: config.instanceId, // Ultramsg instanceId (from config, not channel identifier)
          phoneNumber: config.phoneNumber || '',
          phoneNumberId: config.phoneNumberId, // 360dialog
          accountSid: config.accountSid, // Twilio
          authToken: config.authToken, // Twilio
          webhookUrl: config.webhookUrl || '',
          webhookSecret: config.webhookSecret,
          wabaId: config.wabaId, // 360dialog (optional)
        };
        
        logger.info('Using channel config from routing result', {
          instanceId: channelConfig.instanceId,
          hasToken: !!channelConfig.apiToken,
          provider: channelConfig.provider,
        });
        
        return channelConfig;
      } catch (error: any) {
        logger.error('Failed to parse channel config from routing result', { 
          error: error.message,
          stack: error.stack,
        });
      }
    }

    // Fallback: get from database using channel_config_id
    if (routingResult.channelConfigId) {
      logger.debug('Falling back to database query for channel config', {
        channelConfigId: routingResult.channelConfigId,
      });
      return await this.getChannelConfigById(routingResult.channelConfigId);
    }

    logger.warn('No channel config available from routing result', {
      hasChannelConfig: !!routingResult.channelConfig,
      hasChannelConfigId: !!routingResult.channelConfigId,
    });

    return undefined;
  }

  /**
   * Send WhatsApp message using queue (with retries)
   * REQUIRES: Queue system must be available, no fallback to synchronous sending
   */
  private async sendWhatsAppMessage(
    userId: string,
    message: {
      channelUserId: string;
      content: string;
      metadata?: any;
    },
    channelConfig?: any
  ): Promise<void> {
    // Queue system is REQUIRED - fail explicitly if not available
    if (!this.useQueueForWhatsApp || !this.queueManager) {
      const errorMsg = 'WhatsApp queue system is not available. Cannot send message.';
      logger.error(errorMsg, {
        userId,
        useQueueForWhatsApp: this.useQueueForWhatsApp,
        hasQueueManager: !!this.queueManager,
      });
      throw new Error(errorMsg);
    }

    try {
      // Convert channelConfig to the format expected by the queue job
      const queueChannelConfig = channelConfig ? {
        provider: channelConfig.provider || 'ultramsg',
        instanceId: channelConfig.instanceId,
        apiToken: channelConfig.apiToken,
        phoneNumber: channelConfig.phoneNumber,
        phoneNumberId: channelConfig.phoneNumberId, // 360dialog
        accountSid: channelConfig.accountSid, // Twilio
        authToken: channelConfig.authToken, // Twilio
        wabaId: channelConfig.wabaId, // 360dialog (optional)
      } : {
        provider: 'ultramsg' as const,
        instanceId: undefined,
        apiToken: undefined,
        phoneNumber: undefined,
        phoneNumberId: undefined,
        accountSid: undefined,
        authToken: undefined,
        wabaId: undefined,
      };

      // Add job to queue with retry configuration
      const jobId = await this.queueManager.addJob(
        QueueName.WHATSAPP_SENDING,
        'send-whatsapp-message',
        {
          userId,
          message,
          channelConfig: queueChannelConfig,
        },
        {
          attempts: 5, // 5 attempts for retryable errors
          backoff: {
            type: 'exponential',
            delay: 3000, // Start with 3 seconds, then 6, 12, 24, 48
          },
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );

      logger.info('WhatsApp message queued for sending', {
        jobId,
        userId,
        messageLength: message.content?.length || 0,
        hasChannelConfig: !!channelConfig,
        instanceId: channelConfig?.instanceId,
      });

      // Return immediately - message will be sent asynchronously by worker
      return;
    } catch (error: any) {
      // CRITICAL ERROR: Failed to queue message - fail explicitly, no fallback
      logger.error('CRITICAL: Failed to queue WhatsApp message. Message will not be sent.', {
        error: error.message,
        errorStack: error.stack,
        userId,
        messageLength: message.content?.length || 0,
        hasChannelConfig: !!channelConfig,
      });
      
      // Throw error explicitly - let the caller handle it
      throw new Error(`Failed to queue WhatsApp message: ${error.message}`);
    }
  }

  /**
   * Save conversation and messages to database
   */
  private async saveConversationAndMessages(
    normalizedMessage: IncomingMessage,
    result: any,
    routingResult: any
  ): Promise<void> {
    logger.info('saveConversationAndMessages called', {
      hasDb: !!this.db,
      hasResult: !!result,
      conversationId: result?.conversationId,
      channelType: normalizedMessage?.channelType,
      userId: normalizedMessage?.channelUserId,
    });

    if (!this.db) {
      logger.error('Database not available, skipping conversation save');
      await this.logSystemEvent('error', 'Database not available in WebhooksController', {
        service: 'webhooks',
        metadata: {
          conversationId: result?.conversationId,
          channelType: normalizedMessage?.channelType,
        },
      });
      return;
    }

    try {
      // Validate conversationId - it must be a valid UUID
      // The orchestrator may return a phone number or other string, so we validate
      const conversationId = result.conversationId;
      const channelType = normalizedMessage.channelType;
      const userId = normalizedMessage.channelUserId;

      // UUID validation regex
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isValidUUID = conversationId && typeof conversationId === 'string' && uuidRegex.test(conversationId);

      // Find or create conversation
      // Now supports multiple conversations per number (one per flow_id)
      const flowId = routingResult?.flow?.id || null;
      let convResult: any = { rows: [] };
      
      if (isValidUUID) {
        // First try to find by conversationId
        convResult = await this.db.query(
          `SELECT id, flow_id FROM conversations WHERE id = $1`,
          [conversationId]
        );
        
        // If not found by ID, search by channel, userId, and flow_id
        if (convResult.rows.length === 0 && flowId) {
          convResult = await this.db.query(
            `SELECT id, flow_id FROM conversations 
             WHERE channel = $1 AND channel_user_id = $2 AND flow_id = $3
             LIMIT 1`,
            [channelType, userId, flowId]
          );
        }
        
        // If still not found, search by channel and userId (most recent)
        if (convResult.rows.length === 0) {
          convResult = await this.db.query(
            `SELECT id, flow_id FROM conversations 
             WHERE channel = $1 AND channel_user_id = $2
             ORDER BY last_activity DESC
             LIMIT 1`,
            [channelType, userId]
          );
        }
      } else {
        // If conversationId is not a valid UUID, search by channel, userId, and flow_id
        if (flowId) {
          convResult = await this.db.query(
            `SELECT id, flow_id FROM conversations 
             WHERE channel = $1 AND channel_user_id = $2 AND flow_id = $3
             LIMIT 1`,
            [channelType, userId, flowId]
          );
        }
        
        // If not found with flow_id, get most recent conversation
        if (convResult.rows.length === 0) {
          convResult = await this.db.query(
            `SELECT id, flow_id FROM conversations 
             WHERE channel = $1 AND channel_user_id = $2
             ORDER BY last_activity DESC
             LIMIT 1`,
            [channelType, userId]
          );
        }
      }

      let conversationId_db: string;
      
      // Get channel_config_id from normalizedMessage metadata if available
      let channelConfigId: string | undefined = normalizedMessage.metadata?.channelId || 
                              normalizedMessage.metadata?.channel_config_id ||
                              routingResult?.channelConfigId;
      
      // Ensure channelConfigId is a string (UUID) if it exists
      if (channelConfigId) {
        if (typeof channelConfigId !== 'string') {
          channelConfigId = String(channelConfigId);
        }
        // Basic UUID validation - if invalid, set to undefined
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(channelConfigId)) {
          logger.warn('Invalid UUID format for channel_config_id, ignoring', {
            channelConfigId,
            channelType,
            userId,
          });
          channelConfigId = undefined;
        }
      }
      
      if (convResult.rows.length === 0) {
        // Create new conversation with flow_id and channel_config_id
        // Now supports multiple conversations per number (one per flow_id)
        const conversationMetadata: any = {
          flowId: routingResult?.flow?.id,
          flowName: routingResult?.flow?.name,
        };
        
        // Add channel_config_id to metadata if available and valid
        if (channelConfigId) {
          conversationMetadata.channel_config_id = channelConfigId;
        }
        
        const insertQuery = isValidUUID
          ? `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_activity, status, metadata, flow_id)
             VALUES ($1, $2, $3, NOW(), NOW(), 'active', $4, $5)
             RETURNING id`
          : `INSERT INTO conversations (channel, channel_user_id, started_at, last_activity, status, metadata, flow_id)
             VALUES ($1, $2, NOW(), NOW(), 'active', $3, $4)
             RETURNING id`;
        
        const insertParams = isValidUUID
          ? [
              conversationId,
              channelType,
              userId,
              JSON.stringify(conversationMetadata),
              flowId,
            ]
          : [
              channelType,
              userId,
              JSON.stringify(conversationMetadata),
              flowId,
            ];
        
        try {
          const insertResult = await this.db.query(insertQuery, insertParams);
          conversationId_db = insertResult.rows[0].id;
          logger.info('Created new conversation', {
            conversationId: conversationId_db,
            flowId,
            channelType,
            userId,
          });
        } catch (insertError: any) {
          // If unique constraint violation, try to find existing conversation
          if (insertError.code === '23505') {
            logger.debug('Unique constraint violation, searching for existing conversation', {
              channelType,
              userId,
              flowId,
            });
            const existingResult = await this.db.query(
              `SELECT id FROM conversations 
               WHERE channel = $1 AND channel_user_id = $2 AND flow_id = $3
               LIMIT 1`,
              [channelType, userId, flowId]
            );
            if (existingResult.rows.length > 0) {
              conversationId_db = existingResult.rows[0].id;
              logger.info('Found existing conversation after constraint violation', {
                conversationId: conversationId_db,
                flowId,
              });
            } else {
              throw insertError;
            }
          } else {
            throw insertError;
          }
        }
      } else {
        conversationId_db = convResult.rows[0].id;
        const existingFlowId = convResult.rows[0]?.flow_id;
        
        // If flow_id is different, create a new conversation instead of updating
        if (flowId && existingFlowId && existingFlowId !== flowId) {
          logger.info('Flow_id mismatch, creating new conversation', {
            existingConversationId: conversationId_db,
            existingFlowId,
            newFlowId: flowId,
            channelType,
            userId,
            reason: 'Different flow_id requires separate conversation',
          });
          
          // Create new conversation with the new flow_id
          const conversationMetadata: any = {
            flowId: routingResult?.flow?.id,
            flowName: routingResult?.flow?.name,
          };
          
          if (channelConfigId) {
            conversationMetadata.channel_config_id = channelConfigId;
          }
          
          try {
            const newConvResult = await this.db.query(
              `INSERT INTO conversations (channel, channel_user_id, started_at, last_activity, status, metadata, flow_id)
               VALUES ($1, $2, NOW(), NOW(), 'active', $3, $4)
               RETURNING id`,
              [channelType, userId, JSON.stringify(conversationMetadata), flowId]
            );
            conversationId_db = newConvResult.rows[0].id;
            logger.info('Created new conversation for different flow_id', {
              conversationId: conversationId_db,
              flowId,
            });
          } catch (insertError: any) {
            // If unique constraint violation, conversation already exists
            if (insertError.code === '23505') {
              const existingResult = await this.db.query(
                `SELECT id FROM conversations 
                 WHERE channel = $1 AND channel_user_id = $2 AND flow_id = $3
                 LIMIT 1`,
                [channelType, userId, flowId]
              );
              if (existingResult.rows.length > 0) {
                conversationId_db = existingResult.rows[0].id;
                logger.info('Found existing conversation with matching flow_id', {
                  conversationId: conversationId_db,
                  flowId,
                });
              } else {
                // Fallback: use existing conversation
                logger.warn('Could not create new conversation, using existing', {
                  conversationId: conversationId_db,
                  error: insertError.message,
                });
              }
            } else {
              // Fallback: use existing conversation
              logger.warn('Error creating new conversation, using existing', {
                conversationId: conversationId_db,
                error: insertError.message,
              });
            }
          }
        } else if (flowId && !existingFlowId) {
          // Set flow_id if it wasn't set
          await this.db.query(
            `UPDATE conversations SET flow_id = $1 WHERE id = $2`,
            [flowId, conversationId_db]
          );
          logger.info('Set flow_id on existing conversation', {
            conversationId: conversationId_db,
            flowId,
          });
        }
        
        // Update metadata to include channel_config_id if not already present
        if (channelConfigId) {
          const currentMetadata = await this.db.query(
            `SELECT metadata FROM conversations WHERE id = $1`,
            [conversationId_db]
          );
          
          if (currentMetadata.rows.length > 0) {
            const existingMetadata = currentMetadata.rows[0].metadata || {};
            if (!existingMetadata.channel_config_id) {
              existingMetadata.channel_config_id = channelConfigId;
              await this.db.query(
                `UPDATE conversations SET metadata = $1 WHERE id = $2`,
                [JSON.stringify(existingMetadata), conversationId_db]
              );
              logger.debug('Updated conversation metadata with channel_config_id', {
                conversationId: conversationId_db,
                channelConfigId,
              });
            }
          }
        }
      }

      // Update conversation last_activity
      await this.db.query(
        `UPDATE conversations SET last_activity = NOW() WHERE id = $1`,
        [conversationId_db]
      );

      // Save user message
      // Include messageId in metadata for deduplication checking
      await this.db.query(
        `INSERT INTO messages (conversation_id, role, content, timestamp, metadata)
         VALUES ($1, 'user', $2, NOW(), $3)`,
        [
          conversationId_db,
          normalizedMessage.content,
          JSON.stringify({
            channelType,
            userId,
            originalMessage: {
              ...normalizedMessage,
              id: normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id, // Ensure messageId is stored for deduplication
              messageId: normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id, // Also store as messageId for compatibility
            },
          }),
        ]
      );

      // Save assistant message
      await this.db.query(
        `INSERT INTO messages (
          conversation_id, 
          role, 
          content, 
          timestamp, 
          llm_provider, 
          llm_model, 
          tokens_used, 
          cost, 
          metadata
        )
         VALUES ($1, 'assistant', $2, NOW(), $3, $4, $5, $6, $7)`,
        [
          conversationId_db,
          result.outgoingMessage.content,
          result.llmProvider || null,
          result.llmModel || null,
          result.tokensUsed ? JSON.stringify(result.tokensUsed) : null,
          result.cost || null,
          JSON.stringify({
            processingTimeMs: result.processingTimeMs,
            toolExecutions: result.toolExecutions?.length || 0,
            flowId: routingResult?.flow?.id,
            flowName: routingResult?.flow?.name,
          }),
        ]
      );

      // Save tool executions
      if (result.toolExecutions && result.toolExecutions.length > 0) {
        // Get the last message ID (assistant message)
        const lastMessageResult = await this.db.query(
          `SELECT id FROM messages 
           WHERE conversation_id = $1 AND role = 'assistant'
           ORDER BY timestamp DESC LIMIT 1`,
          [conversationId_db]
        );

        if (lastMessageResult.rows.length > 0) {
          const messageId = lastMessageResult.rows[0].id;

          for (const toolExec of result.toolExecutions) {
            // Map status to valid database values
            // Database constraint only allows: 'success', 'error', 'timeout'
            let dbStatus: string;
            const status = toolExec.status as string;
            if (status === 'success') {
              dbStatus = 'success';
            } else if (status === 'timeout') {
              dbStatus = 'timeout';
            } else if (status === 'failed' || toolExec.error) {
              dbStatus = 'error'; // Map 'failed' to 'error'
            } else {
              // Default to 'error' if status is unknown or invalid
              dbStatus = 'error';
            }

            await this.db.query(
              `INSERT INTO tool_executions (
                message_id,
                tool_name,
                parameters,
                result,
                execution_time_ms,
                status,
                error,
                executed_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
              [
                messageId,
                toolExec.toolName,
                JSON.stringify(toolExec.parameters || {}),
                toolExec.result ? JSON.stringify(toolExec.result) : null,
                toolExec.executionTimeMs || null,
                dbStatus, // Use mapped status
                toolExec.error || null,
              ]
            );
          }
        }
      }

      // Save analytics event
      try {
        await this.db.query(
          `INSERT INTO analytics_events (
            event_type,
            channel,
            llm_provider,
            timestamp,
            latency_ms,
            tokens,
            cost,
            metadata
          )
          VALUES ($1, $2, $3, NOW(), $4, $5::jsonb, $6, $7::jsonb)`,
          [
            'message_processed',
            channelType,
            result.llmProvider || null,
            result.processingTimeMs || null,
            result.tokensUsed ? JSON.stringify(result.tokensUsed) : '{}',
            result.cost || null,
            JSON.stringify({
              conversationId: conversationId_db,
              flowId: routingResult?.flow?.id,
              flowName: routingResult?.flow?.name,
              toolExecutions: result.toolExecutions?.length || 0,
              userId: userId,
            }),
          ]
        );
      } catch (analyticsError: any) {
        // Don't fail if analytics save fails
        logger.debug('Failed to save analytics event', { error: analyticsError.message });
      }

      logger.info('Conversation and messages saved to database successfully', {
        conversationId: conversationId_db,
        messagesSaved: 2,
        toolExecutionsSaved: result.toolExecutions?.length || 0,
        analyticsSaved: true,
      });
    } catch (error: any) {
      logger.error('Failed to save conversation and messages to database', {
        error: error.message,
        errorCode: error.code,
        errorName: error.name,
        stack: error.stack,
        conversationId: result?.conversationId,
        channelType: normalizedMessage?.channelType,
        userId: normalizedMessage?.channelUserId,
      });
      
      // Log to system_logs for visibility
      await this.logSystemEvent('error', `Failed to save conversation: ${error.message}`, {
        service: 'webhooks',
        metadata: {
          errorCode: error.code,
          errorName: error.name,
          conversationId: result?.conversationId,
          channelType: normalizedMessage?.channelType,
          userId: normalizedMessage?.channelUserId,
        },
        stackTrace: error.stack,
        userId: normalizedMessage?.channelUserId,
        conversationId: result?.conversationId || undefined,
      });
      
      // Don't throw - we don't want to fail the webhook if DB save fails
    }
  }

  /**
   * Log system event to database
   * Helper method to save logs to system_logs table
   */
  private async logSystemEvent(
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    options?: {
      service?: string;
      metadata?: any;
      stackTrace?: string;
      userId?: string;
      conversationId?: string;
    }
  ): Promise<void> {
    // Only log if database is available
    if (!this.db) {
      return;
    }

    try {
      await this.db.query(
        `INSERT INTO system_logs (level, message, service, metadata, stack_trace, user_id, conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          level,
          message,
          options?.service || 'webhooks',
          JSON.stringify(options?.metadata || {}),
          options?.stackTrace || null,
          options?.userId || null,
          options?.conversationId || null,
        ]
      );
    } catch (error: any) {
      // Fail silently to avoid recursive errors
      logger.debug('Failed to log system event to database', { error: error.message });
    }
  }

  /**
   * WhatsApp Webhook Handler
   * POST /webhooks/whatsapp
   */
  async whatsapp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const webhookBody = request.body as any;
      
      // Extract the actual payload - 360Dialog sends the payload wrapped in 'body', UltraMsg sends it directly
      const actualPayload = webhookBody.body || webhookBody;
    
      // Detect provider type first
      const is360Dialog = actualPayload?.object === 'whatsapp_business_account' || webhookBody?.body?.object === 'whatsapp_business_account';
    const isUltraMsg = !!actualPayload?.instanceId || !!actualPayload?.event_type;
    const isTwilio = !!actualPayload?.MessageSid;
    
    // Extract instanceId and messageText based on provider format
    let instanceId = 'unknown';
    let messageText = '';
    
    if (is360Dialog) {
      // 360Dialog format: extract from entry[0].changes[0].value
      const entry = actualPayload?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      
      // Detectar status updates ANTES de hacer logging completo
      // Si solo hay statuses y no hay messages, es una actualización de estado (read, delivered, etc.)
      if (value?.statuses && !value?.messages) {
        // Es solo una actualización de estado, no un mensaje
        // Log mínimo en DEBUG y retornar sin procesar ni guardar en system_logs
        logger.debug('360Dialog status update received (ignoring)', {
          provider: '360dialog',
          statusCount: value.statuses.length,
          statuses: value.statuses.map((s: any) => s.status),
          phoneNumberId: value?.metadata?.phone_number_id,
        });
        reply.send({ success: true });
        return;
      }
      
      const firstMessage = value?.messages?.[0];
      instanceId = value?.metadata?.phone_number_id || entry?.id || 'unknown';
      messageText = firstMessage?.text?.body || firstMessage?.image?.caption || firstMessage?.video?.caption || firstMessage?.document?.caption || '';
    } else if (isUltraMsg) {
      // UltraMsg format: extract from data object
      instanceId = actualPayload?.instanceId || actualPayload?.data?.from || 'unknown';
      messageText = actualPayload?.data?.body || '';
    } else if (isTwilio) {
      // Twilio format: extract from root level
      instanceId = actualPayload?.AccountSid || 'unknown';
      messageText = actualPayload?.Body || '';
    }
    
    // Determine provider name
    let provider = 'unknown';
    if (is360Dialog) {
      provider = '360dialog';
    } else if (isUltraMsg) {
      provider = 'ultramsg';
    } else if (isTwilio) {
      provider = 'twilio';
    }
    
    // Log complete payload for all providers
    logger.info(`WhatsApp webhook received (${provider}) - Full payload`, {
      provider,
      fullPayload: JSON.stringify(webhookBody, null, 2),
      extractedPayload: JSON.stringify(actualPayload, null, 2),
      instanceId,
      hasMessage: is360Dialog ? !!actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] : !!actualPayload?.data?.body,
      messageLength: messageText?.length || 0,
      // 360Dialog specific fields
      ...(is360Dialog && {
        hasMessages: !!actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages,
        messagesCount: actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0,
        phoneNumberId: actualPayload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
        wabaId: actualPayload?.entry?.[0]?.id,
      }),
      // UltraMsg specific fields
      ...(isUltraMsg && {
        eventType: actualPayload?.event_type,
        instanceId: actualPayload?.instanceId,
      }),
      // Twilio specific fields
      ...(isTwilio && {
        accountSid: actualPayload?.AccountSid,
        messageSid: actualPayload?.MessageSid,
      }),
    });

    // Log to database with full payload for all providers
    await this.logSystemEvent('info', `WhatsApp webhook received (${provider}) - Full payload`, {
        service: 'webhooks',
        metadata: {
          channel: 'whatsapp',
          provider,
          fullPayload: webhookBody,
          extractedPayload: actualPayload,
          instanceId,
          hasMessage: is360Dialog ? !!actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] : !!actualPayload?.data?.body,
          messageLength: messageText?.length || 0,
          // 360Dialog specific fields
          ...(is360Dialog && {
            phoneNumberId: actualPayload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
            wabaId: actualPayload?.entry?.[0]?.id,
            hasMessages: !!actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages,
            messagesCount: actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0,
          }),
          // UltraMsg specific fields
          ...(isUltraMsg && {
            eventType: actualPayload?.event_type,
            instanceId: actualPayload?.instanceId,
          }),
          // Twilio specific fields
          ...(isTwilio && {
            accountSid: actualPayload?.AccountSid,
            messageSid: actualPayload?.MessageSid,
          }),
        },
        userId: is360Dialog 
          ? actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from 
          : (actualPayload?.data?.from || actualPayload?.From),
      });

      // Identify the specific channel (channel_configs.id) from webhook payload
      // Use the actual payload (might be wrapped in 'body')
      const identifiedChannelId = await this.identifyWhatsAppChannelFromWebhook(actualPayload);
      
      if (identifiedChannelId) {
        logger.info('WhatsApp channel identified from webhook', {
          channelId: identifiedChannelId,
          instanceId,
        });
      } else {
        logger.warn('Could not identify specific WhatsApp channel from webhook, will use routing by type', {
          instanceId,
        });
      }

      // Handle webhook using adapter (handles different event types)
      // IMPORTANT: Pass the original webhookBody to handleWebhook, not actualPayload
      // handleWebhook will handle the extraction internally to support both formats
      logger.debug('Passing payload to handleWebhook', {
        webhookBodyKeys: webhookBody ? Object.keys(webhookBody) : [],
        actualPayloadKeys: actualPayload ? Object.keys(actualPayload) : [],
        hasBodyInWebhookBody: !!webhookBody?.body,
        hasObjectInActualPayload: !!actualPayload?.object,
        objectValue: actualPayload?.object,
      });
      // Pass webhookBody (which may have 'body' wrapper) to handleWebhook
      // handleWebhook will extract the actual payload internally
      const normalizedMessage = await this.whatsappAdapter.handleWebhook(webhookBody);

      // If no message to process (e.g., status update), return success
      // Note: Status updates are already handled earlier, so this handles other edge cases
      if (!normalizedMessage) {
        // Solo log en DEBUG, no guardar en system_logs para evitar ruido
        logger.debug('Webhook event processed, no message to handle', {
          channel: 'whatsapp',
          instanceId,
          channelId: identifiedChannelId,
        });
        // NO llamar a logSystemEvent para evitar guardar en system_logs
        reply.send({ success: true });
        return;
      }

      // ✅ DEDUPLICACIÓN: Check if this message was already processed
      // WhatsApp providers send unique messageId for each message
      // We should check if a message with this messageId already exists in the database
      const messageId = normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id;
      if (messageId && this.db) {
        try {
          const existingMessageResult = await this.db.query(
            `SELECT id FROM messages 
             WHERE role = 'user'
             AND (
               (metadata->'originalMessage'->>'id')::text = $1
               OR (metadata->'originalMessage'->'metadata'->>'messageId')::text = $1
               OR (metadata->'originalMessage'->'metadata'->>'id')::text = $1
             )
             LIMIT 1`,
            [messageId]
          );

          if (existingMessageResult.rows.length > 0) {
            logger.info('Duplicate WhatsApp message detected, skipping processing', {
              messageId: messageId,
              userId: normalizedMessage.channelUserId,
              existingMessageId: existingMessageResult.rows[0].id,
              channelId: identifiedChannelId,
            });
            // Return success to acknowledge the webhook, but don't process the message
            reply.send({ success: true, duplicate: true });
            return;
          }
        } catch (dedupError: any) {
          // Log error but continue processing - don't fail the webhook due to deduplication check
          logger.warn('Error checking for duplicate message, continuing with processing', {
            error: dedupError.message,
            messageId: messageId,
          });
        }
      }

      // ✅ CRÍTICO: Responder INMEDIATAMENTE al webhook
      // Esto evita que WhatsApp reenvíe el mensaje por timeout
      // El procesamiento se hará de forma asíncrona después de responder
      reply.send({ success: true, processing: true });

      // ✅ Procesar mensaje de forma ASÍNCRONA (sin bloquear la respuesta)
      // Usar setImmediate para ejecutar en el siguiente tick del event loop
      setImmediate(async () => {
        try {
          await this.processWhatsAppMessageAsync(normalizedMessage, identifiedChannelId);
        } catch (asyncError: any) {
          // Los errores en procesamiento asíncrono no afectan la respuesta del webhook
          const messageId = normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id;
          logger.error('Error processing WhatsApp message asynchronously', {
            error: asyncError.message,
            stack: asyncError.stack,
            userId: normalizedMessage.channelUserId,
            messageId: messageId,
          });
          
          // Log to system_logs for visibility
          await this.logSystemEvent('error', `Failed to process WhatsApp message asynchronously: ${asyncError.message}`, {
            service: 'webhooks',
            metadata: {
              channel: 'whatsapp',
              userId: normalizedMessage.channelUserId,
              messageId: messageId,
              errorMessage: asyncError.message,
              errorStack: asyncError.stack,
            },
            stackTrace: asyncError.stack,
            userId: normalizedMessage.channelUserId,
          });
        }
      });
    } catch (error: any) {
      logger.error('WhatsApp webhook error', { error: error.message });
      
      // Log error to database
      await this.logSystemEvent('error', `WhatsApp webhook failed: ${error.message}`, {
        service: 'webhooks',
        metadata: {
          channel: 'whatsapp',
          errorCode: (error as any).code,
          errorName: error.name,
        },
        stackTrace: error.stack,
      });
      
      // Only throw error if reply hasn't been sent yet
      // If reply was already sent, the error occurred in async processing and was already handled
      if (!reply.sent) {
        throw new AppError(
          'WEBHOOK_ERROR',
          `WhatsApp webhook failed: ${error.message}`,
          500
        );
      } else {
        // Reply already sent, error occurred in async processing
        // Log it but don't throw (would cause "Cannot send response after headers have been sent")
        logger.warn('Error occurred after webhook response was sent (async processing)', {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  }

  /**
   * Process WhatsApp message asynchronously
   * This method contains all the processing logic that was previously in the whatsapp handler
   * Called after responding to the webhook to avoid timeouts
   */
  private async processWhatsAppMessageAsync(
    normalizedMessage: IncomingMessage,
    identifiedChannelId?: string
  ): Promise<void> {
    // Add identified channelId to message metadata for explicit routing
    if (identifiedChannelId) {
      // Ensure metadata exists (should always exist from normalizeMessage, but be safe)
      if (!normalizedMessage.metadata) {
        normalizedMessage.metadata = {};
      }
      normalizedMessage.metadata.channelId = identifiedChannelId;
      normalizedMessage.metadata.channel_config_id = identifiedChannelId;
      logger.info('Added channelId to normalized message metadata for explicit routing', {
        channelId: identifiedChannelId,
        messageId: normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id,
        userId: normalizedMessage.channelUserId,
      });
    } else {
      logger.debug('No channelId identified, routing will use channel type matching', {
        messageId: normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id,
        userId: normalizedMessage.channelUserId,
      });
    }

    const requestedChannelId =
      (normalizedMessage.metadata?.channelId as string) ||
      (normalizedMessage.metadata?.channel_config_id as string) ||
      identifiedChannelId;

    // Option A: Prioritize flow_id from conversation (same conversation used for context/history)
    const optionA = await this.tryLoadFlowFromConversation(
      normalizedMessage.channelType,
      normalizedMessage.channelUserId,
      typeof requestedChannelId === 'string' ? requestedChannelId : undefined
    );

    let routingResult: any = null;
    let resolvedConversationId: string | undefined;

    if (optionA) {
      routingResult = optionA.routingResult;
      resolvedConversationId = optionA.conversationId;
      if (!normalizedMessage.metadata) normalizedMessage.metadata = {};
      normalizedMessage.metadata.conversationId = resolvedConversationId;
      logger.info('Using flow_id from conversation (Option A)', {
        flowId: routingResult?.flow?.id,
        flowName: routingResult?.flow?.name,
        conversationId: resolvedConversationId,
        channelType: normalizedMessage.channelType,
        userId: normalizedMessage.channelUserId,
      });
    } else {
      logger.debug('No flow_id in conversation or flow not active, using router', {
        channelType: normalizedMessage.channelType,
        userId: normalizedMessage.channelUserId,
      });
      routingResult = await this.flowRouter.route(normalizedMessage);
    }

    if (routingResult) {
      routingResult = await this.enhanceWithRAGContext(
        routingResult,
        normalizedMessage.content
      );
    }

    // Attach external context using the same conversation we route to (avoids mixing contexts)
    const attachedExternal = await this.attachExternalContextToProcessing(
      normalizedMessage,
      routingResult,
      resolvedConversationId ?? undefined
    );
    routingResult = attachedExternal.routingResult;
    const attachedConversationMetadata = attachedExternal.conversationMetadata;
    const effectiveConversationId = resolvedConversationId ?? attachedExternal.conversationId;

    if (!routingResult) {
      const explicitFlowId = this.extractExplicitFlowIdFromConversationMetadata(attachedConversationMetadata);
      if (explicitFlowId) {
        const explicitRouting = await this.tryLoadExplicitFlowRouting(
          explicitFlowId,
          normalizedMessage.channelType,
          typeof requestedChannelId === 'string' ? requestedChannelId : undefined
        );
        if (explicitRouting) {
          routingResult = await this.enhanceWithRAGContext(explicitRouting, normalizedMessage.content);
          const reattached = await this.attachExternalContextToProcessing(
            normalizedMessage,
            routingResult,
            effectiveConversationId ?? undefined
          );
          routingResult = reattached.routingResult;
        }
      }
    }

    if (!routingResult) {
      logger.warn('No flow matched for WhatsApp message', {
        channelType: normalizedMessage.channelType,
        phoneNumber: (normalizedMessage as any).phoneNumber,
      });
      
      await this.logSystemEvent('warn', 'No flow matched for WhatsApp message', {
        service: 'webhooks',
        metadata: {
          channel: 'whatsapp',
          channelType: normalizedMessage.channelType,
          phoneNumber: (normalizedMessage as any).phoneNumber,
          userId: normalizedMessage.channelUserId,
        },
        userId: normalizedMessage.channelUserId,
      });

      const convIdForHistory = effectiveConversationId ?? attachedExternal?.conversationId;
      if (convIdForHistory) {
        await this.loadAndRestoreHistoryForConversation(
          convIdForHistory,
          normalizedMessage.channelType,
          normalizedMessage.channelUserId
        );
      }

      // Use default orchestrator without routing
      const result = await this.orchestrator.processMessage(normalizedMessage);

      // Save conversation and messages to database
      await this.saveConversationAndMessages(
        normalizedMessage,
        result,
        null
      );

      // Log orchestrator errors to system_logs for frontend visibility
      if (result.metadata?.error) {
        await this.logSystemEvent('error', `Orchestrator error: ${result.metadata.error}`, {
          service: 'orchestrator',
          metadata: {
            errorMessage: result.metadata.error,
            errorCode: result.metadata.errorCode,
            conversationId: result.conversationId,
            channel: 'whatsapp',
            userId: normalizedMessage.channelUserId,
            processingTimeMs: result.processingTimeMs,
          },
          stackTrace: result.metadata.error,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId || undefined,
        });
      }

      // Log tool execution errors to system_logs for frontend visibility
      if (result.toolExecutions && result.toolExecutions.length > 0) {
        for (const toolExec of result.toolExecutions) {
          if (toolExec.status === 'failed') {
            await this.logSystemEvent('error', `Tool execution failed: ${toolExec.toolName}`, {
              service: 'tools',
              metadata: {
                toolName: toolExec.toolName,
                parameters: toolExec.parameters,
                error: toolExec.error,
                executionTimeMs: toolExec.executionTimeMs,
                channel: 'whatsapp',
                userId: normalizedMessage.channelUserId,
              },
              stackTrace: toolExec.error,
              userId: normalizedMessage.channelUserId,
              conversationId: result.conversationId || undefined,
            });
          } else if (toolExec.status === 'success') {
            // Log successful tool executions as info for visibility
            await this.logSystemEvent('info', `Tool executed successfully: ${toolExec.toolName}`, {
              service: 'tools',
              metadata: {
                toolName: toolExec.toolName,
                executionTimeMs: toolExec.executionTimeMs,
                channel: 'whatsapp',
                userId: normalizedMessage.channelUserId,
              },
              userId: normalizedMessage.channelUserId,
              conversationId: result.conversationId || undefined,
            });
          }
        }
      }

      // Get channel configuration from database if channelId is available
      const channelId = normalizedMessage.metadata?.channelId || normalizedMessage.metadata?.channel_config_id;
      const channelConfig = channelId ? await this.getChannelConfigById(channelId) : undefined;
      
      logger.info('Using channel configuration for sending (no flow)', {
        hasChannelConfig: !!channelConfig,
        channelId: channelId || '(not specified)',
        instanceId: channelConfig?.instanceId, // Ultramsg instanceId from config
        useQueue: this.useQueueForWhatsApp && !!this.queueManager,
      });

      // Send response using queue (with retries)
      // CRITICAL: Wrap in try-catch to ensure webhook doesn't fail if queue is unavailable
      // The message is already processed and saved, so we should respond successfully
      // If queue fails, the error is logged but webhook responds successfully
      try {
        await this.sendWhatsAppMessage(
          normalizedMessage.channelUserId,
          {
            channelUserId: normalizedMessage.channelUserId,
            content: result.outgoingMessage.content,
            metadata: {
              ...result.metadata,
              conversationId: result.conversationId, // Include conversationId for UltraMsg referenceId
            },
          },
          channelConfig
        );
      } catch (sendError: any) {
        // Log the error but don't fail the webhook
        // The message processing is complete, webhook should respond successfully
        logger.error('CRITICAL: Failed to queue WhatsApp message response', {
          error: sendError.message,
          errorStack: sendError.stack,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId,
          queueAvailable: this.useQueueForWhatsApp && !!this.queueManager,
        });
        
        // Log to system_logs for visibility
        await this.logSystemEvent('error', `CRITICAL: Failed to queue WhatsApp message: ${sendError.message}`, {
          service: 'webhooks',
          metadata: {
            channel: 'whatsapp',
            userId: normalizedMessage.channelUserId,
            conversationId: result.conversationId,
            errorMessage: sendError.message,
            errorStack: sendError.stack,
            queueAvailable: this.useQueueForWhatsApp && !!this.queueManager,
          },
          stackTrace: sendError.stack,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId || undefined,
        });
        
        // Continue - webhook will respond successfully even if queue failed
        // The message was processed and saved, but response couldn't be queued
        // This is a critical error that needs to be fixed (queue system must be available)
      }
    } else {
      logger.info('Flow matched for WhatsApp message', {
        flowName: routingResult.flow.name,
        llmProvider: routingResult.llmProvider,
        enabledTools: routingResult.enabledTools,
      });
      
      await this.logSystemEvent('info', 'Flow matched for WhatsApp message', {
        service: 'webhooks',
        metadata: {
          channel: 'whatsapp',
          flowName: routingResult.flow.name,
          llmProvider: routingResult.llmProvider,
          enabledTools: routingResult.enabledTools,
          userId: normalizedMessage.channelUserId,
        },
        userId: normalizedMessage.channelUserId,
      });

      const convIdForHistory = effectiveConversationId ?? attachedExternal?.conversationId;
      if (convIdForHistory) {
        await this.loadAndRestoreHistoryForConversation(
          convIdForHistory,
          normalizedMessage.channelType,
          normalizedMessage.channelUserId
        );
      }

      // Process through orchestrator with routing result
      const result = await this.orchestrator.processMessage(normalizedMessage, routingResult);

      // Save conversation and messages to database
      await this.saveConversationAndMessages(
        normalizedMessage,
        result,
        routingResult
      );

      // Log orchestrator errors to system_logs for frontend visibility
      if (result.metadata?.error) {
        await this.logSystemEvent('error', `Orchestrator error: ${result.metadata.error}`, {
          service: 'orchestrator',
          metadata: {
            errorMessage: result.metadata.error,
            errorCode: result.metadata.errorCode,
            conversationId: result.conversationId,
            channel: 'whatsapp',
            userId: normalizedMessage.channelUserId,
            processingTimeMs: result.processingTimeMs,
          },
          stackTrace: result.metadata.error,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId || undefined,
        });
      }

      // Log tool execution errors to system_logs for frontend visibility
      if (result.toolExecutions && result.toolExecutions.length > 0) {
        for (const toolExec of result.toolExecutions) {
          if (toolExec.status === 'failed') {
            await this.logSystemEvent('error', `Tool execution failed: ${toolExec.toolName}`, {
              service: 'tools',
              metadata: {
                toolName: toolExec.toolName,
                parameters: toolExec.parameters,
                error: toolExec.error,
                executionTimeMs: toolExec.executionTimeMs,
                channel: 'whatsapp',
                userId: normalizedMessage.channelUserId,
              },
              stackTrace: toolExec.error,
              userId: normalizedMessage.channelUserId,
              conversationId: result.conversationId || undefined,
            });
          } else if (toolExec.status === 'success') {
            // Log successful tool executions as info for visibility
            await this.logSystemEvent('info', `Tool executed successfully: ${toolExec.toolName}`, {
              service: 'tools',
              metadata: {
                toolName: toolExec.toolName,
                executionTimeMs: toolExec.executionTimeMs,
                channel: 'whatsapp',
                userId: normalizedMessage.channelUserId,
              },
              userId: normalizedMessage.channelUserId,
              conversationId: result.conversationId || undefined,
            });
          }
        }
      }

      // Get channel configuration from routing result or database
      const channelConfig = await this.getChannelConfigFromRoutingResult(routingResult);
      
      logger.info('Using channel configuration for sending', {
        hasChannelConfig: !!channelConfig,
        instanceId: channelConfig?.instanceId || 'using default',
        useQueue: this.useQueueForWhatsApp && !!this.queueManager,
      });

      // Send response using queue (with retries)
      // CRITICAL: Wrap in try-catch to ensure webhook doesn't fail if queue is unavailable
      // The message is already processed and saved, so we should respond successfully
      // If queue fails, the error is logged but webhook responds successfully
      try {
        await this.sendWhatsAppMessage(
          normalizedMessage.channelUserId,
          {
            channelUserId: normalizedMessage.channelUserId,
            content: result.outgoingMessage.content,
            metadata: {
              ...result.metadata,
              conversationId: result.conversationId, // Include conversationId for UltraMsg referenceId
            },
          },
          channelConfig
        );
      } catch (sendError: any) {
        // Log the error but don't fail the webhook
        // The message processing is complete, webhook should respond successfully
        logger.error('CRITICAL: Failed to queue WhatsApp message response', {
          error: sendError.message,
          errorStack: sendError.stack,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId,
          queueAvailable: this.useQueueForWhatsApp && !!this.queueManager,
        });
        
        // Log to system_logs for visibility
        await this.logSystemEvent('error', `CRITICAL: Failed to queue WhatsApp message: ${sendError.message}`, {
          service: 'webhooks',
          metadata: {
            channel: 'whatsapp',
            userId: normalizedMessage.channelUserId,
            conversationId: result.conversationId,
            errorMessage: sendError.message,
            errorStack: sendError.stack,
            queueAvailable: this.useQueueForWhatsApp && !!this.queueManager,
          },
          stackTrace: sendError.stack,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId || undefined,
        });
        
        // Continue - webhook will respond successfully even if queue failed
        // The message was processed and saved, but response couldn't be queued
        // This is a critical error that needs to be fixed (queue system must be available)
      }
    }
  }

  /**
   * Telegram Webhook Handler
   * POST /webhooks/telegram
   */
  async telegram(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      logger.info('Telegram webhook received', { body: request.body });

      // Normalize message using adapter
      const normalizedMessage = this.telegramAdapter.receiveMessage(request.body as any);

      // Route message to determine flow and LLM
      let routingResult = await this.flowRouter.route(normalizedMessage);

      // Enhance with RAG context if flow is available
      if (routingResult) {
        routingResult = await this.enhanceWithRAGContext(
          routingResult,
          normalizedMessage.content
        );
      }

      if (!routingResult) {
        logger.warn('No flow matched for Telegram message', {
          channelType: normalizedMessage.channelType,
          userId: normalizedMessage.channelUserId,
        });

        // Use default orchestrator without routing
        const result = await this.orchestrator.processMessage(normalizedMessage);

        // Save conversation and messages to database
        await this.saveConversationAndMessages(
          normalizedMessage,
          result,
          null
        );

        await this.telegramAdapter.sendMessage(normalizedMessage.channelUserId, {
          channelUserId: normalizedMessage.channelUserId,
          content: result.outgoingMessage.content,
          metadata: result.metadata,
        });
      } else {
        logger.info('Flow matched for Telegram message', {
          flowName: routingResult.flow.name,
          llmProvider: routingResult.llmProvider,
          enabledTools: routingResult.enabledTools,
        });

        // Process through orchestrator with routing result
        const result = await this.orchestrator.processMessage(normalizedMessage, routingResult);

        // Save conversation and messages to database
        await this.saveConversationAndMessages(
          normalizedMessage,
          result,
          routingResult
        );

        // Send response back through Telegram adapter
        await this.telegramAdapter.sendMessage(normalizedMessage.channelUserId, {
          channelUserId: normalizedMessage.channelUserId,
          content: result.outgoingMessage.content,
          metadata: result.metadata,
        });
      }

      reply.send({ success: true });
    } catch (error: any) {
      logger.error('Telegram webhook error', { error: error.message });
      throw new AppError(
        'WEBHOOK_ERROR',
        `Telegram webhook failed: ${error.message}`,
        500
      );
    }
  }

  /**
   * Email Webhook Handler
   * POST /webhooks/email
   */
  async email(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      logger.info('Email webhook received', { body: request.body });

      // Normalize message using adapter
      const normalizedMessage = this.emailAdapter.receiveMessage(request.body);

      // Route message to determine flow and LLM
      let routingResult = await this.flowRouter.route(normalizedMessage);

      // Enhance with RAG context if flow is available
      if (routingResult) {
        routingResult = await this.enhanceWithRAGContext(
          routingResult,
          normalizedMessage.content
        );
      }

      if (!routingResult) {
        logger.warn('No flow matched for Email message', {
          channelType: normalizedMessage.channelType,
          userId: normalizedMessage.channelUserId,
        });

        // Use default orchestrator without routing
        const result = await this.orchestrator.processMessage(normalizedMessage);

        // Save conversation and messages to database
        await this.saveConversationAndMessages(
          normalizedMessage,
          result,
          null
        );

        await this.emailAdapter.sendMessage(normalizedMessage.channelUserId, {
          channelUserId: normalizedMessage.channelUserId,
          content: result.outgoingMessage.content,
          metadata: result.metadata,
        });
      } else {
        logger.info('Flow matched for Email message', {
          flowName: routingResult.flow.name,
          llmProvider: routingResult.llmProvider,
          enabledTools: routingResult.enabledTools,
        });

        // Process through orchestrator with routing result
        const result = await this.orchestrator.processMessage(normalizedMessage, routingResult);

        // Save conversation and messages to database
        await this.saveConversationAndMessages(
          normalizedMessage,
          result,
          routingResult
        );

        // Send response back through Email adapter
        await this.emailAdapter.sendMessage(normalizedMessage.channelUserId, {
          channelUserId: normalizedMessage.channelUserId,
          content: result.outgoingMessage.content,
          metadata: result.metadata,
        });
      }

      reply.send({ success: true });
    } catch (error: any) {
      logger.error('Email webhook error', { error: error.message });
      throw new AppError(
        'WEBHOOK_ERROR',
        `Email webhook failed: ${error.message}`,
        500
      );
    }
  }

  /**
   * Generic Webhook Handler
   * POST /webhooks/:channel
   */
  async generic(
    request: FastifyRequest<{
      Params: { channel: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { channel } = request.params;

    logger.info(`Generic webhook received for channel: ${channel}`, {
      body: request.body,
    });

    // Map channel name to ChannelType
    const channelTypeMap: Record<string, ChannelType> = {
      whatsapp: ChannelType.WHATSAPP,
      telegram: ChannelType.TELEGRAM,
      email: ChannelType.EMAIL,
      webchat: ChannelType.WEBCHAT,
    };

    const channelType = channelTypeMap[channel.toLowerCase()];

    if (!channelType) {
      throw new AppError('INVALID_CHANNEL', `Unknown channel: ${channel}`, 400);
    }

    // Route to appropriate handler
    switch (channelType) {
      case ChannelType.WHATSAPP:
        return this.whatsapp(request, reply);
      case ChannelType.TELEGRAM:
        return this.telegram(request, reply);
      case ChannelType.EMAIL:
        return this.email(request, reply);
      default:
        throw new AppError(
          'CHANNEL_NOT_IMPLEMENTED',
          `Webhook handler not implemented for ${channel}`,
          501
        );
    }
  }
}
