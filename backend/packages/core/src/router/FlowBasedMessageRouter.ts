import { Pool } from 'pg';
import {
  IncomingMessage,
  createLogger,
} from '@cortex/shared';
import { RoutingMatcher, RoutingConditions } from '../routing/RoutingMatcher';

const logger = createLogger('FlowBasedMessageRouter');

export interface OrchestrationFlow {
  id: string;
  name: string;
  llm_id: string;
  enabled_tools: string[];
  routing_conditions: RoutingConditions;
  priority: number;
  active: boolean;
  flow_config?: any; // Configuration from flow_config column (includes systemPrompt, etc.)
  // Joined data
  llm_provider?: string;
  llm_model?: string;
  channel_type?: string;
}

export interface RoutingResult {
  flow: OrchestrationFlow;
  llmProvider: string;
  llmModel: string;
  llmConfig: any;
  enabledTools: string[];
  channelConfig?: any; // Configuration from channel_configs table
  channelConfigId?: string; // ID of the channel configuration (UUID primary key)
}

/**
 * Flow-Based Message Router
 * Routes messages using orchestration_flows from database
 */
export class FlowBasedMessageRouter {
  private db: Pool;
  private matcher: RoutingMatcher;

  constructor(db: Pool) {
    this.db = db;
    this.matcher = new RoutingMatcher();
    logger.info('FlowBasedMessageRouter initialized');
  }

  /**
   * Route a message to find matching orchestration flow
   */
  async route(message: IncomingMessage & { phoneNumber?: string; userId?: string; timestamp?: string | Date }): Promise<RoutingResult | null> {
    // Build complete message object with all routing fields extracted from NormalizedMessage
    const routingMessage: any = {
      ...message,
      // Phone number: extract from phoneNumber field or channelUserId for WhatsApp
      phoneNumber: message.phoneNumber || (message.channelType === 'whatsapp' ? message.channelUserId : undefined),
      // Bot username: extract from metadata for Telegram
      botUsername: message.metadata?.from?.username || message.metadata?.botUsername,
      // Email address: for Email channel, the channelUserId is the email address
      emailAddress: message.channelType === 'email' ? message.channelUserId : undefined,
      // User roles: extract from metadata
      userRoles: message.metadata?.userRoles || message.metadata?.roles || [],
      // Timestamp: convert ISO string to Date if needed
      timestamp: message.timestamp 
        ? (message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp))
        : new Date(),
      // Content: already in message
      content: message.content,
      // Metadata: already in message
      metadata: message.metadata || {},
    };

    // Extract channel_config_id from metadata if provided (for direct channel routing)
    // Otherwise, use any channel of the matching type
    const requestedChannelId = message.metadata?.channelId || message.metadata?.channel_config_id;

    logger.info('🔍 ROUTING MESSAGE - START', {
      channelType: routingMessage.channelType,
      userId: routingMessage.userId || routingMessage.channelUserId,
      phoneNumber: routingMessage.phoneNumber,
      botUsername: routingMessage.botUsername,
      emailAddress: routingMessage.emailAddress,
      userRoles: routingMessage.userRoles,
      timestamp: routingMessage.timestamp,
      requestedChannelId: requestedChannelId || '(any channel of this type)',
      fullMetadata: routingMessage.metadata,
      messageContent: routingMessage.content?.substring(0, 100),
    });

    // Query database for active flows matching the channel type via flow_channels.
    // CRITICAL: if requestedChannelId is provided, DO NOT consider other channels.
    // This prevents cross-brand routing when multiple WhatsApp channels exist (e.g., PuntoNet vs Alfanet).
    // Fallback: if there are no flows for the requested channel, then consider any channel of this type.
    const baseSelect = `SELECT DISTINCT
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
        WHERE c.channel_type = $1
          AND f.active = true
          AND l.active = true
          AND c.is_active = true`;

    let result;
    if (requestedChannelId) {
      // First pass: only the requested channel_config_id
      result = await this.db.query(
        `${baseSelect}
          AND c.id = $2::uuid
        ORDER BY f.priority ASC`,
        [message.channelType, requestedChannelId]
      );

      if (result.rows.length === 0) {
        logger.warn('⚠️  No flows found for requested channel id, falling back to any channel of this type', {
          channelType: message.channelType,
          requestedChannelId,
        });
        // Fallback pass: any channel of this type
        result = await this.db.query(
          `${baseSelect}
          ORDER BY f.priority ASC`,
          [message.channelType]
        );
      }
    } else {
      // No explicit channel requested: any channel of this type
      result = await this.db.query(
        `${baseSelect}
        ORDER BY f.priority ASC`,
        [message.channelType]
      );
    }

