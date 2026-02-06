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
import {
  WhatsAppWebhookPipeline,
  TelegramWebhookPipeline,
  EmailWebhookPipeline,
  type IWhatsAppPipelineDeps,
  type ITelegramPipelineDeps,
  type IEmailPipelineDeps,
} from '../pipelines';

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

      // Use only the context for the namespace of the last outbound message that had context.
      // This avoids mixing multiple campaign/case contexts when the user replies.
      let contextToInject: Record<string, any> | null = null;
      try {
        const lastOutboundWithContext = await this.db.query(
          `SELECT metadata->'external'->>'namespace' AS active_namespace
           FROM messages
           WHERE conversation_id = $1 AND role = 'assistant'
             AND metadata->'external' IS NOT NULL
             AND metadata->'external' ? 'namespace'
           ORDER BY timestamp DESC
           LIMIT 1`,
          [conversationId]
        );
        const activeNamespace =
          lastOutboundWithContext.rows[0]?.active_namespace &&
          typeof lastOutboundWithContext.rows[0].active_namespace === 'string'
            ? (lastOutboundWithContext.rows[0].active_namespace as string)
            : null;

        if (activeNamespace && externalContext[activeNamespace]) {
          contextToInject = { [activeNamespace]: externalContext[activeNamespace] };
          logger.info('Using external context for namespace from last outbound with context', {
            conversationId,
            activeNamespace,
            channelType,
            userId,
          });
        } else {
          // Fallback: use the namespace with the most recent updated_at
          const namespaces = Object.keys(externalContext);
          let latestNs: string | null = null;
          let latestAt = 0;
          for (const ns of namespaces) {
            const entry = externalContext[ns];
            const updatedAt = entry?.updated_at ? new Date(entry.updated_at).getTime() : 0;
            if (updatedAt > latestAt) {
              latestAt = updatedAt;
              latestNs = ns;
            }
          }
          if (latestNs) {
            contextToInject = { [latestNs]: externalContext[latestNs] };
            logger.info('Using external context fallback (most recent updated_at namespace)', {
              conversationId,
              activeNamespace: latestNs,
              channelType,
              userId,
            });
          }
        }
      } catch (e: any) {
        logger.debug('Failed to resolve active namespace for external context (non-fatal)', {
          conversationId,
          error: e.message,
        });
        contextToInject = null;
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
          injectingSingleNamespace: contextToInject ? Object.keys(contextToInject)[0] ?? null : null,
        });
      } catch {
        // ignore
      }

      // Verbose log (PII risk): show the exact external_context JSON (truncated)
      if (this.envFlag('LOG_EXTERNAL_CONTEXT_JSON') && contextToInject) {
        logger.warn('External context JSON (VERBOSE)', {
          conversationId,
          channelType,
          userId,
          external_context: this.truncateText(contextToInject, 4000),
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

      // Enrich system prompt only if flow routing exists (inject single namespace to avoid mixing contexts)
      if (routingResult?.flow?.flow_config && contextToInject) {
        const currentSystemPrompt = routingResult.flow.flow_config?.systemPrompt || '';
        const externalContextText = this.formatExternalContextForPrompt(contextToInject);
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
   * When there is a last outbound message with context (campaign), only loads messages from that
   * point onward to avoid mixing topics from previous campaigns/cases.
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
      let sinceTimestamp: string | null = null;
      const lastOutboundWithContext = await this.db.query(
        `SELECT timestamp FROM messages
         WHERE conversation_id = $1 AND role = 'assistant'
           AND metadata->'external' IS NOT NULL
           AND metadata->'external' ? 'namespace'
         ORDER BY timestamp DESC
         LIMIT 1`,
        [conversationId]
      );
      if (lastOutboundWithContext.rows.length > 0 && lastOutboundWithContext.rows[0].timestamp) {
        sinceTimestamp = lastOutboundWithContext.rows[0].timestamp as string;
      }

      const messagesResult = sinceTimestamp
        ? await this.db.query(
            `SELECT role, content FROM messages
             WHERE conversation_id = $1 AND timestamp >= $2
             ORDER BY timestamp ASC
             LIMIT 100`,
            [conversationId, sinceTimestamp]
          )
        : await this.db.query(
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
        sinceLastOutboundWithContext: !!sinceTimestamp,
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

  /** Returns true if message is duplicate and should be skipped. Used by WhatsApp pipeline. */
  private async executeDedupCheck(messageId: string): Promise<boolean> {
    if (!this.db || !messageId) return false;
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
      if (existingMessageResult.rows.length > 0) return true;
    } catch (_e: any) {
      logger.warn('Error checking for duplicate message, continuing with processing', {
        error: _e.message,
        messageId,
      });
    }
    return false;
  }

  /** Dependencies for WhatsApp webhook pipeline. */
  private getWhatsAppPipelineDeps(): IWhatsAppPipelineDeps {
    return {
      tryLoadFlowFromConversation: this.tryLoadFlowFromConversation.bind(this),
      flowRouter: this.flowRouter,
      enhanceWithRAGContext: this.enhanceWithRAGContext.bind(this),
      attachExternalContextToProcessing: this.attachExternalContextToProcessing.bind(this),
      extractExplicitFlowIdFromConversationMetadata: this.extractExplicitFlowIdFromConversationMetadata.bind(this),
      tryLoadExplicitFlowRouting: this.tryLoadExplicitFlowRouting.bind(this),
      loadAndRestoreHistoryForConversation: this.loadAndRestoreHistoryForConversation.bind(this),
      orchestrator: this.orchestrator,
      saveConversationAndMessages: this.saveConversationAndMessages.bind(this),
      getChannelConfigById: this.getChannelConfigById.bind(this),
      getChannelConfigFromRoutingResult: this.getChannelConfigFromRoutingResult.bind(this),
      sendWhatsAppMessage: this.sendWhatsAppMessage.bind(this),
      logSystemEvent: this.logSystemEvent.bind(this),
      identifyWhatsAppChannelFromWebhook: this.identifyWhatsAppChannelFromWebhook.bind(this),
      executeDedupCheck: this.executeDedupCheck.bind(this),
      whatsappAdapter: this.whatsappAdapter,
    };
  }

  /** Dependencies for Telegram webhook pipeline. */
  private getTelegramPipelineDeps(): ITelegramPipelineDeps {
    return {
      flowRouter: this.flowRouter,
      enhanceWithRAGContext: this.enhanceWithRAGContext.bind(this),
      orchestrator: this.orchestrator,
      saveConversationAndMessages: this.saveConversationAndMessages.bind(this),
      telegramAdapter: this.telegramAdapter,
    };
  }

  /** Dependencies for Email webhook pipeline. */
  private getEmailPipelineDeps(): IEmailPipelineDeps {
    return {
      flowRouter: this.flowRouter,
      enhanceWithRAGContext: this.enhanceWithRAGContext.bind(this),
      orchestrator: this.orchestrator,
      saveConversationAndMessages: this.saveConversationAndMessages.bind(this),
      emailAdapter: this.emailAdapter,
    };
  }

  /**
   * Try to load flow routing from conversation's flow_id (Option A: prioritize conversation flow_id)
   * This ensures that when a client responds, we use the flow from the last campaign sent
   * Now supports multiple conversations per number (one per flow_id)
   * Returns routing + conversationId when flow is active; flowInactive when the flow exists but is inactive (no response sent).
   */
  private async tryLoadFlowFromConversation(
    channelType: ChannelType,
    userId: string,
    requestedChannelId?: string
  ): Promise<
    | { routingResult: any; conversationId: string }
    | { conversationId: string; flowInactive: true }
    | null
  > {
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

      // Prefer active flow: if inactive only, we do not continue the conversation (no response)
      const routingResultActive = await this.tryLoadExplicitFlowRouting(
        conversationFlowId,
        channelType,
        requestedChannelId,
        false
      );
      if (routingResultActive) {
        return { routingResult: routingResultActive, conversationId };
      }

      const routingResultInactive = await this.tryLoadExplicitFlowRouting(
        conversationFlowId,
        channelType,
        requestedChannelId,
        true
      );
      if (routingResultInactive) {
        logger.info('Flow from conversation is inactive; not responding', {
          conversationId,
          flowId: conversationFlowId,
          channelType,
          userId,
        });
        return { conversationId, flowInactive: true as const };
      }

      return null;
    } catch (e: any) {
      logger.debug('Failed to load flow from conversation (non-fatal)', {
        error: e.message,
        channelType,
        userId,
      });
      return null;
    }
  }

  /**
   * Load flow routing by flow ID.
   * @param allowInactive - When true (e.g. resuming existing conversation), allows flows marked as inactive.
   *   Use this when the conversation was established by a campaign/outbound from that flow and we must
   *   continue with the same agent even if the flow was later deactivated.
   */
  private async tryLoadExplicitFlowRouting(
    flowId: string,
    channelType: ChannelType,
    requestedChannelId?: string,
    allowInactive = false
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
          AND c.channel_type = $2
          AND c.is_active = true
          ${allowInactive ? '' : 'AND f.active = true'}
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
   * Process WhatsApp webhook payload (used by queue worker or fallback).
   * Delegates to WhatsAppWebhookPipeline.
   */
  async processWhatsAppWebhookPayload(webhookBody: any): Promise<void> {
    await WhatsAppWebhookPipeline.run(this.getWhatsAppPipelineDeps(), webhookBody);
  }

  /**
   * WhatsApp Webhook Handler
   * POST /webhooks/whatsapp
   * Responds 200 immediately and enqueues payload for processing (all providers: 360Dialog, UltrMsg, Twilio).
   * Only exception: 360Dialog status-only events (read/delivered) are acknowledged without enqueueing.
   */
  async whatsapp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const webhookBody = request.body as any;
      const actualPayload = webhookBody?.body || webhookBody;
      const is360Dialog = actualPayload?.object === 'whatsapp_business_account' || webhookBody?.body?.object === 'whatsapp_business_account';

      // 360Dialog: skip queue for status-only (read/delivered); no message to process
      if (is360Dialog) {
        const entry = actualPayload?.entry?.[0];
        const value = entry?.changes?.[0]?.value;
        if (value?.statuses && !value?.messages) {
          logger.debug('360Dialog status update received (ignoring)', {
            provider: '360dialog',
            statusCount: value.statuses.length,
            phoneNumberId: value?.metadata?.phone_number_id,
          });
          reply.send({ success: true });
          return;
        }
      }

      // All providers (360Dialog message, UltrMsg, Twilio): respond 200 and enqueue
      reply.send({ success: true, queued: true });

      if (this.queueManager) {
        try {
          await this.queueManager.addJob(
            QueueName.WHATSAPP_WEBHOOK_INCOMING,
            'process-whatsapp-webhook',
            { webhookBody, receivedAt: new Date().toISOString() },
            { removeOnComplete: 100 }
          );
        } catch (enqueueError: any) {
          logger.error('Failed to enqueue WhatsApp webhook, processing inline', { error: enqueueError.message });
          setImmediate(() => {
            this.processWhatsAppWebhookPayload(webhookBody).catch((err: any) => {
              logger.error('Error processing WhatsApp webhook (inline fallback)', { error: err.message });
              this.logSystemEvent('error', `WhatsApp webhook inline processing failed: ${err.message}`, {
                service: 'webhooks',
                metadata: { channel: 'whatsapp', errorMessage: err.message },
              }).catch(() => {});
            });
          });
        }
      } else {
        setImmediate(() => {
          this.processWhatsAppWebhookPayload(webhookBody).catch((err: any) => {
            logger.error('Error processing WhatsApp webhook (no queue)', { error: err.message });
            this.logSystemEvent('error', `WhatsApp webhook processing failed: ${err.message}`, {
              service: 'webhooks',
              metadata: { channel: 'whatsapp', errorMessage: err.message },
            }).catch(() => {});
          });
        });
      }
    } catch (error: any) {
      logger.error('WhatsApp webhook error', { error: error.message });
      if (!reply.sent) {
        this.logSystemEvent('error', `WhatsApp webhook failed: ${error.message}`, {
          service: 'webhooks',
          metadata: { channel: 'whatsapp', errorCode: (error as any).code, errorName: error.name },
          stackTrace: error.stack,
        }).catch(() => {});
        throw new AppError('WEBHOOK_ERROR', `WhatsApp webhook failed: ${error.message}`, 500);
      }
      logger.warn('Error after webhook response was sent', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Telegram Webhook Handler
   * POST /webhooks/telegram
   */
  async telegram(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      await TelegramWebhookPipeline.run(this.getTelegramPipelineDeps(), request.body as any);
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
      await EmailWebhookPipeline.run(this.getEmailPipelineDeps(), request.body);
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
