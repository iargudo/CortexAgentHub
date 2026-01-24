import { FastifyReply, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { MCPServer } from '@cortex/mcp-server';
import {
  AppError,
  ChannelType,
  createLogger,
  generateSessionId,
} from '@cortex/shared';
import { getQueueManager, QueueName } from '@cortex/queue-service';

const logger = createLogger('IntegrationsController');

type ExternalContextEnvelope = {
  namespace: string;
  caseId: string;
  refs?: Record<string, any>;
  seed?: Record<string, any>;
  routing?: {
    flowId?: string;
    channelConfigId?: string;
  };
};

function isUuid(v: any): boolean {
  if (!v || typeof v !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizePhoneUserId(userId: string): string {
  // Keep only digits. AgentHub already normalizes inbound to digits-only for Twilio.
  return String(userId || '').replace(/[^\d]/g, '');
}

function envFlag(name: string): boolean {
  const v = String(process.env[name] || '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes';
}

function truncateText(text: any, max = 500): string {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…[truncated]';
}

export class IntegrationsController {
  constructor(private db: Pool, private mcpServer: MCPServer) {}

  /**
   * List active channel configs (generic, for integrations).
   * GET /api/v1/integrations/channels?channelType=whatsapp
   * Returns non-secret identifiers so external systems can select channelConfigId deterministically.
   */
  async listChannels(
    request: FastifyRequest<{
      Querystring: {
        channelType?: string;
        activeOnly?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    if (!this.db) {
      throw new AppError('DB_NOT_AVAILABLE', 'Database not available', 503);
    }

    const channelType = request.query?.channelType ? String(request.query.channelType) : undefined;
    const activeOnly = request.query?.activeOnly !== 'false';

    const params: any[] = [];
    let where = `WHERE 1=1`;
    if (channelType) {
      params.push(channelType);
      where += ` AND channel_type = $${params.length}`;
    }
    if (activeOnly) {
      where += ` AND (is_active = true OR active = true)`;
    }

    const result = await this.db.query(
      `
      SELECT id, channel_type, name, config
      FROM channel_configs
      ${where}
      ORDER BY channel_type ASC, name ASC
      LIMIT 200
      `,
      params
    );

    const channels = result.rows.map((row) => {
      const cfg = row.config || {};
      // Return identifiers only (avoid leaking secrets like apiToken/authToken)
      return {
        id: row.id,
        channelType: row.channel_type,
        name: row.name,
        provider: cfg.provider || null,
        identifiers: {
          instanceId: cfg.instanceId || null,
          phoneNumber: cfg.phoneNumber || null,
          phoneNumberId: cfg.phoneNumberId || null,
          accountSid: cfg.accountSid || null,
          wabaId: cfg.wabaId || null,
        },
      };
    });

    reply.send({
      success: true,
      data: { channels },
    });
  }

  /**
   * Upsert external context into conversation metadata (generic).
   * POST /api/v1/integrations/context/upsert
   */
  async upsertExternalContext(
    request: FastifyRequest<{
      Body: {
        channelType: ChannelType;
        userId: string;
        envelope: ExternalContextEnvelope;
        conversationMetadata?: Record<string, any>;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { channelType, userId, envelope, conversationMetadata } = request.body || ({} as any);

    if (!channelType || !userId || !envelope?.namespace || !envelope?.caseId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'channelType, userId, envelope.namespace and envelope.caseId are required',
        400
      );
    }

    const normalizedUserId =
      channelType === ChannelType.WHATSAPP ? normalizePhoneUserId(userId) : String(userId);

    const { conversationId, mergedMetadata } = await this.upsertConversationMetadata({
      channelType,
      userId: normalizedUserId,
      envelope,
      extraMetadata: conversationMetadata || {},
    });

    // Safe log (do not print seed values)
    logger.info('Integration context upserted', {
      channelType,
      userId: normalizedUserId,
      conversationId,
      namespace: envelope.namespace,
      caseId: envelope.caseId,
      refsKeys: envelope.refs ? Object.keys(envelope.refs) : [],
      seedKeys: envelope.seed ? Object.keys(envelope.seed) : [],
      hasRouting: !!envelope.routing,
      routing: {
        hasFlowId: !!envelope.routing?.flowId,
        hasChannelConfigId: !!envelope.routing?.channelConfigId,
      },
    });

    // Verbose log (PII risk): enable explicitly in env when needed
    if (envFlag('LOG_INTEGRATION_CONTEXT_VALUES')) {
      logger.warn('Integration context upserted (VERBOSE)', {
        channelType,
        userId: normalizedUserId,
        conversationId,
        namespace: envelope.namespace,
        caseId: envelope.caseId,
        refs: envelope.refs || {},
        seed: envelope.seed || {},
      });
    }

    reply.send({
      success: true,
      data: {
        conversationId,
        channelType,
        userId: normalizedUserId,
        metadata: mergedMetadata,
      },
    });
  }

  /**
   * Upsert external context + send outbound message (idempotent).
   * POST /api/v1/integrations/outbound/send
   */
  async sendOutbound(
    request: FastifyRequest<{
      Body: {
        channelType: ChannelType;
        userId: string;
        message?: string; // text or caption
        mediaUrl?: string; // if provided, send as media with caption
        mediaType?: 'image' | 'video' | 'document';
        envelope: ExternalContextEnvelope;
        conversationMetadata?: Record<string, any>;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { channelType, userId, message, mediaUrl, mediaType, envelope, conversationMetadata } =
      request.body || ({} as any);

    if (!channelType || !userId || !envelope?.namespace || !envelope?.caseId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'channelType, userId, envelope.namespace and envelope.caseId are required',
        400
      );
    }

    const hasMedia = !!mediaUrl;
    const captionText = (message || '').trim();
    if (!hasMedia && captionText.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'message is required when mediaUrl is not provided', 400);
    }

    if (hasMedia) {
      if (!mediaType) {
        throw new AppError('VALIDATION_ERROR', 'mediaType is required when mediaUrl is provided', 400);
      }
      if (!['image', 'video', 'document'].includes(String(mediaType))) {
        throw new AppError('VALIDATION_ERROR', 'mediaType must be one of: image, video, document', 400);
      }
      if (typeof mediaUrl !== 'string' || mediaUrl.trim().length === 0) {
        throw new AppError('VALIDATION_ERROR', 'mediaUrl must be a non-empty string', 400);
      }
    }

    if (channelType !== ChannelType.WHATSAPP) {
      // Keep implementation narrow for now; endpoint is generic by contract and can be extended safely.
      throw new AppError(
        'NOT_IMPLEMENTED',
        `Outbound sending for channelType='${channelType}' is not implemented yet`,
        501
      );
    }

    const normalizedUserId = normalizePhoneUserId(userId);
    const idempotencyKeyHeader = (request.headers['idempotency-key'] || '') as string;
    const idempotencyKey = String(idempotencyKeyHeader || '').trim() || undefined;

    const { conversationId, mergedMetadata } = await this.upsertConversationMetadata({
      channelType,
      userId: normalizedUserId,
      envelope,
      extraMetadata: conversationMetadata || {},
    });

    if (idempotencyKey) {
      const alreadySent = await this.wasOutboundAlreadySent(conversationId, idempotencyKey);
      if (alreadySent) {
        reply.send({
          success: true,
          data: {
            conversationId,
            channelType,
            userId: normalizedUserId,
            idempotentReplay: true,
          },
        });
        return;
      }
    }

    // Pick channelConfigId: request overrides, then conversation metadata, then any active WhatsApp channel
    const channelConfigId =
      (envelope.routing?.channelConfigId && isUuid(envelope.routing.channelConfigId)
        ? envelope.routing.channelConfigId
        : undefined) || (await this.getConversationChannelConfigId(conversationId));

    const channelConfig = await this.getWhatsAppChannelConfig(channelConfigId);

    logger.info('Integration outbound queued (pre-enqueue)', {
      channelType,
      userId: normalizedUserId,
      conversationId,
      namespace: envelope.namespace,
      caseId: envelope.caseId,
      hasIdempotencyKey: !!idempotencyKey,
      channelConfigSelected: {
        requestedChannelConfigId: envelope.routing?.channelConfigId || null,
        conversationChannelConfigId: (await this.getConversationChannelConfigId(conversationId)) || null,
      },
      provider: channelConfig?.provider || 'ultramsg',
      hasMedia: !!mediaUrl,
      mediaType: mediaType || null,
    });

    // Verbose log: expose outbound message text only if explicitly enabled
    if (envFlag('LOG_INTEGRATION_OUTBOUND_MESSAGE_TEXT')) {
      logger.warn('Integration outbound message (VERBOSE)', {
        channelType,
        userId: normalizedUserId,
        conversationId,
        namespace: envelope.namespace,
        caseId: envelope.caseId,
        message: truncateText(message || '', 1500),
        mediaUrl: mediaUrl ? truncateText(mediaUrl, 300) : null,
        mediaType: mediaType || null,
      });
    }

    // Enqueue outbound send via the existing WhatsApp sending queue
    await this.enqueueWhatsAppOutbound(
      normalizedUserId,
      conversationId,
      captionText,
      channelConfig,
      hasMedia ? { mediaUrl: String(mediaUrl).trim(), mediaType } : undefined
    );

    // Persist outbound message in DB for audit/history + idempotency
    await this.saveOutboundMessage(conversationId, captionText, {
      idempotencyKey,
      source: 'integration',
      namespace: envelope.namespace,
      caseId: envelope.caseId,
      media: hasMedia ? { mediaUrl: String(mediaUrl).trim(), mediaType } : undefined,
    });

    // Best-effort: update MCP context metadata for immediate availability (no effect if context not created yet)
    await this.updateMcpContextMetadataBestEffort(channelType, normalizedUserId, conversationId, mergedMetadata);

    reply.send({
      success: true,
      data: {
        conversationId,
        channelType,
        userId: normalizedUserId,
        queued: true,
      },
    });
  }

  private async upsertConversationMetadata(params: {
    channelType: ChannelType;
    userId: string;
    envelope: ExternalContextEnvelope;
    extraMetadata: Record<string, any>;
  }): Promise<{ conversationId: string; mergedMetadata: any }> {
    const { channelType, userId, envelope, extraMetadata } = params;

    if (!this.db) {
      throw new AppError('DB_NOT_AVAILABLE', 'Database not available', 503);
    }

    // Get the flow_id from the envelope routing
    const newFlowId = envelope.routing?.flowId && isUuid(envelope.routing.flowId) 
      ? envelope.routing.flowId 
      : null;

    // Check if a conversation exists with the same channel, userId, and flow_id
    // This allows multiple conversations for the same number with different flows
    let existingConversation = null;
    if (newFlowId) {
      const existingResult = await this.db.query(
        `SELECT id, metadata, flow_id FROM conversations 
         WHERE channel = $1 AND channel_user_id = $2 AND flow_id = $3
         LIMIT 1`,
        [channelType, userId, newFlowId]
      );
      if (existingResult.rows.length > 0) {
        existingConversation = existingResult.rows[0];
      }
    }

    let conversationId: string;
    let existingMetadata: any = {};

    if (existingConversation) {
      // Use existing conversation with same flow_id
      conversationId = existingConversation.id as string;
      existingMetadata = existingConversation.metadata || {};
      logger.info('Using existing conversation with same flow_id', {
        conversationId,
        flowId: newFlowId,
        channelType,
        userId,
      });
    } else {
      // Check if there's a conversation without flow_id (legacy) or with different flow_id
      const legacyResult = await this.db.query(
        `SELECT id, metadata, flow_id FROM conversations 
         WHERE channel = $1 AND channel_user_id = $2
         LIMIT 1`,
        [channelType, userId]
      );

      if (legacyResult.rows.length > 0) {
        const legacyConversation = legacyResult.rows[0];
        const legacyFlowId = legacyConversation.flow_id;

        // If the legacy conversation has no flow_id or a different flow_id, create a new one
        if (!legacyFlowId || (newFlowId && legacyFlowId !== newFlowId)) {
          // Create new conversation with the new flow_id
          const insertResult = await this.db.query(
            `
            INSERT INTO conversations (channel, channel_user_id, metadata, status, flow_id)
            VALUES ($1, $2, $3, 'active', $4)
            RETURNING id
            `,
            [channelType, userId, JSON.stringify({ source: 'integration' }), newFlowId]
          );
          conversationId = insertResult.rows[0].id as string;
          logger.info('Created new conversation for different flow_id', {
            conversationId,
            flowId: newFlowId,
            legacyFlowId,
            channelType,
            userId,
            reason: 'Different flow_id requires separate conversation',
          });
        } else {
          // Use existing conversation (same flow_id)
          conversationId = legacyConversation.id as string;
          existingMetadata = legacyConversation.metadata || {};
        }
      } else {
        // No existing conversation, create new one
        const insertResult = await this.db.query(
          `
          INSERT INTO conversations (channel, channel_user_id, metadata, status, flow_id)
          VALUES ($1, $2, $3, 'active', $4)
          RETURNING id
          `,
          [channelType, userId, JSON.stringify({ source: 'integration' }), newFlowId]
        );
        conversationId = insertResult.rows[0].id as string;
        logger.info('Created new conversation', {
          conversationId,
          flowId: newFlowId,
          channelType,
          userId,
        });
      }
    }

    const externalContextUpdate = {
      case_id: envelope.caseId,
      refs: envelope.refs || {},
      seed: envelope.seed || {},
      routing: envelope.routing || {},
      updated_at: new Date().toISOString(),
    };

    const mergedMetadata = this.mergeConversationMetadata(existingMetadata, {
      ...extraMetadata,
      external_context: {
        ...(existingMetadata.external_context || {}),
        [envelope.namespace]: {
          ...((existingMetadata.external_context || {})[envelope.namespace] || {}),
          ...externalContextUpdate,
        },
      },
    });

    await this.db.query(`UPDATE conversations SET metadata = $1, last_activity = NOW() WHERE id = $2`, [
      JSON.stringify(mergedMetadata),
      conversationId,
    ]);

    // Ensure flow_id is set (in case it wasn't set during creation)
    if (newFlowId) {
      await this.db.query(`UPDATE conversations SET flow_id = $1 WHERE id = $2`, [
        newFlowId,
        conversationId,
      ]);
    }

    // Best-effort: update MCP context metadata too
    await this.updateMcpContextMetadataBestEffort(channelType, userId, conversationId, mergedMetadata);

    return { conversationId, mergedMetadata };
  }

  private mergeConversationMetadata(existing: any, incoming: any): any {
    const base = { ...(existing || {}) };
    const next = { ...(incoming || {}) };

    // Ensure external_context deep-merge
    if (base.external_context || next.external_context) {
      const mergedExternal = {
        ...(base.external_context || {}),
        ...(next.external_context || {}),
      };
      return { ...base, ...next, external_context: mergedExternal };
    }

    return { ...base, ...next };
  }

  private async wasOutboundAlreadySent(conversationId: string, idempotencyKey: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        `
        SELECT 1
        FROM messages
        WHERE conversation_id = $1
          AND role = 'assistant'
          AND (metadata->>'idempotencyKey')::text = $2
        LIMIT 1
        `,
        [conversationId, idempotencyKey]
      );
      return result.rows.length > 0;
    } catch (e: any) {
      logger.debug('Idempotency lookup failed (non-fatal, will proceed)', {
        conversationId,
        error: e.message,
      });
      return false;
    }
  }

  private async getConversationChannelConfigId(conversationId: string): Promise<string | undefined> {
    try {
      const res = await this.db.query(`SELECT metadata FROM conversations WHERE id = $1`, [conversationId]);
      const md = res.rows[0]?.metadata || {};
      const ccid = md.channel_config_id;
      if (typeof ccid === 'string' && isUuid(ccid)) return ccid;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async getWhatsAppChannelConfig(channelConfigId?: string): Promise<any> {
    // Prefer explicit channelConfigId
    if (channelConfigId) {
      const res = await this.db.query(
        `
        SELECT id, config
        FROM channel_configs
        WHERE id = $1 AND channel_type = 'whatsapp' AND (is_active = true OR active = true)
        LIMIT 1
        `,
        [channelConfigId]
      );
      if (res.rows.length > 0) return res.rows[0].config;
    }

    // Fallback: any active WhatsApp channel
    const res = await this.db.query(
      `
      SELECT id, config
      FROM channel_configs
      WHERE channel_type = 'whatsapp' AND (is_active = true OR active = true)
      ORDER BY name ASC
      LIMIT 1
      `
    );
    if (res.rows.length === 0) {
      throw new AppError('CONFIG_NOT_FOUND', 'No active WhatsApp channel config found', 400);
    }
    return res.rows[0].config;
  }

  private async enqueueWhatsAppOutbound(
    userId: string,
    conversationId: string,
    content: string,
    channelConfig: any,
    media?: { mediaUrl: string; mediaType?: 'image' | 'video' | 'document' }
  ): Promise<void> {
    const queueManager = getQueueManager();

    const provider = channelConfig?.provider || 'ultramsg';
    const apiToken = channelConfig?.token || channelConfig?.apiToken;

    await queueManager.addJob(
      QueueName.WHATSAPP_SENDING,
      'outbound-integration-message',
      {
        userId,
        message: {
          channelUserId: userId,
          content,
          ...(media?.mediaUrl
            ? {
                mediaUrl: media.mediaUrl,
                mediaType: media.mediaType,
              }
            : {}),
          metadata: { outbound: true, conversationId, source: 'integration' },
        },
        channelConfig: {
          provider,
          instanceId: channelConfig?.instanceId,
          apiToken,
          phoneNumber: channelConfig?.phoneNumber,
          phoneNumberId: channelConfig?.phoneNumberId,
          accountSid: channelConfig?.accountSid,
          authToken: channelConfig?.authToken,
          wabaId: channelConfig?.wabaId,
        },
      },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 } }
    );
  }

  private async saveOutboundMessage(
    conversationId: string,
    content: string,
    meta: {
      idempotencyKey?: string;
      source: string;
      namespace: string;
      caseId: string;
      media?: { mediaUrl: string; mediaType?: 'image' | 'video' | 'document' };
    }
  ): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO messages (conversation_id, role, content, metadata)
        VALUES ($1, 'assistant', $2, $3)
        `,
        [
          conversationId,
          content,
          JSON.stringify({
            outbound: true,
            sentBy: 'integration',
            source: meta.source,
            idempotencyKey: meta.idempotencyKey || null,
            external: { namespace: meta.namespace, caseId: meta.caseId },
            media: meta.media || null,
          }),
        ]
      );
    } catch (e: any) {
      // Non-fatal: message was already queued; keep system operational
      logger.warn('Failed to persist outbound integration message (non-fatal)', {
        conversationId,
        error: e.message,
      });
    }
  }

  private async updateMcpContextMetadataBestEffort(
    channelType: ChannelType,
    userId: string,
    conversationId: string,
    conversationMetadata: any
  ): Promise<void> {
    try {
      if (!this.mcpServer) return;
      // Use conversationId in sessionId to isolate contexts per conversation (avoids mixing between flows)
      const sessionId = generateSessionId(channelType, userId, conversationId);
      const existing = await this.mcpServer.getContext(sessionId);
      if (!existing) return;

      const merged = {
        ...(existing.metadata || {}),
        ...(conversationMetadata || {}),
        external_context: {
          ...(existing.metadata?.external_context || {}),
          ...(conversationMetadata?.external_context || {}),
        },
      };

      await this.mcpServer.updateContext(sessionId, {
        conversationId,
        metadata: merged,
        updatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      logger.debug('MCP metadata update failed (non-fatal)', { error: e.message });
    }
  }
}