    if (result.rows.length === 0) {
      logger.warn('❌ No active flows found for channel', {
        channelType: message.channelType,
        requestedChannelId: requestedChannelId || '(any channel of this type)',
      });
      return null;
    }

    logger.info('✅ Found potential flows', { 
      count: result.rows.length,
      flows: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        channel_config_id: row.channel_config_id,
        priority: row.priority,
      }))
    });
    
    // Log raw flow_config from database for debugging
    if (result.rows.length > 0) {
      logger.info('Raw flow_config from database', {
        flowId: result.rows[0].id,
        flowName: result.rows[0].name,
        flowConfigType: typeof result.rows[0].flow_config,
        flowConfigIsNull: result.rows[0].flow_config == null,
        flowConfigPreview: result.rows[0].flow_config 
          ? (typeof result.rows[0].flow_config === 'string' 
              ? result.rows[0].flow_config.substring(0, 200)
              : JSON.stringify(result.rows[0].flow_config).substring(0, 200))
          : 'null',
      });
    }

    // Find first matching flow based on routing_conditions
    for (const row of result.rows) {
      // Parse flow_config if it's a string (PostgreSQL JSONB can return as string)
      let flowConfig: any = row.flow_config;
      
      // Handle null/undefined
      if (flowConfig == null) {
        flowConfig = {};
      }
      
      // Parse if it's a string
      if (typeof flowConfig === 'string') {
        try {
          flowConfig = JSON.parse(flowConfig);
        } catch (e) {
          logger.warn('Failed to parse flow_config', { flowId: row.id, error: (e as Error).message });
          flowConfig = {};
        }
      }
      
      // Ensure it's an object
      if (typeof flowConfig !== 'object' || Array.isArray(flowConfig)) {
        logger.warn('flow_config is not an object', { flowId: row.id, type: typeof flowConfig });
        flowConfig = {};
      }
      
      const flow: OrchestrationFlow = {
        id: row.id,
        name: row.name,
        llm_id: row.llm_id,
        enabled_tools: row.enabled_tools || [],
        routing_conditions: row.routing_conditions || {},
        priority: row.priority,
        active: row.active,
        flow_config: flowConfig, // Include flow configuration (systemPrompt, etc.)
        llm_provider: row.llm_provider,
        llm_model: row.llm_model,
        channel_type: row.channel_type,
      };
      
      logger.info('Processing flow for routing', {
        flowId: flow.id,
        flowName: flow.name,
        channel_config_id: row.channel_config_id,
        hasSystemPrompt: !!flowConfig?.systemPrompt,
        systemPromptLength: flowConfig?.systemPrompt?.length || 0,
        flowConfigType: typeof row.flow_config,
        flowConfigKeys: flowConfig ? Object.keys(flowConfig) : [],
        flowConfigPreview: flowConfig ? JSON.stringify(flowConfig).substring(0, 500) : 'null',
      });

      // Check if message matches routing conditions
      logger.info('🔍 Evaluating routing conditions', {
        flowId: flow.id,
        flowName: flow.name,
        conditions: flow.routing_conditions,
        messageContent: routingMessage.content?.substring(0, 100),
        messageFields: {
          phoneNumber: routingMessage.phoneNumber,
          botUsername: routingMessage.botUsername,
          emailAddress: routingMessage.emailAddress,
          userRoles: routingMessage.userRoles,
          hasTimestamp: !!routingMessage.timestamp,
          hasMetadata: !!routingMessage.metadata,
        },
      });
      
      if (this.matcher.matches(routingMessage, flow.routing_conditions)) {
        // Log detailed flow_config information BEFORE returning
        logger.info('✅ MATCHED orchestration flow - DETAILED BEFORE RETURN', {
          flowId: flow.id,
          flowName: flow.name,
          llmProvider: flow.llm_provider,
          llmModel: flow.llm_model,
          enabledTools: flow.enabled_tools.length,
          priority: flow.priority,
          hasFlowConfig: !!flow.flow_config,
          flowConfigType: typeof flow.flow_config,
          hasSystemPrompt: !!flow.flow_config?.systemPrompt,
          systemPromptLength: flow.flow_config?.systemPrompt?.length || 0,
          flowConfigKeys: flow.flow_config ? Object.keys(flow.flow_config) : [],
          flowConfigFull: flow.flow_config ? JSON.stringify(flow.flow_config).substring(0, 1000) : 'null',
          flowConfigSystemPrompt: flow.flow_config?.systemPrompt ? flow.flow_config.systemPrompt.substring(0, 200) : 'NOT FOUND',
        });
        
        logger.info('Matched orchestration flow', {
          flowId: flow.id,
          flowName: flow.name,
          llmProvider: flow.llm_provider,
          llmModel: flow.llm_model,
          enabledTools: flow.enabled_tools.length,
          priority: flow.priority,
          hasSystemPrompt: !!flowConfig?.systemPrompt,
          systemPromptLength: flowConfig?.systemPrompt?.length || 0,
          flowConfigKeys: flowConfig ? Object.keys(flowConfig) : [],
        });

        return {
          flow,
          llmProvider: row.llm_provider,
          llmModel: row.llm_model,
          llmConfig: row.llm_config,
          enabledTools: flow.enabled_tools,
          channelConfig: row.channel_config,
          channelConfigId: row.channel_config_id,
        };
      } else {
        logger.warn('❌ Flow conditions NOT matched', {
          flowId: flow.id,
          flowName: flow.name,
          conditions: flow.routing_conditions,
          messageContent: routingMessage.content?.substring(0, 100),
          messageMetadata: routingMessage.metadata,
        });
      }
    }

    // If no flow matched routing_conditions, return first flow (highest priority)
    const defaultFlow = result.rows[0];
    
    // Parse flow_config if it's a string
    let defaultFlowConfig = defaultFlow.flow_config;
    if (typeof defaultFlowConfig === 'string') {
      try {
        defaultFlowConfig = JSON.parse(defaultFlowConfig);
      } catch (e) {
        logger.warn('Failed to parse default flow_config', { flowId: defaultFlow.id, error: (e as Error).message });
        defaultFlowConfig = {};
      }
    }
    
    logger.warn('⚠️  No flow matched routing conditions, using highest priority flow as FALLBACK', {
      flowId: defaultFlow.id,
      flowName: defaultFlow.name,
      priority: defaultFlow.priority,
      channel_config_id: defaultFlow.channel_config_id,
      hasSystemPrompt: !!defaultFlowConfig?.systemPrompt,
      systemPromptLength: defaultFlowConfig?.systemPrompt?.length || 0,
      requestedChannelId: requestedChannelId || '(any channel)',
      totalFlowsEvaluated: result.rows.length,
    });

    return {
      flow: {
        id: defaultFlow.id,
        name: defaultFlow.name,
        llm_id: defaultFlow.llm_id,
        enabled_tools: defaultFlow.enabled_tools || [],
        routing_conditions: defaultFlow.routing_conditions || {},
        priority: defaultFlow.priority,
        active: defaultFlow.active,
        flow_config: defaultFlowConfig, // Include flow configuration (systemPrompt, etc.)
        llm_provider: defaultFlow.llm_provider,
        llm_model: defaultFlow.llm_model,
        channel_type: defaultFlow.channel_type,
      },
      llmProvider: defaultFlow.llm_provider,
      llmModel: defaultFlow.llm_model,
      llmConfig: defaultFlow.llm_config,
      enabledTools: defaultFlow.enabled_tools || [],
      channelConfig: defaultFlow.channel_config,
      channelConfigId: defaultFlow.channel_config_id,
    };
  }

  /**
   * Test routing for a message without actually executing
   */
  async testRoute(message: IncomingMessage): Promise<{
    matched: boolean;
    flow?: OrchestrationFlow;
    reason?: string;
  }> {
    const result = await this.route(message);

    if (!result) {
      return {
        matched: false,
        reason: 'No active flows found for channel',
      };
    }

    return {
      matched: true,
      flow: result.flow,
    };
  }

  /**
   * Get all active flows for a channel type
   * Uses flow_channels table for M:M relationship
   */
  async getFlowsForChannel(channelType: string): Promise<OrchestrationFlow[]> {
    const result = await this.db.query(
      `SELECT DISTINCT
        f.*,
        l.provider as llm_provider,
        l.model as llm_model,
        c.channel_type
      FROM orchestration_flows f
      JOIN llm_configs l ON f.llm_id = l.id
      JOIN flow_channels fc ON f.id = fc.flow_id AND fc.active = true
      JOIN channel_configs c ON fc.channel_id = c.id
      WHERE c.channel_type = $1
        AND f.active = true
        AND c.is_active = true
      ORDER BY f.priority ASC`,
      [channelType]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      llm_id: row.llm_id,
      enabled_tools: row.enabled_tools || [],
      routing_conditions: row.routing_conditions || {},
      priority: row.priority,
      active: row.active,
      llm_provider: row.llm_provider,
      llm_model: row.llm_model,
      channel_type: row.channel_type,
    }));
  }
}
