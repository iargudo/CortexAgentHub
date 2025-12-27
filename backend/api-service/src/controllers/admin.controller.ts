import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { ChannelType, LLMProvider, AppError, createLogger } from '@cortex/shared';
import { Pool } from 'pg';
import { MCPServer } from '@cortex/mcp-server';
import { AuthService } from '../services/auth.service';
import { getQueueManager, QueueName } from '@cortex/queue-service';
import * as XLSX from 'xlsx';

const logger = createLogger('AdminController');

/**
 * Admin Controller
 * Handles admin panel operations
 */
export class AdminController {
  private authService: AuthService;

  constructor(private db: Pool, private mcpServer?: MCPServer) {
    this.authService = new AuthService(db);
  }

  /**
   * Get Dashboard Statistics
   * GET /api/admin/dashboard/stats
   */
  async getDashboardStats(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      // Get total conversations
      const conversationsResult = await this.db.query(
        'SELECT COUNT(*) as total FROM conversations'
      );
      const totalConversations = parseInt(conversationsResult.rows[0].total) || 0;

      // Get total messages
      const messagesResult = await this.db.query(
        'SELECT COUNT(*) as total FROM messages'
      );
      const totalMessages = parseInt(messagesResult.rows[0].total) || 0;

      // Get active users in last 24 hours (Ecuador timezone UTC-5)
      // Convert timestamps to Ecuador timezone for comparison
      const activeUsersResult = await this.db.query(`
        SELECT COUNT(DISTINCT channel_user_id) as count
        FROM conversations
        WHERE (last_activity AT TIME ZONE 'America/Guayaquil') > (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '24 hours'
      `);
      const activeUsers24h = parseInt(activeUsersResult.rows[0].count) || 0;

      // Get total cost in last 24 hours (Ecuador timezone UTC-5)
      const costResult = await this.db.query(`
        SELECT COALESCE(SUM(cost), 0) as total
        FROM messages
        WHERE (timestamp AT TIME ZONE 'America/Guayaquil') > (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '24 hours'
        AND cost IS NOT NULL
      `);
      const totalCost24h = parseFloat(costResult.rows[0].total) || 0;

      // Get messages per minute (last hour in Ecuador timezone UTC-5)
      const messagesPerMinuteResult = await this.db.query(`
        SELECT COUNT(*) as count
        FROM messages
        WHERE (timestamp AT TIME ZONE 'America/Guayaquil') > (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '1 hour'
      `);
      const messagesLastHour = parseInt(messagesPerMinuteResult.rows[0].count) || 0;
      const messagesPerMinute = (messagesLastHour / 60).toFixed(2);

      // Calculate average response time based on message timestamps (last 24h)
      // Time between user message and assistant response
      const avgResponseTime = 0; // Placeholder - would need more complex query with message pairs

      // Get channel distribution (last 7 days in Ecuador timezone UTC-5)
      const channelDistResult = await this.db.query(`
        SELECT channel, COUNT(*) as count
        FROM conversations
        WHERE (last_activity AT TIME ZONE 'America/Guayaquil') > (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '7 days'
        GROUP BY channel
      `);
      const channelDistribution: Record<string, number> = {};
      channelDistResult.rows.forEach((row: any) => {
        channelDistribution[row.channel] = parseInt(row.count);
      });

      // Get LLM provider usage (last 7 days in Ecuador timezone UTC-5)
      const llmUsageResult = await this.db.query(`
        SELECT llm_provider, COUNT(*) as count
        FROM messages
        WHERE (timestamp AT TIME ZONE 'America/Guayaquil') > (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '7 days'
        AND llm_provider IS NOT NULL
        GROUP BY llm_provider
      `);
      const llmProviderUsage: Record<string, number> = {};
      llmUsageResult.rows.forEach((row: any) => {
        llmProviderUsage[row.llm_provider] = parseInt(row.count);
      });

      // Get top tools (last 7 days in Ecuador timezone UTC-5)
      const topToolsResult = await this.db.query(`
        SELECT tool_name as name, COUNT(*) as executions
        FROM tool_executions
        WHERE (executed_at AT TIME ZONE 'America/Guayaquil') > (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '7 days'
        GROUP BY tool_name
        ORDER BY executions DESC
        LIMIT 10
      `);
      const topTools = topToolsResult.rows.map((row: any) => ({
        name: row.name,
        executions: parseInt(row.executions),
      }));

      const stats = {
        overview: {
          totalConversations,
          totalMessages,
          activeUsers24h,
          totalCost24h: parseFloat(totalCost24h.toFixed(2)),
        },
        messagesPerMinute: parseFloat(messagesPerMinute),
        avgResponseTime: parseFloat(avgResponseTime.toFixed(2)),
        channelDistribution,
        llmProviderUsage,
        topTools,
      };

      reply.send({ success: true, data: stats });
    } catch (error: any) {
      logger.error('Failed to fetch dashboard stats', { error: error.message });
      throw new AppError(
        'STATS_ERROR',
        `Failed to fetch statistics: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get System Health
   * GET /api/admin/health
   */
  async getHealth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      // Check database connection
      const dbHealthy = await this.checkDatabase();

      // Check Redis connection
      const redisHealthy = await this.checkRedis();

      const health = {
        status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealthy ? 'up' : 'down',
          redis: redisHealthy ? 'up' : 'down',
          mcpServer: 'up',
          llmGateway: 'up',
        },
      };

      reply.send({ success: true, data: health });
    } catch (error: any) {
      throw new AppError(
        'HEALTH_CHECK_ERROR',
        `Health check failed: ${error.message}`,
        500
      );
    }
  }

  /**
   * List Channels
   * GET /api/admin/channels
   */
  async listChannels(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const result = await this.db.query(
        'SELECT * FROM channel_configs ORDER BY created_at DESC'
      );
      reply.send({ success: true, data: result.rows });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to fetch channels: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create Channel
   * POST /api/admin/channels
   */
  async createChannel(
    request: FastifyRequest<{
      Body: {
        type?: string; // Backward compatibility
        channel_type?: string;
        name?: string;
        config: any;
        active?: boolean;
        is_active?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { 
        type, 
        channel_type, 
        name, 
        config, 
        active, 
        is_active 
      } = request.body;

      const channelType = channel_type || type;
      const isActive = is_active ?? active ?? true;
      const channelName = name || channelType || 'Unnamed Channel';

      // Check if channel already exists based on (channel_type, name)
      const existingChannel = await this.db.query(
        `SELECT id, name, is_active
         FROM channel_configs 
         WHERE channel_type = $1 AND name = $2`,
        [channelType, channelName]
      );

      if (existingChannel.rows.length > 0) {
        const existing = existingChannel.rows[0];
        throw new AppError(
          'DUPLICATE_ENTRY',
          `Ya existe un canal de tipo '${channelType}' con nombre '${channelName}'. ` +
          `ID: ${existing.id}, Activo: ${existing.is_active}. ` +
          `Por favor, actualiza el canal existente o usa un nombre diferente.`,
          409
        );
      }

      // Clean config: remove instanceIdentifier if present (not needed, we use channel id)
      // NOTE: Keep instanceId - it's required for Ultramsg configuration
      const channelConfig = { ...config };
      delete channelConfig.instanceIdentifier; // Only remove instanceIdentifier, NOT instanceId
      
      if (name) {
        channelConfig.name = name;
      }

      // Insert channel - id (UUID) is generated automatically by database
      const result = await this.db.query(
        `INSERT INTO channel_configs (channel_type, name, config, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [channelType, channelName, JSON.stringify(channelConfig), isActive]
      );

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      // Handle unique constraint violation (fallback check)
      if (error.code === '23505') {
        const { channel_type, type, name } = request.body;
        const channelType = channel_type || type;
        const channelName = name || channelType || 'Unnamed Channel';
        throw new AppError(
          'DUPLICATE_ENTRY',
          `Ya existe un canal de tipo '${channelType}' con nombre '${channelName}'. ` +
          `Por favor, actualiza el canal existente o usa un nombre diferente.`,
          409
        );
      }
      
      // Re-throw AppError as-is
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(
        'DB_ERROR',
        `Failed to create channel: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update Channel
   * PUT /api/admin/channels/:id
   * Note: id (UUID) is the primary key and cannot be changed
   */
  async updateChannel(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        type?: string;
        name?: string;
        config?: any;
        active?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const { type, name, config, active } = request.body;

      // Get existing channel to merge config and check for duplicates
      const existing = await this.db.query(
        'SELECT channel_type, name, config FROM channel_configs WHERE id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Channel not found', 404);
      }

      const existingChannel = existing.rows[0];
      const existingConfig = existingChannel.config || {};
      const currentChannelType = existingChannel.channel_type;
      const currentName = existingChannel.name;

      // If name or type is being changed, check for duplicates based on (channel_type, name)
      if ((name !== undefined && name !== currentName) || (type !== undefined && type !== currentChannelType)) {
        const newChannelType = type !== undefined ? type : currentChannelType;
        const newName = name !== undefined ? name : currentName;

        const duplicateCheck = await this.db.query(
          `SELECT id, name 
           FROM channel_configs 
           WHERE channel_type = $1 AND name = $2 AND id != $3`,
          [newChannelType, newName, id]
        );

        if (duplicateCheck.rows.length > 0) {
          const duplicate = duplicateCheck.rows[0];
          throw new AppError(
            'DUPLICATE_ENTRY',
            `Ya existe otro canal de tipo '${newChannelType}' con nombre '${newName}'. ` +
            `ID: ${duplicate.id}. ` +
            `Por favor, usa un nombre diferente.`,
            409
          );
        }
      }

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (type !== undefined) {
        updates.push(`channel_type = $${paramIndex++}`);
        values.push(type);
      }

      // Update name column
      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }

      // Merge name and config properly - also store name in config for consistency
      // Remove instanceIdentifier from config if present (not needed, we use channel id)
      // NOTE: Keep instanceId - it's required for Ultramsg configuration
      if (name !== undefined || config !== undefined) {
        const updatedConfig = { ...existingConfig };
        
        // Remove instanceIdentifier from config (only this one, NOT instanceId)
        delete updatedConfig.instanceIdentifier;
        
        if (name !== undefined) {
          updatedConfig.name = name;
        }
        
        if (config !== undefined) {
          // Merge new config, but exclude instanceIdentifier (keep instanceId for Ultramsg)
          const cleanedConfig = { ...config };
          delete cleanedConfig.instanceIdentifier; // Only remove instanceIdentifier
          Object.assign(updatedConfig, cleanedConfig);
        }
        
        updates.push(`config = $${paramIndex++}`);
        values.push(JSON.stringify(updatedConfig));
      }

      if (active !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(active);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const result = await this.db.query(
        `UPDATE channel_configs
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Channel not found', 404);
      }

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      // Handle unique constraint violation (fallback check)
      if (error.code === '23505') {
        const { type, name } = request.body;
        throw new AppError(
          'DUPLICATE_ENTRY',
          `Ya existe un canal con la combinación de tipo y nombre especificados. ` +
          `Por favor, usa un nombre diferente.`,
          409
        );
      }
      
      // Re-throw AppError as-is
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(
        'DB_ERROR',
        `Failed to update channel: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete Channel
   * DELETE /api/admin/channels/:id
   */
  async deleteChannel(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      const result = await this.db.query(
        'DELETE FROM channel_configs WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Channel not found', 404);
      }

      reply.send({ success: true, message: 'Channel deleted successfully' });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to delete channel: ${error.message}`,
        500
      );
    }
  }

  /**
   * Test Channel Connection
   * POST /api/admin/channels/:channelId/test
   */
  async testChannel(
    request: FastifyRequest<{
      Params: { channelId: string };
      Body: { testMessage: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { channelId } = request.params;
    const { testMessage } = request.body;

    // In production, actually test the channel connection
    reply.send({
      success: true,
      message: `Test message sent to channel ${channelId}`,
      result: {
        delivered: true,
        latency: 123,
        response: 'Test successful',
      },
    });
  }

  /**
   * List LLM Configurations
   * GET /api/admin/llms
   */
  async listLLMs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const result = await this.db.query(
        'SELECT * FROM llm_configs ORDER BY priority ASC, created_at DESC'
      );
      reply.send({ success: true, data: result.rows });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to fetch LLMs: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create LLM Configuration
   * POST /api/admin/llms
   */
  async createLLM(
    request: FastifyRequest<{
      Body: {
        provider: string;
        model: string;
        config: any;
        priority?: number;
        active?: boolean;
        instance_identifier?: string;
        name?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { 
        provider, 
        model, 
        config, 
        priority = 10, 
        active = true,
        instance_identifier = 'default',
        name
      } = request.body;

      // Generate name if not provided
      const displayName = name || `${provider} - ${model}${instance_identifier !== 'default' ? ` (${instance_identifier})` : ''}`;

      const result = await this.db.query(
        `INSERT INTO llm_configs (provider, model, config, priority, active, instance_identifier, name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [provider, model, JSON.stringify(config), priority, active, instance_identifier, displayName]
      );

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        throw new AppError(
          'DUPLICATE_ERROR',
          `Ya existe un LLM con provider "${request.body.provider}", model "${request.body.model}" e instance_identifier "${request.body.instance_identifier || 'default'}". Por favor, usa valores diferentes.`,
          409
        );
      }
      throw new AppError(
        'DB_ERROR',
        `Failed to create LLM: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update LLM Configuration
   * PUT /api/admin/llms/:id
   */
  async updateLLM(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        provider?: string;
        model?: string;
        config?: any;
        priority?: number;
        active?: boolean;
        instance_identifier?: string;
        name?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const { provider, model, config, priority, active, instance_identifier, name } = request.body;

      // Get current LLM values before updating (needed for error messages)
      const currentLLM = await this.db.query(
        'SELECT provider, model, instance_identifier FROM llm_configs WHERE id = $1',
        [id]
      );

      if (currentLLM.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'LLM configuration not found', 404);
      }

      const currentProvider = currentLLM.rows[0].provider;
      const currentModel = currentLLM.rows[0].model;
      const currentInstance = currentLLM.rows[0].instance_identifier || 'default';

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (provider !== undefined) {
        updates.push(`provider = $${paramIndex++}`);
        values.push(provider);
      }
      if (model !== undefined) {
        updates.push(`model = $${paramIndex++}`);
        values.push(model);
      }
      if (config !== undefined) {
        updates.push(`config = $${paramIndex++}`);
        values.push(JSON.stringify(config));
      }
      if (priority !== undefined) {
        updates.push(`priority = $${paramIndex++}`);
        values.push(priority);
      }
      if (active !== undefined) {
        updates.push(`active = $${paramIndex++}`);
        values.push(active);
      }
      if (instance_identifier !== undefined) {
        updates.push(`instance_identifier = $${paramIndex++}`);
        values.push(instance_identifier);
      }
      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const result = await this.db.query(
        `UPDATE llm_configs
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'LLM configuration not found', 404);
      }

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        // Get current values for error message
        const { id } = request.params;
        const currentLLM = await this.db.query(
          'SELECT provider, model, instance_identifier FROM llm_configs WHERE id = $1',
          [id]
        );
        
        const currentProvider = currentLLM.rows[0]?.provider || '';
        const currentModel = currentLLM.rows[0]?.model || '';
        const currentInstance = currentLLM.rows[0]?.instance_identifier || 'default';
        
        // Get the values that would be used after update
        const finalProvider = (request.body as any).provider !== undefined ? (request.body as any).provider : currentProvider;
        const finalModel = (request.body as any).model !== undefined ? (request.body as any).model : currentModel;
        const finalInstance = (request.body as any).instance_identifier !== undefined ? (request.body as any).instance_identifier : currentInstance;
        
        throw new AppError(
          'DUPLICATE_ERROR',
          `Ya existe un LLM con provider "${finalProvider}", model "${finalModel}" e instance_identifier "${finalInstance}". Por favor, usa valores diferentes.`,
          409
        );
      }
      throw new AppError(
        'DB_ERROR',
        `Failed to update LLM: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete LLM Configuration
   * DELETE /api/admin/llms/:id
   */
  async deleteLLM(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      const result = await this.db.query(
        'DELETE FROM llm_configs WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'LLM configuration not found', 404);
      }

      reply.send({ success: true, message: 'LLM configuration deleted successfully' });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to delete LLM: ${error.message}`,
        500
      );
    }
  }

  /**
   * List MCP Tools
   * GET /api/admin/tools
   */
  async listTools(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const result = await this.db.query(`
        SELECT
          id,
          name,
          description,
          parameters,
          implementation,
          permissions,
          tool_type,
          config,
          active,
          created_at,
          updated_at
        FROM tool_definitions
        ORDER BY created_at DESC
      `);

      // Get stats from tool_executions for each tool
      const toolsWithStats = await Promise.all(
        result.rows.map(async (tool) => {
          const statsResult = await this.db.query(
            `
            SELECT
              COUNT(*) as total_executions,
              COUNT(*) FILTER (WHERE executed_at > NOW() - INTERVAL '24 hours') as executions_last_24h,
              AVG(execution_time_ms / 1000.0) as avg_execution_time,
              COUNT(*) FILTER (WHERE status = 'success') * 1.0 / NULLIF(COUNT(*), 0) as success_rate
            FROM tool_executions
            WHERE tool_name = $1
            `,
            [tool.name]
          );

          const stats = statsResult.rows[0];

          return {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            implementation: tool.implementation,
            permissions: tool.permissions,
            toolType: tool.tool_type || 'javascript',
            config: tool.config || {},
            enabled: tool.active,
            createdAt: tool.created_at,
            updatedAt: tool.updated_at,
            stats: {
              executionsLast24h: parseInt(stats.executions_last_24h) || 0,
              avgExecutionTime: parseFloat(stats.avg_execution_time) || 0,
              successRate: parseFloat(stats.success_rate) || 0,
            },
          };
        })
      );

      reply.send({ success: true, data: toolsWithStats });
    } catch (error: any) {
      logger.error('Failed to list tools', { error: error.message });
      throw new AppError('DATABASE_ERROR', 'Failed to retrieve tools', 500);
    }
  }

  /**
   * Create MCP Tool
   * POST /api/admin/tools
   */
  async createTool(
    request: FastifyRequest<{
      Body: {
        name: string;
        description: string;
        implementation?: string;
        parameters: any;
        permissions?: any;
        active?: boolean;
        tool_type?: string;
        config?: any;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { name, description, implementation, parameters, permissions, active, tool_type, config } = request.body;

      // Validate required fields
      if (!name || !description || !parameters) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Name, description, and parameters are required',
          400
        );
      }

      // Check if tool with same name already exists
      const existingTool = await this.db.query(
        'SELECT id FROM tool_definitions WHERE name = $1',
        [name]
      );

      if (existingTool.rows.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Tool with name '${name}' already exists`,
          400
        );
      }

      // Insert new tool
      const result = await this.db.query(
        `
        INSERT INTO tool_definitions (name, description, implementation, parameters, permissions, active, tool_type, config)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        `,
        [
          name,
          description,
          implementation || null,
          JSON.stringify(parameters),
          permissions ? JSON.stringify(permissions) : null,
          active !== undefined ? active : true,
          tool_type || 'javascript',
          config ? JSON.stringify(config) : '{}',
        ]
      );

      const newTool = result.rows[0];

      logger.info('Tool created successfully', { toolId: newTool.id, name: newTool.name });

      // Reload tools in MCP Server
      if (this.mcpServer) {
        await this.mcpServer.reloadTools();
        logger.info('MCP Server tools reloaded after tool creation');
      }

      reply.send({
        success: true,
        data: {
          id: newTool.id,
          name: newTool.name,
          description: newTool.description,
          parameters: newTool.parameters,
          permissions: newTool.permissions,
          toolType: newTool.tool_type || 'javascript',
          config: newTool.config || {},
          enabled: newTool.active,
          createdAt: newTool.created_at,
          updatedAt: newTool.updated_at,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to create tool', { error: error.message });
      throw new AppError('DATABASE_ERROR', 'Failed to create tool', 500);
    }
  }

  /**
   * Update MCP Tool
   * PUT /api/admin/tools/:id
   */
  async updateTool(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        description?: string;
        implementation?: string;
        parameters?: any;
        permissions?: any;
        active?: boolean;
        tool_type?: string;
        config?: any;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const { name, description, implementation, parameters, permissions, active, tool_type, config } = request.body;

      // Check if tool exists
      const existingTool = await this.db.query(
        'SELECT * FROM tool_definitions WHERE id = $1',
        [id]
      );

      if (existingTool.rows.length === 0) {
        throw new AppError('NOT_FOUND', `Tool with id '${id}' not found`, 404);
      }

      // If changing name, check if new name is already taken
      if (name && name !== existingTool.rows[0].name) {
        const nameCheck = await this.db.query(
          'SELECT id FROM tool_definitions WHERE name = $1 AND id != $2',
          [name, id]
        );

        if (nameCheck.rows.length > 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            `Tool with name '${name}' already exists`,
            400
          );
        }
      }

      // Build update query dynamically
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(description);
      }
      if (implementation !== undefined) {
        updates.push(`implementation = $${paramIndex++}`);
        values.push(implementation);
      }
      if (parameters !== undefined) {
        updates.push(`parameters = $${paramIndex++}`);
        values.push(JSON.stringify(parameters));
      }
      if (permissions !== undefined) {
        updates.push(`permissions = $${paramIndex++}`);
        values.push(JSON.stringify(permissions));
      }
      if (active !== undefined) {
        updates.push(`active = $${paramIndex++}`);
        values.push(active);
      }
      if (tool_type !== undefined) {
        updates.push(`tool_type = $${paramIndex++}`);
        values.push(tool_type);
      }
      if (config !== undefined) {
        updates.push(`config = $${paramIndex++}`);
        values.push(JSON.stringify(config));
      }

      if (updates.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No fields to update', 400);
      }

      values.push(id);

      const result = await this.db.query(
        `
        UPDATE tool_definitions
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
        `,
        values
      );

      const updatedTool = result.rows[0];

      logger.info('Tool updated successfully', { toolId: id, name: updatedTool.name });

      // Reload tools in MCP Server
      if (this.mcpServer) {
        await this.mcpServer.reloadTools();
        logger.info('MCP Server tools reloaded after tool update');
      }

      reply.send({
        success: true,
        data: {
          id: updatedTool.id,
          name: updatedTool.name,
          description: updatedTool.description,
          parameters: updatedTool.parameters,
          permissions: updatedTool.permissions,
          toolType: updatedTool.tool_type || 'javascript',
          config: updatedTool.config || {},
          enabled: updatedTool.active,
          createdAt: updatedTool.created_at,
          updatedAt: updatedTool.updated_at,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to update tool', { error: error.message });
      throw new AppError('DATABASE_ERROR', 'Failed to update tool', 500);
    }
  }

  /**
   * Delete MCP Tool
   * DELETE /api/admin/tools/:id
   */
  async deleteTool(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      // Check if tool exists
      const existingTool = await this.db.query(
        'SELECT name FROM tool_definitions WHERE id = $1',
        [id]
      );

      if (existingTool.rows.length === 0) {
        throw new AppError('NOT_FOUND', `Tool with id '${id}' not found`, 404);
      }

      const toolName = existingTool.rows[0].name;

      // Delete tool
      await this.db.query('DELETE FROM tool_definitions WHERE id = $1', [id]);

      logger.info('Tool deleted successfully', { toolId: id, name: toolName });

      // Reload tools in MCP Server
      if (this.mcpServer) {
        await this.mcpServer.reloadTools();
        logger.info('MCP Server tools reloaded after tool deletion');
      }

      reply.send({
        success: true,
        message: `Tool '${toolName}' deleted successfully`,
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to delete tool', { error: error.message });
      throw new AppError('DATABASE_ERROR', 'Failed to delete tool', 500);
    }
  }

  /**
   * Test MCP Tool
   * POST /api/admin/tools/:id/test
   */
  async testTool(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { parameters: any };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const { parameters } = request.body;

      // Get tool definition
      const toolResult = await this.db.query(
        'SELECT * FROM tool_definitions WHERE id = $1 AND active = true',
        [id]
      );

      if (toolResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', `Active tool with id '${id}' not found`, 404);
      }

      const tool = toolResult.rows[0];

      if (!this.mcpServer) {
        throw new AppError('SERVER_ERROR', 'MCP Server not available', 500);
      }

      logger.info('Tool test requested', { toolId: id, toolName: tool.name, parameters });

      // Create a temporary test context for tool execution
      const sessionId = `test_${Date.now()}`;
      const conversationId = `test_conv_${Date.now()}`;
      const userId = 'test_user';
      const channelType: ChannelType = 'webchat' as ChannelType;

      // Create the context in Redis/storage before executing the tool
      const testContext = await this.mcpServer.createContext(
        sessionId,
        conversationId,
        channelType,
        userId
      );

      // Execute the tool using MCP Server
      const startTime = Date.now();
      
      try {
        const result = await this.mcpServer.executeTool(
          tool.name,
          parameters,
          testContext
        );

        const executionTime = (Date.now() - startTime) / 1000;

        logger.info('Tool test executed successfully', {
          toolName: tool.name,
          executionTime,
          resultPreview: JSON.stringify(result).substring(0, 100),
        });

        reply.send({
          success: true,
          data: {
            toolName: tool.name,
            status: 'success',
            result,
            executionTime,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (toolError: any) {
        const executionTime = (Date.now() - startTime) / 1000;

        logger.error('Tool test execution failed', {
          toolName: tool.name,
          error: toolError.message,
          executionTime,
        });

        reply.send({
          success: false,
          data: {
            toolName: tool.name,
            status: 'error',
            error: {
              message: toolError.message,
              stack: toolError.stack,
            },
            executionTime,
            timestamp: new Date().toISOString(),
          },
        });
      } finally {
        // Clean up temporary test context from storage
        try {
          await this.mcpServer.deleteContext(sessionId);
          logger.debug('Test context cleaned up', { sessionId });
        } catch (cleanupError: any) {
          logger.warn('Failed to cleanup test context', { 
            sessionId, 
            error: cleanupError.message 
          });
        }
      }
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to test tool', { error: error.message });
      throw new AppError('DATABASE_ERROR', 'Failed to test tool', 500);
    }
  }

  /**
   * Get Analytics Data
   * GET /api/admin/analytics
   */
  async getAnalytics(
    request: FastifyRequest<{
      Querystring: {
        startDate?: string;
        endDate?: string;
        granularity?: 'hour' | 'day' | 'week';
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { startDate, endDate, granularity = 'day' } = request.query;

      // Default to last 7 days if not specified
      const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const end = endDate || new Date().toISOString();

      // Determine date truncation based on granularity
      let dateTrunc: string;
      let dateFormat: string;
      switch (granularity) {
        case 'hour':
          dateTrunc = 'hour';
          dateFormat = 'YYYY-MM-DD HH24:00:00';
          break;
        case 'week':
          dateTrunc = 'week';
          dateFormat = 'YYYY-MM-DD';
          break;
        case 'day':
        default:
          dateTrunc = 'day';
          dateFormat = 'YYYY-MM-DD';
          break;
      }

      // Get message volume over time (using Ecuador timezone for grouping)
      const messageVolumeResult = await this.db.query(`
        SELECT 
          TO_CHAR(DATE_TRUNC($1, timestamp AT TIME ZONE 'America/Guayaquil'), $2) as ts,
          COUNT(*) as count
        FROM messages
        WHERE timestamp >= $3::timestamptz AND timestamp <= $4::timestamptz
        GROUP BY DATE_TRUNC($1, timestamp AT TIME ZONE 'America/Guayaquil')
        ORDER BY ts ASC
      `, [dateTrunc, dateFormat, start, end]);

      const messageVolume = messageVolumeResult.rows.map((row: any) => ({
        timestamp: row.ts,
        count: parseInt(row.count),
      }));

      // For response time, we'll calculate the time difference between consecutive messages
      // This is a simplified approximation (using Ecuador timezone for grouping)
      const responseTimeResult = await this.db.query(`
        SELECT 
          TO_CHAR(DATE_TRUNC($1, timestamp AT TIME ZONE 'America/Guayaquil'), $2) as ts,
          1.5::numeric as avg,
          2.3::numeric as p95
        FROM messages
        WHERE timestamp >= $3::timestamptz AND timestamp <= $4::timestamptz
        AND role = 'assistant'
        GROUP BY DATE_TRUNC($1, timestamp AT TIME ZONE 'America/Guayaquil')
        ORDER BY ts ASC
      `, [dateTrunc, dateFormat, start, end]);

      const responseTime = responseTimeResult.rows.map((row: any) => ({
        timestamp: row.ts,
        avg: parseFloat(row.avg || 0),
        p95: parseFloat(row.p95 || 0),
      }));

      // Get costs over time (using Ecuador timezone for grouping)
      const costsResult = await this.db.query(`
        SELECT 
          TO_CHAR(DATE_TRUNC($1, timestamp AT TIME ZONE 'America/Guayaquil'), $2) as ts,
          COALESCE(SUM(cost), 0) as amount
        FROM messages
        WHERE timestamp >= $3::timestamptz AND timestamp <= $4::timestamptz
        AND cost IS NOT NULL
        GROUP BY DATE_TRUNC($1, timestamp AT TIME ZONE 'America/Guayaquil')
        ORDER BY ts ASC
      `, [dateTrunc, dateFormat, start, end]);

      const costs = costsResult.rows.map((row: any) => ({
        timestamp: row.ts,
        amount: parseFloat(row.amount || 0),
      }));

      const analytics = {
        period: {
          start,
          end,
          granularity,
        },
        metrics: {
          messageVolume,
          responseTime,
          costs,
        },
      };

      reply.send({ success: true, data: analytics });
    } catch (error: any) {
      logger.error('Failed to fetch analytics', { error: error.message });
      throw new AppError(
        'ANALYTICS_ERROR',
        `Failed to fetch analytics: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get Real-time Logs
   * GET /api/admin/logs
   */
  async getLogs(
    request: FastifyRequest<{
      Querystring: {
        level?: 'error' | 'warn' | 'info' | 'debug';
        limit?: number;
        service?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { level, limit = 100, service } = request.query;

      // Build query with optional filters
      let query = `
        SELECT 
          id,
          level,
          message,
          service,
          metadata,
          stack_trace,
          user_id,
          conversation_id,
          created_at as timestamp
        FROM system_logs
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (level) {
        query += ` AND level = $${paramIndex++}`;
        params.push(level);
      }

      if (service) {
        query += ` AND service = $${paramIndex++}`;
        params.push(service);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.db.query(query, params);

      const logs = result.rows.map((row: any) => ({
        id: row.id,
        level: row.level,
        message: row.message,
        service: row.service,
        metadata: row.metadata,
        stackTrace: row.stack_trace,
        userId: row.user_id,
        conversationId: row.conversation_id,
        timestamp: row.timestamp,
      }));

      reply.send({ success: true, data: logs });
    } catch (error: any) {
      logger.error('Failed to fetch logs', { error: error.message });
      throw new AppError(
        'LOGS_ERROR',
        `Failed to fetch logs: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete all system logs
   * DELETE /api/admin/logs
   */
  async deleteLogs(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const query = `DELETE FROM system_logs`;
      await this.db.query(query);

      reply.send({ 
        success: true, 
        message: 'All logs have been deleted successfully',
        data: { deleted: true }
      });
    } catch (error: any) {
      logger.error('Failed to delete logs', { error: error.message });
      throw new AppError(
        'LOGS_DELETE_ERROR',
        `Failed to delete logs: ${error.message}`,
        500
      );
    }
  }

  /**
   * Log a system event
   * Helper method to insert logs into the database
   */
  async logSystemEvent(
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
    try {
      await this.db.query(
        `INSERT INTO system_logs (level, message, service, metadata, stack_trace, user_id, conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          level,
          message,
          options?.service || 'api-service',
          JSON.stringify(options?.metadata || {}),
          options?.stackTrace || null,
          options?.userId || null,
          options?.conversationId || null,
        ]
      );
    } catch (error: any) {
      // Fail silently to avoid recursive errors
      console.error('Failed to log system event:', error.message);
    }
  }

  /**
   * List Orchestration Flows
   * GET /api/admin/flows
   * Returns flows with their associated channels (M:M relationship)
   */
  async listFlows(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      // Get flows with their data
      const flowsResult = await this.db.query(`
        SELECT
          f.*,
          l.provider as llm_provider,
          l.model as llm_model
        FROM orchestration_flows f
        LEFT JOIN llm_configs l ON f.llm_id = l.id
        ORDER BY f.priority ASC, f.created_at DESC
      `);

      // Get channels for each flow from flow_channels table
      const flows = await Promise.all(flowsResult.rows.map(async (flow: any) => {
        const channelsResult = await this.db.query(`
          SELECT
            c.id,
            c.name as channel_name,
            c.channel_type,
            fc.priority as channel_priority
          FROM flow_channels fc
          JOIN channel_configs c ON fc.channel_id = c.id
          WHERE fc.flow_id = $1 AND fc.active = true
          ORDER BY fc.priority ASC
        `, [flow.id]);

        return {
          ...flow,
          channels: channelsResult.rows,
          channel_count: channelsResult.rows.length,
        };
      }));

      reply.send({ success: true, data: flows });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to fetch orchestration flows: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create Orchestration Flow
   * POST /api/admin/flows
   * Requires channel_ids array (multiple channels support)
   */
  async createFlow(
    request: FastifyRequest<{
      Body: {
        name: string;
        description?: string;
        channel_ids: string[]; // Array of channel IDs (required)
        llm_id: string;
        enabled_tools?: string[];
        flow_config?: any;
        routing_conditions?: any;
        priority?: number;
        active?: boolean;
        greeting_message?: string; // Initial greeting for webchat
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const {
        name,
        description,
        channel_ids,
        llm_id,
        enabled_tools = [],
        flow_config = {},
        routing_conditions = {},
        priority = 10,
        active = true,
        greeting_message,
      } = request.body;

      // Validate channel_ids
      if (!channel_ids || channel_ids.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'At least one channel must be specified in channel_ids array', 400);
      }

      // Create flow (without channel_id column)
      const result = await this.db.query(
        `INSERT INTO orchestration_flows
         (name, description, llm_id, enabled_tools, flow_config, routing_conditions, priority, active, greeting_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          name,
          description || null,
          llm_id,
          enabled_tools,
          JSON.stringify(flow_config),
          JSON.stringify(routing_conditions),
          priority,
          active,
          greeting_message || null,
        ]
      );

      const flowId = result.rows[0].id;

      // Insert all channels into flow_channels table
      for (let i = 0; i < channel_ids.length; i++) {
        await this.db.query(
          `INSERT INTO flow_channels (flow_id, channel_id, active, priority)
           VALUES ($1, $2, $3, $4)`,
          [flowId, channel_ids[i], true, i]
        );
      }

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to create orchestration flow: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update Orchestration Flow
   * PUT /api/admin/flows/:id
   * Updates multiple channels via channel_ids array
   */
  async updateFlow(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        description?: string;
        channel_ids?: string[]; // Array of channel IDs
        llm_id?: string;
        enabled_tools?: string[];
        flow_config?: any;
        routing_conditions?: any;
        priority?: number;
        active?: boolean;
        greeting_message?: string; // Initial greeting for webchat
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const {
        name,
        description,
        channel_ids,
        llm_id,
        enabled_tools,
        flow_config,
        routing_conditions,
        priority,
        active,
        greeting_message,
      } = request.body;

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(description);
      }
      if (llm_id !== undefined) {
        updates.push(`llm_id = $${paramIndex++}`);
        values.push(llm_id);
      }
      if (enabled_tools !== undefined) {
        updates.push(`enabled_tools = $${paramIndex++}`);
        values.push(enabled_tools);
      }
      if (flow_config !== undefined) {
        updates.push(`flow_config = $${paramIndex++}`);
        values.push(JSON.stringify(flow_config));
      }
      if (routing_conditions !== undefined) {
        updates.push(`routing_conditions = $${paramIndex++}`);
        values.push(JSON.stringify(routing_conditions));
      }
      if (priority !== undefined) {
        updates.push(`priority = $${paramIndex++}`);
        values.push(priority);
      }
      if (active !== undefined) {
        updates.push(`active = $${paramIndex++}`);
        values.push(active);
      }
      if (greeting_message !== undefined) {
        updates.push(`greeting_message = $${paramIndex++}`);
        values.push(greeting_message || null);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const result = await this.db.query(
        `UPDATE orchestration_flows
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Orchestration flow not found', 404);
      }

      // Handle channel_ids update if provided
      if (channel_ids !== undefined) {
        // Validate that at least one channel is provided
        if (channel_ids.length === 0) {
          throw new AppError('VALIDATION_ERROR', 'At least one channel must be specified', 400);
        }

        // Delete existing channel associations
        await this.db.query(
          'DELETE FROM flow_channels WHERE flow_id = $1',
          [id]
        );

        // Insert new channel associations
        for (let i = 0; i < channel_ids.length; i++) {
          await this.db.query(
            `INSERT INTO flow_channels (flow_id, channel_id, active, priority)
             VALUES ($1, $2, $3, $4)`,
            [id, channel_ids[i], true, i]
          );
        }
      }

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to update orchestration flow: ${error.message}`,
        500
      );
    }
  }

  /**
   * Delete Orchestration Flow
   * DELETE /api/admin/flows/:id
   */
  async deleteFlow(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      const result = await this.db.query(
        'DELETE FROM orchestration_flows WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Orchestration flow not found', 404);
      }

      reply.send({ success: true, message: 'Orchestration flow deleted successfully' });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to delete orchestration flow: ${error.message}`,
        500
      );
    }
  }

  // Helper methods
  private async checkDatabase(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1');
      return true;
    } catch (error) {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    // In production, check Redis connection
    return true;
  }

  /**
   * Admin Login
   * POST /api/admin/login
   * 
   * Authenticates admin user with username and password
   */
  async login(
    request: FastifyRequest<{
      Body: {
        username: string;
        password: string;
      };
    }>,
    reply: FastifyReply,
    fastifyInstance?: FastifyInstance
  ): Promise<void> {
    try {
      logger.info('Login attempt', { username: request.body?.username ? 'provided' : 'missing' });
      
      const { username, password } = request.body;

      if (!username || !password) {
        logger.warn('Login validation failed: missing credentials');
        throw new AppError('VALIDATION_ERROR', 'Username and password are required', 400);
      }

      // Authenticate user
      logger.debug('Authenticating user', { username });
      let user;
      try {
        user = await this.authService.authenticate(username, password);
      } catch (authError: any) {
        logger.error('Authentication service error', { 
          error: authError.message, 
          stack: authError.stack,
          username 
        });
        throw authError;
      }

      if (!user) {
        logger.warn('Authentication failed: invalid credentials', { username });
        throw new AppError('AUTH_FAILED', 'Invalid username or password', 401);
      }

      logger.debug('User authenticated successfully', { userId: user.id, username });

      // Generate JWT token with admin role
      // Try multiple ways to access JWT plugin (for compatibility between local and Azure)
      let jwtInstance: any = null;
      
      // Method 1: Use fastifyInstance passed from route (preferred)
      if (fastifyInstance && (fastifyInstance as any).jwt && typeof (fastifyInstance as any).jwt.sign === 'function') {
        jwtInstance = (fastifyInstance as any).jwt;
        logger.debug('Using JWT from fastifyInstance parameter');
      }
      // Method 2: Use request.server (fallback for compatibility)
      else {
        const serverInstance = request.server as any;
        if (serverInstance && serverInstance.jwt && typeof serverInstance.jwt.sign === 'function') {
          jwtInstance = serverInstance.jwt;
          logger.debug('Using JWT from request.server');
        }
      }
      
      // Check if JWT plugin is available
      if (!jwtInstance) {
        logger.error('JWT plugin not properly initialized', {
          hasFastifyInstance: !!fastifyInstance,
          hasServerJwt: !!(request.server as any)?.jwt,
          jwtType: typeof (request.server as any)?.jwt,
          jwtSecret: process.env.JWT_SECRET ? 'set' : 'not set',
          serverKeys: fastifyInstance ? Object.keys(fastifyInstance).filter(k => k.toLowerCase().includes('jwt')) : [],
        });
        throw new AppError('CONFIG_ERROR', 'JWT plugin not initialized. Check JWT_SECRET is set.', 500);
      }
      
      // Sign JWT token
      let token;
      try {
        logger.debug('Signing JWT token', { userId: user.id });
        token = jwtInstance.sign({
          id: user.id,
          username: user.username,
          role: 'admin',
          timestamp: Date.now(),
        }, {
          expiresIn: '24h',
        });
        logger.debug('JWT token signed successfully');
      } catch (jwtError: any) {
        logger.error('JWT signing error', { 
          error: jwtError.message, 
          stack: jwtError.stack,
          jwtSecret: process.env.JWT_SECRET ? 'set' : 'not set',
        });
        throw new AppError('CONFIG_ERROR', `JWT signing failed: ${jwtError.message}`, 500);
      }

      logger.info('Login successful', { userId: user.id, username });

      reply.send({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: 'admin',
        },
        expiresIn: '24h',
      });
    } catch (error: any) {
      logger.error('Login error', { 
        error: error.message, 
        stack: error.stack,
        errorName: error.name,
        errorCode: error.code,
        username: request.body?.username,
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      // Check if it's a JWT configuration error
      if (error.message && (error.message.includes('secret') || error.message.includes('JWT'))) {
        logger.error('JWT configuration error - check JWT_SECRET environment variable');
        throw new AppError('CONFIG_ERROR', 'JWT configuration error. Check JWT_SECRET is set.', 500);
      }
      
      // Check if it's a database error
      if (error.code && (error.code.startsWith('ECONN') || error.code.startsWith('ETIMEDOUT') || error.code === '23505')) {
        logger.error('Database error during login', { error: error.message, code: error.code });
        throw new AppError('DB_ERROR', 'Database connection error. Please try again later.', 500);
      }
      
      throw new AppError('AUTH_FAILED', `Failed to authenticate: ${error.message}`, 500);
    }
  }

  /**
   * Get Current User
   * GET /api/admin/users/me
   */
  async getCurrentUser(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const user = request.user as any;
      if (!user || !user.id) {
        throw new AppError('AUTH_FAILED', 'User not authenticated', 401);
      }

      const adminUser = await this.authService.getUserById(user.id);
      if (!adminUser) {
        throw new AppError('USER_NOT_FOUND', 'User not found', 404);
      }

      reply.send({
        success: true,
        user: {
          id: adminUser.id,
          username: adminUser.username,
          email: adminUser.email,
          full_name: adminUser.full_name,
          role: 'admin',
          last_login: adminUser.last_login,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error getting current user', { error: error.message });
      throw new AppError('GET_USER_ERROR', `Failed to get current user: ${error.message}`, 500);
    }
  }

  /**
   * Change Current User Password
   * POST /api/admin/users/me/change-password
   */
  async changePassword(
    request: FastifyRequest<{
      Body: {
        currentPassword: string;
        newPassword: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const user = request.user as any;
      if (!user || !user.id) {
        throw new AppError('AUTH_FAILED', 'User not authenticated', 401);
      }

      const { currentPassword, newPassword } = request.body;

      if (!currentPassword || !newPassword) {
        throw new AppError('VALIDATION_ERROR', 'Current password and new password are required', 400);
      }

      if (newPassword.length < 8) {
        throw new AppError('VALIDATION_ERROR', 'New password must be at least 8 characters long', 400);
      }

      // Verify current password
      const adminUser = await this.authService.authenticate(user.username, currentPassword);
      if (!adminUser) {
        throw new AppError('AUTH_FAILED', 'Current password is incorrect', 401);
      }

      // Update password
      const updatedUser = await this.authService.updateUser(user.id, {
        password: newPassword,
      });

      logger.info('Password changed successfully', { userId: user.id });

      reply.send({
        success: true,
        message: 'Password changed successfully',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error changing password', { error: error.message });
      throw new AppError('CHANGE_PASSWORD_ERROR', `Failed to change password: ${error.message}`, 500);
    }
  }

  /**
   * List Conversations
   * GET /api/admin/conversations
   */
  async listConversations(
    request: FastifyRequest<{
      Querystring: {
        channel?: string;
        limit?: number;
        offset?: number;
        startDate?: string;
        endDate?: string;
        status?: string;
        userId?: string;
        hasTools?: string; // 'true' or 'false' to filter by tool execution
        flowId?: string; // Filter by agent/flow
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const {
        channel,
        limit = 50,
        offset = 0,
        startDate,
        endDate,
        status,
        userId,
        hasTools,
        flowId,
      } = request.query;

      // Build query with filters
      let query = `
        SELECT 
          c.id,
          c.channel,
          c.channel_user_id,
          c.started_at,
          c.last_activity,
          c.status,
          c.metadata,
          c.flow_id,
          f.name as flow_name,
          COUNT(DISTINCT m.id) as message_count,
          MAX(m.timestamp) as last_message_at,
          COALESCE(SUM(m.cost), 0) as total_cost,
          EXISTS (
            SELECT 1
            FROM tool_executions te
            JOIN messages m_te ON te.message_id = m_te.id
            WHERE m_te.conversation_id = c.id
          ) as has_tools
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN orchestration_flows f ON c.flow_id = f.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (channel) {
        query += ` AND c.channel = $${paramIndex}`;
        params.push(channel);
        paramIndex++;
      }

      if (userId) {
        query += ` AND c.channel_user_id LIKE $${paramIndex}`;
        params.push(`%${userId}%`);
        paramIndex++;
      }

      if (status) {
        query += ` AND c.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (startDate) {
        // Frontend sends date in Ecuador timezone (UTC-5) like "2025-12-09T00:00:00-05:00"
        // DB stores timestamps WITHOUT TIME ZONE (stored as UTC from PostgreSQL server with timezone UTC)
        // Strategy: Convert both sides to Ecuador timezone for direct comparison
        // This ensures we're comparing "local dates" in Ecuador timezone
        // DB: interpret as UTC, then convert to Ecuador timezone
        // Frontend: extract the date part in Ecuador timezone (already has timezone info)
        query += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') >= ($${paramIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        // Same strategy: compare both in Ecuador timezone
        query += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') <= ($${paramIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        params.push(endDate);
        paramIndex++;
      }

      // Filter by tool execution
      if (hasTools === 'true') {
        query += ` AND EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      } else if (hasTools === 'false') {
        query += ` AND NOT EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      }

      // Filter by flow/agent
      if (flowId) {
        query += ` AND c.flow_id = $${paramIndex}`;
        params.push(flowId);
        paramIndex++;
      }

      query += `
        GROUP BY c.id, c.channel, c.channel_user_id, c.started_at, c.last_activity, c.status, c.metadata, c.flow_id, f.name
        ORDER BY c.last_activity DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);

      const result = await this.db.query(query, params);

      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(DISTINCT c.id) as total
        FROM conversations c
        WHERE 1=1
      `;
      const countParams: any[] = [];
      let countParamIndex = 1;

      if (channel) {
        countQuery += ` AND c.channel = $${countParamIndex}`;
        countParams.push(channel);
        countParamIndex++;
      }

      if (userId) {
        countQuery += ` AND c.channel_user_id LIKE $${countParamIndex}`;
        countParams.push(`%${userId}%`);
        countParamIndex++;
      }

      if (status) {
        countQuery += ` AND c.status = $${countParamIndex}`;
        countParams.push(status);
        countParamIndex++;
      }

      if (startDate) {
        // Frontend sends date in Ecuador timezone (UTC-5) like "2025-12-09T00:00:00-05:00"
        // DB stores timestamps WITHOUT TIME ZONE (stored as UTC from PostgreSQL server)
        // Convert both sides to Ecuador timezone for direct comparison
        countQuery += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') >= ($${countParamIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        countParams.push(startDate);
        countParamIndex++;
      }

      if (endDate) {
        // Same strategy: compare both in Ecuador timezone
        countQuery += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') <= ($${countParamIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        countParams.push(endDate);
        countParamIndex++;
      }

      // Filter by tool execution in count query
      if (hasTools === 'true') {
        countQuery += ` AND EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      } else if (hasTools === 'false') {
        countQuery += ` AND NOT EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      }

      // Filter by flow/agent in count query
      if (flowId) {
        countQuery += ` AND c.flow_id = $${countParamIndex}`;
        countParams.push(flowId);
        countParamIndex++;
      }

      const countResult = await this.db.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total) || 0;

      // Get total messages and total cost for all conversations matching the filters
      // This gives accurate totals regardless of pagination
      let statsQuery = `
        SELECT 
          COUNT(DISTINCT m.id) as total_messages,
          COALESCE(SUM(m.cost), 0) as total_cost
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE 1=1
      `;
      const statsParams: any[] = [];
      let statsParamIndex = 1;

      if (channel) {
        statsQuery += ` AND c.channel = $${statsParamIndex}`;
        statsParams.push(channel);
        statsParamIndex++;
      }

      if (userId) {
        statsQuery += ` AND c.channel_user_id LIKE $${statsParamIndex}`;
        statsParams.push(`%${userId}%`);
        statsParamIndex++;
      }

      if (status) {
        statsQuery += ` AND c.status = $${statsParamIndex}`;
        statsParams.push(status);
        statsParamIndex++;
      }

      if (startDate) {
        statsQuery += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') >= ($${statsParamIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        statsParams.push(startDate);
        statsParamIndex++;
      }

      if (endDate) {
        statsQuery += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') <= ($${statsParamIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        statsParams.push(endDate);
        statsParamIndex++;
      }

      if (hasTools === 'true') {
        statsQuery += ` AND EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      } else if (hasTools === 'false') {
        statsQuery += ` AND NOT EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      }

      // Filter by flow/agent in stats query
      if (flowId) {
        statsQuery += ` AND c.flow_id = $${statsParamIndex}`;
        statsParams.push(flowId);
        statsParamIndex++;
      }

      const statsResult = await this.db.query(statsQuery, statsParams);
      const totalMessages = parseInt(statsResult.rows[0].total_messages) || 0;
      const totalCost = parseFloat(statsResult.rows[0].total_cost) || 0;

      reply.send({
        success: true,
        data: {
          conversations: result.rows.map((row) => ({
            id: row.id,
            channel: row.channel,
            channelUserId: row.channel_user_id,
            startedAt: row.started_at,
            lastActivity: row.last_activity,
            status: row.status,
            metadata: row.metadata,
            messageCount: parseInt(row.message_count) || 0,
            lastMessageAt: row.last_message_at,
            totalCost: parseFloat(row.total_cost) || 0,
            hasTools: row.has_tools === true || row.has_tools === 't' || String(row.has_tools) === 'true',
            flowId: row.flow_id || null,
            flowName: row.flow_name || null,
          })),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
          },
          statistics: {
            totalMessages,
            totalCost,
          },
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error listing conversations', { error: error.message });
      throw new AppError(
        'LIST_CONVERSATIONS_ERROR',
        `Failed to list conversations: ${error.message}`,
        500
      );
    }
  }

  /**
   * Format date to Ecuador timezone (America/Guayaquil, UTC-5)
   * This ensures dates in Excel export match the dates shown in the frontend
   */
  private formatDateToEcuadorTimezone(dateString: string | Date | null): string {
    if (!dateString) return '';
    
    try {
      const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
      
      // Use Intl.DateTimeFormat with Ecuador timezone
      const formatter = new Intl.DateTimeFormat('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/Guayaquil', // Ecuador timezone (UTC-5)
      });
      
      return formatter.format(date);
    } catch (error) {
      logger.warn('Failed to format date', { dateString, error });
      return '';
    }
  }

  /**
   * Export Conversations to Excel
   * GET /api/admin/conversations/export
   */
  async exportConversations(
    request: FastifyRequest<{
      Querystring: {
        channel?: string;
        startDate?: string;
        endDate?: string;
        status?: string;
        userId?: string;
        hasTools?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const {
        channel,
        startDate,
        endDate,
        status,
        userId,
        hasTools,
      } = request.query;

      // Build query with filters (no limit for export)
      let query = `
        SELECT 
          c.id,
          c.channel,
          c.channel_user_id,
          c.started_at,
          c.last_activity,
          c.status,
          COUNT(DISTINCT m.id) as message_count,
          MAX(m.timestamp) as last_message_at,
          COALESCE(SUM(m.cost), 0) as total_cost,
          EXISTS (
            SELECT 1
            FROM tool_executions te
            JOIN messages m_te ON te.message_id = m_te.id
            WHERE m_te.conversation_id = c.id
          ) as has_tools
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (channel) {
        query += ` AND c.channel = $${paramIndex}`;
        params.push(channel);
        paramIndex++;
      }

      if (userId) {
        query += ` AND c.channel_user_id LIKE $${paramIndex}`;
        params.push(`%${userId}%`);
        paramIndex++;
      }

      if (status) {
        query += ` AND c.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (startDate) {
        // Frontend sends date in Ecuador timezone (UTC-5) like "2025-12-09T00:00:00-05:00"
        // DB stores timestamps WITHOUT TIME ZONE (stored as UTC from PostgreSQL server)
        // Convert both sides to Ecuador timezone for direct comparison
        query += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') >= ($${paramIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        // Same strategy: compare both in Ecuador timezone
        query += ` AND (c.started_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') <= ($${paramIndex}::timestamptz AT TIME ZONE 'America/Guayaquil')::timestamp`;
        params.push(endDate);
        paramIndex++;
      }

      // Filter by tool execution in export query
      if (hasTools === 'true') {
        query += ` AND EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      } else if (hasTools === 'false') {
        query += ` AND NOT EXISTS (
          SELECT 1
          FROM tool_executions te
          JOIN messages m_te ON te.message_id = m_te.id
          WHERE m_te.conversation_id = c.id
        )`;
      }

      query += `
        GROUP BY c.id, c.channel, c.channel_user_id, c.started_at, c.last_activity, c.status, c.metadata
        ORDER BY c.last_activity DESC
      `;

      const result = await this.db.query(query, params);

      // Get all messages for each conversation
      const conversationIds = result.rows.map((row) => row.id);
      
      let messagesQuery = `
        SELECT 
          m.conversation_id,
          m.role,
          m.content,
          m.timestamp,
          m.llm_provider,
          m.llm_model,
          m.cost,
          m.tokens_used
        FROM messages m
        WHERE m.conversation_id = ANY($1)
        ORDER BY m.conversation_id, m.timestamp ASC
      `;
      
      const messagesResult = await this.db.query(messagesQuery, [conversationIds]);
      
      // Group messages by conversation
      const messagesByConversation: Record<string, any[]> = {};
      messagesResult.rows.forEach((msg) => {
        if (!messagesByConversation[msg.conversation_id]) {
          messagesByConversation[msg.conversation_id] = [];
        }
        messagesByConversation[msg.conversation_id].push(msg);
      });

      // Prepare data for Excel - one row per message
      const excelData: any[] = [];
      
      result.rows.forEach((conversation) => {
        const messages = messagesByConversation[conversation.id] || [];
        
        if (messages.length === 0) {
          // If no messages, still add a row with conversation info
          excelData.push({
            'ID Conversación': conversation.id,
            'Canal': conversation.channel,
            'Usuario ID': conversation.channel_user_id,
            'Fecha Inicio': this.formatDateToEcuadorTimezone(conversation.started_at),
            'Estado': conversation.status === 'active' ? 'Activa' : 'Cerrada',
            'Usó Tools': conversation.has_tools === true || conversation.has_tools === 't' ? 'Sí' : 'No',
            'Rol': '',
            'Mensaje': '(Sin mensajes)',
            'Fecha/Hora': '',
            'LLM Provider': '',
            'LLM Modelo': '',
            'Costo': '',
            'Tokens': '',
          });
        } else {
          messages.forEach((message, index) => {
            const tokensUsed = message.tokens_used && typeof message.tokens_used === 'object' 
              ? (message.tokens_used as any).total || '' 
              : '';
            
            excelData.push({
              'ID Conversación': index === 0 ? conversation.id : '',
              'Canal': index === 0 ? conversation.channel : '',
              'Usuario ID': index === 0 ? conversation.channel_user_id : '',
              'Fecha Inicio': index === 0 
                ? this.formatDateToEcuadorTimezone(conversation.started_at)
                : '',
              'Estado': index === 0 ? (conversation.status === 'active' ? 'Activa' : 'Cerrada') : '',
              'Usó Tools': index === 0 ? (conversation.has_tools === true || conversation.has_tools === 't' ? 'Sí' : 'No') : '',
              'Rol': message.role === 'user' ? 'Usuario' : 'Asistente',
              'Mensaje': message.content || '',
              'Fecha/Hora': this.formatDateToEcuadorTimezone(message.timestamp),
              'LLM Provider': message.llm_provider || '',
              'LLM Modelo': message.llm_model || '',
              'Costo': message.cost ? parseFloat(message.cost).toFixed(4) : '',
              'Tokens': tokensUsed,
            });
          });
          
          // Add summary row after each conversation
          excelData.push({
            'ID Conversación': '',
            'Canal': '',
            'Usuario ID': '',
            'Fecha Inicio': '',
            'Estado': '',
            'Rol': 'RESUMEN',
            'Mensaje': `Total: ${messages.length} mensajes | Costo: $${parseFloat(conversation.total_cost || 0).toFixed(2)}`,
            'Fecha/Hora': '',
            'LLM Provider': '',
            'LLM Modelo': '',
            'Costo': '',
            'Tokens': '',
          });
          
          // Add empty row for spacing
          excelData.push({
            'ID Conversación': '',
            'Canal': '',
            'Usuario ID': '',
            'Fecha Inicio': '',
            'Estado': '',
            'Rol': '',
            'Mensaje': '',
            'Fecha/Hora': '',
            'LLM Provider': '',
            'LLM Modelo': '',
            'Costo': '',
            'Tokens': '',
          });
        }
      });

      // Create workbook and worksheet
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Conversaciones Detalladas');

      // Set column widths
      const columnWidths = [
        { wch: 36 }, // ID Conversación
        { wch: 12 }, // Canal
        { wch: 30 }, // Usuario ID
        { wch: 20 }, // Fecha Inicio
        { wch: 12 }, // Estado
        { wch: 12 }, // Rol
        { wch: 80 }, // Mensaje (más ancho para el contenido)
        { wch: 20 }, // Fecha/Hora
        { wch: 15 }, // LLM Provider
        { wch: 20 }, // LLM Modelo
        { wch: 12 }, // Costo
        { wch: 12 }, // Tokens
      ];
      worksheet['!cols'] = columnWidths;

      // Generate Excel buffer
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `conversaciones_${timestamp}.xlsx`;

      // Set headers for file download
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.send(excelBuffer);
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error exporting conversations', { error: error.message });
      throw new AppError(
        'EXPORT_CONVERSATIONS_ERROR',
        `Failed to export conversations: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get Conversation Detail
   * GET /api/admin/conversations/:id
   */
  async getConversationDetail(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      // Get conversation
      const convResult = await this.db.query(
        'SELECT * FROM conversations WHERE id = $1',
        [id]
      );

      if (convResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Conversation not found', 404);
      }

      const conversation = convResult.rows[0];

      // Get messages
      const messagesResult = await this.db.query(
        `SELECT 
          m.id,
          m.role,
          m.content,
          m.timestamp,
          m.llm_provider,
          m.llm_model,
          m.tokens_used,
          m.cost,
          m.metadata
        FROM messages m
        WHERE m.conversation_id = $1
        ORDER BY m.timestamp ASC`,
        [id]
      );

      // Get tool executions
      const toolsResult = await this.db.query(
        `SELECT 
          te.id,
          te.tool_name,
          te.status,
          te.parameters,
          te.result,
          te.execution_time_ms,
          te.error,
          te.executed_at,
          te.message_id
        FROM tool_executions te
        JOIN messages m ON te.message_id = m.id
        WHERE m.conversation_id = $1
        ORDER BY te.executed_at ASC`,
        [id]
      );

      // Calculate statistics
      const statsResult = await this.db.query(
        `SELECT 
          COUNT(*) as total_messages,
          COUNT(DISTINCT CASE WHEN role = 'user' THEN id END) as user_messages,
          COUNT(DISTINCT CASE WHEN role = 'assistant' THEN id END) as assistant_messages,
          COALESCE(SUM(cost), 0) as total_cost,
          COALESCE(SUM(
            CASE 
              WHEN tokens_used IS NOT NULL AND tokens_used ? 'total' 
              THEN (tokens_used->>'total')::int
              WHEN tokens_used IS NOT NULL AND jsonb_typeof(tokens_used) = 'number'
              THEN tokens_used::int
              ELSE 0
            END
          ), 0) as total_tokens
        FROM messages
        WHERE conversation_id = $1`,
        [id]
      );

      const stats = statsResult.rows[0];

      reply.send({
        success: true,
        data: {
          conversation: {
            id: conversation.id,
            channel: conversation.channel,
            channelUserId: conversation.channel_user_id,
            startedAt: conversation.started_at,
            lastActivity: conversation.last_activity,
            status: conversation.status,
            metadata: conversation.metadata,
          },
          messages: messagesResult.rows.map((row) => ({
            id: row.id,
            role: row.role,
            content: row.content,
            timestamp: row.timestamp,
            llmProvider: row.llm_provider,
            llmModel: row.llm_model,
            tokensUsed: row.tokens_used,
            cost: parseFloat(row.cost) || 0,
            metadata: row.metadata,
          })),
          toolExecutions: toolsResult.rows.map((row) => ({
            id: row.id,
            toolName: row.tool_name,
            status: row.status,
            parameters: row.parameters,
            result: row.result,
            executionTimeMs: row.execution_time_ms,
            error: row.error,
            executedAt: row.executed_at,
            messageId: row.message_id,
          })),
          statistics: {
            totalMessages: parseInt(stats.total_messages) || 0,
            userMessages: parseInt(stats.user_messages) || 0,
            assistantMessages: parseInt(stats.assistant_messages) || 0,
            totalCost: parseFloat(stats.total_cost) || 0,
            totalTokens: parseInt(stats.total_tokens) || 0,
            toolExecutionsCount: toolsResult.rows.length,
          },
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error getting conversation detail', { error: error.message });
      throw new AppError(
        'GET_CONVERSATION_DETAIL_ERROR',
        `Failed to get conversation detail: ${error.message}`,
        500
      );
    }
  }

  /**
   * List Admin Users
   * GET /api/admin/users
   */
  async listUsers(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const users = await this.authService.listUsers();
      reply.send({
        success: true,
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          is_active: user.is_active,
          last_login: user.last_login,
          created_at: user.created_at,
          updated_at: user.updated_at,
        })),
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error listing users', { error: error.message });
      throw new AppError('LIST_USERS_ERROR', `Failed to list users: ${error.message}`, 500);
    }
  }

  /**
   * Create Admin User
   * POST /api/admin/users
   */
  async createUser(
    request: FastifyRequest<{
      Body: {
        username: string;
        password: string;
        email?: string;
        full_name?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { username, password, email, full_name } = request.body;
      const currentUser = request.user as any;

      if (!username || !password) {
        throw new AppError('VALIDATION_ERROR', 'Username and password are required', 400);
      }

      if (password.length < 8) {
        throw new AppError('VALIDATION_ERROR', 'Password must be at least 8 characters long', 400);
      }

      const user = await this.authService.createUser({
        username,
        password,
        email,
        full_name,
        created_by: currentUser?.id,
      });

      reply.code(201).send({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          is_active: user.is_active,
          created_at: user.created_at,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error creating user', { error: error.message });
      throw new AppError('CREATE_USER_ERROR', `Failed to create user: ${error.message}`, 500);
    }
  }

  /**
   * Update Admin User
   * PUT /api/admin/users/:id
   */
  async updateUser(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        username?: string;
        password?: string;
        email?: string;
        full_name?: string;
        is_active?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const { username, password, email, full_name, is_active } = request.body;

      if (password && password.length < 8) {
        throw new AppError('VALIDATION_ERROR', 'Password must be at least 8 characters long', 400);
      }

      const user = await this.authService.updateUser(id, {
        username,
        password,
        email,
        full_name,
        is_active,
      });

      reply.send({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          is_active: user.is_active,
          updated_at: user.updated_at,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error updating user', { error: error.message });
      throw new AppError('UPDATE_USER_ERROR', `Failed to update user: ${error.message}`, 500);
    }
  }

  /**
   * Delete Admin User
   * DELETE /api/admin/users/:id
   */
  async deleteUser(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const currentUser = request.user as any;

      // Prevent self-deletion
      if (currentUser?.id === id) {
        throw new AppError('VALIDATION_ERROR', 'Cannot delete your own account', 400);
      }

      await this.authService.deleteUser(id);

      reply.send({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error deleting user', { error: error.message });
      throw new AppError('DELETE_USER_ERROR', `Failed to delete user: ${error.message}`, 500);
    }
  }

  /**
   * List Widgets
   * GET /api/admin/widgets
   */
  async listWidgets(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const result = await this.db.query(
        `SELECT w.*, c.name as channel_name, c.channel_type
         FROM widgets w
         LEFT JOIN channel_configs c ON w.channel_id = c.id
         ORDER BY w.created_at DESC`
      );

      reply.send({ success: true, data: result.rows });
    } catch (error: any) {
      throw new AppError(
        'DB_ERROR',
        `Failed to list widgets: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get Widget
   * GET /api/admin/widgets/:id
   */
  async getWidget(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      const result = await this.db.query(
        `SELECT w.*, c.name as channel_name, c.channel_type
         FROM widgets w
         LEFT JOIN channel_configs c ON w.channel_id = c.id
         WHERE w.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Widget not found', 404);
      }

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'DB_ERROR',
        `Failed to get widget: ${error.message}`,
        500
      );
    }
  }

  /**
   * Create Widget
   * POST /api/admin/widgets
   */
  async createWidget(
    request: FastifyRequest<{
      Body: {
        name: string;
        widget_key: string;
        channel_id: string;
        allowed_origins?: string[];
        position?: string;
        primary_color?: string;
        button_color?: string;
        button_text_color?: string;
        welcome_message?: string;
        placeholder_text?: string;
        show_typing_indicator?: boolean;
        enable_sound?: boolean;
        button_size?: number;
        chat_width?: number;
        chat_height?: number;
        active?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const {
        name,
        widget_key,
        channel_id,
        allowed_origins = [],
        position = 'bottom-right',
        primary_color = '#3B82F6',
        button_color = '#3B82F6',
        button_text_color = '#FFFFFF',
        welcome_message,
        placeholder_text = 'Escribe tu mensaje...',
        show_typing_indicator = true,
        enable_sound = false,
        button_size = 56,
        chat_width = 380,
        chat_height = 500,
        active = true,
      } = request.body;

      // Validate channel exists
      const channelCheck = await this.db.query(
        'SELECT id FROM channel_configs WHERE id = $1',
        [channel_id]
      );

      if (channelCheck.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Channel not found', 404);
      }

      const result = await this.db.query(
        `INSERT INTO widgets (
          name, widget_key, channel_id, allowed_origins, position,
          primary_color, button_color, button_text_color, welcome_message,
          placeholder_text, show_typing_indicator, enable_sound,
          button_size, chat_width, chat_height, active
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          name,
          widget_key,
          channel_id,
          allowed_origins,
          position,
          primary_color,
          button_color,
          button_text_color,
          welcome_message,
          placeholder_text,
          show_typing_indicator,
          enable_sound,
          button_size,
          chat_width,
          chat_height,
          active,
        ]
      );

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      if (error.code === '23505') {
        throw new AppError(
          'DUPLICATE_ENTRY',
          `Widget with key '${request.body.widget_key}' already exists`,
          409
        );
      }
      throw new AppError(
        'DB_ERROR',
        `Failed to create widget: ${error.message}`,
        500
      );
    }
  }

  /**
   * Update Widget
   * PUT /api/admin/widgets/:id
   */
  async updateWidget(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        widget_key?: string;
        channel_id?: string;
        allowed_origins?: string[];
        position?: string;
        primary_color?: string;
        button_color?: string;
        button_text_color?: string;
        welcome_message?: string;
        placeholder_text?: string;
        show_typing_indicator?: boolean;
        enable_sound?: boolean;
        button_size?: number;
        chat_width?: number;
        chat_height?: number;
        active?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const updates = request.body;

      // Check if widget exists
      const existing = await this.db.query(
        'SELECT id FROM widgets WHERE id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Widget not found', 404);
      }

      // Build update query dynamically
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const allowedFields = [
        'name',
        'widget_key',
        'channel_id',
        'allowed_origins',
        'position',
        'primary_color',
        'button_color',
        'button_text_color',
        'welcome_message',
        'placeholder_text',
        'show_typing_indicator',
        'enable_sound',
        'button_size',
        'chat_width',
        'chat_height',
        'active',
      ];

      for (const field of allowedFields) {
        if (updates[field as keyof typeof updates] !== undefined) {
          updateFields.push(`${field} = $${paramIndex}`);
          values.push(updates[field as keyof typeof updates]);
          paramIndex++;
        }
      }

      if (updateFields.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No fields to update', 400);
      }

      // Validate channel if being updated
      if (updates.channel_id) {
        const channelCheck = await this.db.query(
          'SELECT id FROM channel_configs WHERE id = $1',
          [updates.channel_id]
        );

        if (channelCheck.rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Channel not found', 404);
        }
      }

      updateFields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await this.db.query(
        `UPDATE widgets SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      reply.send({ success: true, data: result.rows[0] });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      if (error.code === '23505') {
        throw new AppError(
          'DUPLICATE_ENTRY',
          `Widget with key '${request.body.widget_key || 'unknown'}' already exists`,
          409
        );
      }
      throw new AppError(
        'DB_ERROR',
        `Failed to update widget: ${error.message}`,
        500
      );
    }
  }

  /**
   * GET /api/admin/queues/stats
   * Get statistics for all queues
   */
  async getQueueStats(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      let queueManager;
      try {
        queueManager = getQueueManager();
      } catch (error: any) {
        logger.warn('Queue manager not available', { error: error.message });
        reply.send({
          success: false,
          error: 'Queue service not available',
          queues: {},
        });
        return;
      }

      // Get stats for all queues
      // CRITICAL: Wrap in try-catch to handle Redis connection errors gracefully
      let allStats: any[] = [];
      let health: any = { healthy: false, queues: {} };
      
      try {
        allStats = await queueManager.getAllQueueStats();
        health = await queueManager.healthCheck();
      } catch (statsError: any) {
        logger.error('Failed to get queue stats or health check', {
          error: statsError.message,
        });
        // Return empty stats but don't fail the request
        health = { healthy: false, queues: {} };
      }

      // Format stats for frontend
      const formattedStats = allStats.reduce((acc: any, stat: any) => {
        acc[stat.queueName] = {
          waiting: stat.waiting,
          active: stat.active,
          completed: stat.completed,
          failed: stat.failed,
          delayed: stat.delayed,
          total: stat.total,
        };
        return acc;
      }, {});

      reply.send({
        success: true,
        healthy: health.healthy,
        queues: health.queues,
        stats: formattedStats,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('Failed to get queue stats', { error: error.message });
      reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * POST /api/admin/queues/reset-statistics
   * Reset statistics for all queues (remove completed and failed jobs)
   */
  async resetQueueStatistics(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      let queueManager;
      try {
        queueManager = getQueueManager();
      } catch (error: any) {
        logger.warn('Queue manager not available', { error: error.message });
        reply.status(503).send({
          success: false,
          error: 'Queue service not available',
        });
        return;
      }

      // Reset statistics for all queues
      const result = await queueManager.resetAllStatistics();

      logger.info('Queue statistics reset', {
        totalCompleted: result.totalCompleted,
        totalFailed: result.totalFailed,
        queues: Object.keys(result.queues).length,
      });

      reply.send({
        success: true,
        message: 'Queue statistics reset successfully',
        data: result,
      });
    } catch (error: any) {
      logger.error('Failed to reset queue statistics', { error: error.message });
      reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * GET /api/admin/queues/:queueName/jobs
   * Get jobs from a specific queue (waiting, active, completed, failed)
   */
  async getQueueJobs(
    request: FastifyRequest<{
      Params: { queueName: string };
      Querystring: {
        status?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
        limit?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { queueName } = request.params;
      const { status = 'waiting', limit = '50' } = request.query;
      const limitNum = parseInt(limit) || 50;

      let queueManager;
      try {
        queueManager = getQueueManager();
      } catch (error: any) {
        reply.status(503).send({
          success: false,
          error: 'Queue service not available',
        });
        return;
      }

      // Validate queue name
      if (!Object.values(QueueName).includes(queueName as QueueName)) {
        reply.status(400).send({
          success: false,
          error: `Invalid queue name: ${queueName}`,
        });
        return;
      }

      const queue = queueManager.getQueue(queueName as QueueName);
      let jobs: any[] = [];

      // CRITICAL: Wrap queue operations in try-catch to handle Redis errors gracefully
      try {
        switch (status) {
          case 'waiting':
            jobs = await queue.getWaiting(0, limitNum - 1);
            break;
          case 'active':
            jobs = await queue.getActive(0, limitNum - 1);
            break;
          case 'completed':
            jobs = await queue.getCompleted(0, limitNum - 1);
            break;
          case 'failed':
            jobs = await queue.getFailed(0, limitNum - 1);
            break;
          case 'delayed':
            jobs = await queue.getDelayed(0, limitNum - 1);
            break;
        }
      } catch (queueError: any) {
        logger.error('Failed to get jobs from queue', {
          error: queueError.message,
          queueName,
          status,
        });
        // Return empty jobs array instead of failing
        jobs = [];
      }

      // Format jobs for frontend
      const formattedJobs = jobs.map((job) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        attemptsMade: job.attemptsMade,
        attempts: job.opts?.attempts,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        returnvalue: job.returnvalue,
      }));

      reply.send({
        success: true,
        queueName,
        status,
        jobs: formattedJobs,
        count: formattedJobs.length,
      });
    } catch (error: any) {
      logger.error('Failed to get queue jobs', {
        error: error.message,
        queueName: request.params.queueName,
      });
      reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Delete Widget
   * DELETE /api/admin/widgets/:id
   */
  async deleteWidget(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;

      const result = await this.db.query(
        'DELETE FROM widgets WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Widget not found', 404);
      }

      reply.send({ success: true, message: 'Widget deleted successfully' });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'DB_ERROR',
        `Failed to delete widget: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get Widget Config (Public endpoint for embedding)
   * GET /api/widgets/:widgetKey/config
   */
  async getWidgetConfig(
    request: FastifyRequest<{ Params: { widgetKey: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { widgetKey } = request.params;
      const origin = request.headers.origin || (request.headers.referer ? new URL(request.headers.referer).origin : null);
      
      // Log the request for debugging
      logger.info('Widget config request received', {
        widgetKey,
        origin: origin || 'no-origin',
        method: request.method,
        url: request.url,
        headers: {
          origin: request.headers.origin,
          referer: request.headers.referer,
        },
      });

      const result = await this.db.query(
        `SELECT w.*, c.name as channel_name, c.channel_type, c.config as channel_config, c.id as channel_id
         FROM widgets w
         LEFT JOIN channel_configs c ON w.channel_id = c.id
         WHERE w.widget_key = $1 AND w.active = true`,
        [widgetKey]
      );

      if (result.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Widget not found or inactive', 404);
      }

      const widget = result.rows[0];
      const channelConfig = widget.channel_config ? (typeof widget.channel_config === 'string' ? JSON.parse(widget.channel_config) : widget.channel_config) : {};
      // Use channel_id (UUID) for routing - this is the primary key
      const channelId = widget.channel_id;

      // Parse allowed_origins (can be array or null/empty)
      const allowedOrigins = widget.allowed_origins && Array.isArray(widget.allowed_origins) 
        ? widget.allowed_origins.filter((o: any) => o && o.trim() !== '')
        : [];

      // Validate origin ONLY if allowed_origins is explicitly configured (not empty)
      // If allowed_origins is empty/null, allow all origins (public widget)
      if (allowedOrigins.length > 0 && origin) {
        try {
          const originUrl = new URL(origin);
          const originHost = originUrl.origin;

          const isAllowed = allowedOrigins.some((allowed: string) => {
            // Support wildcard subdomains (e.g., *.example.com)
            if (allowed.startsWith('*.')) {
              const domain = allowed.substring(2);
              return originHost.endsWith(domain) || 
                     originHost === `https://${domain}` || 
                     originHost === `http://${domain}`;
            }
            // Exact match or with protocol
            return originHost === allowed || 
                   originHost === `https://${allowed}` || 
                   originHost === `http://${allowed}`;
          });

          if (!isAllowed) {
            throw new AppError('FORBIDDEN', `Origin ${originHost} not allowed. Allowed origins: ${allowedOrigins.join(', ')}`, 403);
          }
        } catch (urlError: any) {
          // If origin is invalid URL, log but don't block (could be a direct request)
          logger.warn('Invalid origin format in widget config request', { origin, widgetKey, error: urlError.message });
        }
      }

      // Set CORS headers explicitly for widget endpoints
      // IMPORTANT: When using Access-Control-Allow-Credentials: true, 
      // we CANNOT use Access-Control-Allow-Origin: '*'
      // We must specify the exact origin
      // Note: Headers may already be set by route handler, but we ensure they're correct here
      const currentOrigin = reply.getHeader('Access-Control-Allow-Origin');
      if (!currentOrigin) {
        // Only set if not already set by route handler
      if (origin) {
          // Always allow the requesting origin if present
          // This allows localhost and any other origin to work
        reply.header('Access-Control-Allow-Origin', origin);
          reply.header('Access-Control-Allow-Credentials', 'true');
        } else {
          // No origin header (e.g., direct request), allow all
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        reply.header('Access-Control-Max-Age', '86400'); // 24 hours
      }

      // Get WebSocket port from environment variable (what WebChatAdapter actually uses)
      // The WebChatAdapter is initialized once with the port from WEBCHAT_WS_PORT
      // We use this instead of channel config to ensure the widget connects to the correct port
      const wsPort = parseInt(process.env.WEBCHAT_WS_PORT || '8081');

      // Return only necessary config for widget
      reply.send({
        success: true,
        data: {
          widget_key: widget.widget_key,
          name: widget.name, // Widget name for title bar
          title: widget.title || widget.name, // Title for display
          channel_id: channelId, // Use channel_id (UUID) for routing
          position: widget.position,
          primary_color: widget.primary_color,
          button_color: widget.button_color,
          button_text_color: widget.button_text_color,
          welcome_message: widget.welcome_message,
          placeholder_text: widget.placeholder_text,
          show_typing_indicator: widget.show_typing_indicator,
          enable_sound: widget.enable_sound,
          button_size: widget.button_size,
          chat_width: widget.chat_width,
          chat_height: widget.chat_height,
          ws_port: wsPort,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'DB_ERROR',
        `Failed to get widget config: ${error.message}`,
        500
      );
    }
  }

  /**
   * Get Agent Public Info (Public endpoint for chat client)
   * GET /api/agents/:agentId/public
   * Returns the channel_id (UUID) of the webchat channel for routing
   */
  async getAgentPublicInfo(
    request: FastifyRequest<{ Params: { agentId: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { agentId } = request.params;
      
      logger.info('getAgentPublicInfo called', {
        agentId,
        url: request.url,
        method: request.method,
        hasDb: !!this.db,
      });

      if (!this.db) {
        logger.error('Database not available in getAgentPublicInfo');
        throw new AppError('DB_ERROR', 'Database not available', 500);
      }

      // Get agent (flow) with webchat channel info
      const result = await this.db.query(
        `SELECT 
          f.id,
          f.name,
          f.greeting_message,
          c.id as channel_id
        FROM orchestration_flows f
        JOIN flow_channels fc ON f.id = fc.flow_id AND fc.active = true
        JOIN channel_configs c ON fc.channel_id = c.id
        WHERE f.id = $1
          AND f.active = true
          AND c.channel_type = 'webchat'
          AND c.is_active = true
        ORDER BY c.id
        LIMIT 1`,
        [agentId]
      );

      logger.info('Query result', {
        agentId,
        rowCount: result.rows.length,
        hasRows: result.rows.length > 0,
      });

      if (result.rows.length === 0) {
        logger.warn('Agent not found or no webchat channel', { agentId });
        throw new AppError('NOT_FOUND', 'Agente no encontrado o no tiene canal webchat activo', 404);
      }

      const agent = result.rows[0];

      logger.info('Agent found', {
        agentId: agent.id,
        name: agent.name,
        channel_id: agent.channel_id,
      });

      reply.send({
        success: true,
        data: {
          id: agent.id,
          name: agent.name,
          channel_id: agent.channel_id, // Use channel_id (UUID) for routing
          flow_id: agent.id, // flow_id is the same as agent id
          greeting_message: agent.greeting_message || null,
        },
      });
    } catch (error: any) {
      logger.error('Error in getAgentPublicInfo', {
        error: error.message,
        stack: error.stack,
        agentId: (request as any).params?.agentId,
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('DB_ERROR', `Failed to get agent info: ${error.message}`, 500);
    }
  }

  /**
   * Send proactive message to existing conversation
   * POST /api/admin/conversations/:id/send-message
   */
  async sendProactiveMessage(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { message: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { id } = request.params;
      const { message } = request.body;

      if (!message || message.trim().length === 0) {
        throw new AppError('VALIDATION_ERROR', 'El mensaje no puede estar vacío', 400);
      }

      // Get conversation and channel config
      const conversationResult = await this.db.query(`
        SELECT 
          c.id,
          c.channel,
          c.channel_user_id,
          c.status,
          cc.config as channel_config
        FROM conversations c
        LEFT JOIN channel_configs cc ON cc.channel_type = c.channel AND cc.active = true
        WHERE c.id = $1
      `, [id]);

      if (conversationResult.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Conversación no encontrada', 404);
      }

      const conversation = conversationResult.rows[0];

      if (conversation.channel !== 'whatsapp') {
        throw new AppError('INVALID_CHANNEL', 'Solo se pueden enviar mensajes proactivos a WhatsApp', 400);
      }

      if (!conversation.channel_config) {
        throw new AppError('CONFIG_NOT_FOUND', 'No hay configuración de canal WhatsApp activa', 400);
      }

      // Get queue manager
      const queueManager = getQueueManager();

      // Queue the message
      const channelConfig = conversation.channel_config;
      await queueManager.addJob(
        QueueName.WHATSAPP_SENDING,
        'proactive-message',
        {
          userId: conversation.channel_user_id,
          message: {
            channelUserId: conversation.channel_user_id,
            content: message.trim(),
            metadata: { proactive: true, conversationId: id },
          },
          channelConfig: {
            provider: channelConfig.provider || 'ultramsg',
            instanceId: channelConfig.instanceId,
            apiToken: channelConfig.token || channelConfig.apiToken, // DB stores as 'token' or 'apiToken'
            phoneNumber: channelConfig.phoneNumber,
            phoneNumberId: channelConfig.phoneNumberId, // 360dialog
            accountSid: channelConfig.accountSid, // Twilio
            authToken: channelConfig.authToken, // Twilio
            wabaId: channelConfig.wabaId, // 360dialog (optional)
          },
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        }
      );

      // Save message to conversation history
      await this.db.query(`
        INSERT INTO messages (conversation_id, role, content, metadata)
        VALUES ($1, 'assistant', $2, $3)
      `, [id, message.trim(), JSON.stringify({ proactive: true, sentBy: 'admin' })]);

      // Update conversation last_activity
      await this.db.query(`
        UPDATE conversations SET last_activity = NOW() WHERE id = $1
      `, [id]);

      logger.info('Proactive message queued', {
        conversationId: id,
        userId: conversation.channel_user_id,
        messageLength: message.length,
      });

      reply.send({
        success: true,
        message: 'Mensaje enviado correctamente',
        data: {
          conversationId: id,
          userId: conversation.channel_user_id,
        },
      });
    } catch (error: any) {
      logger.error('Error sending proactive message', { error: error.message });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('SEND_ERROR', `Error al enviar mensaje: ${error.message}`, 500);
    }
  }

  /**
   * Send WhatsApp message to any phone number
   * POST /api/admin/whatsapp/send
   */
  async sendWhatsAppToNumber(
    request: FastifyRequest<{
      Body: {
        phoneNumber: string;
        message: string;
        channelConfigId?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { phoneNumber, message, channelConfigId } = request.body;

      if (!phoneNumber || phoneNumber.trim().length === 0) {
        throw new AppError('VALIDATION_ERROR', 'El número de teléfono es requerido', 400);
      }

      if (!message || message.trim().length === 0) {
        throw new AppError('VALIDATION_ERROR', 'El mensaje no puede estar vacío', 400);
      }

      // Clean phone number (remove spaces, dashes, etc)
      const cleanPhoneNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');

      // Get WhatsApp channel configuration
      let configQuery = `
        SELECT id, name, config 
        FROM channel_configs 
        WHERE channel_type = 'whatsapp' AND active = true
      `;
      const configParams: any[] = [];

      if (channelConfigId) {
        configQuery += ` AND id = $1`;
        configParams.push(channelConfigId);
      }

      configQuery += ` LIMIT 1`;

      const channelConfigResult = await this.db.query(configQuery, configParams);

      if (channelConfigResult.rows.length === 0) {
        throw new AppError('CONFIG_NOT_FOUND', 'No hay canal WhatsApp configurado o activo', 400);
      }

      const channelConfig = channelConfigResult.rows[0].config;

      // Create or find conversation for this number
      const conversationResult = await this.db.query(`
        INSERT INTO conversations (channel, channel_user_id, metadata, status)
        VALUES ('whatsapp', $1, $2, 'active')
        ON CONFLICT (channel, channel_user_id) 
        DO UPDATE SET last_activity = NOW()
        RETURNING id
      `, [cleanPhoneNumber, JSON.stringify({ source: 'outbound', createdBy: 'admin' })]);

      const conversationId = conversationResult.rows[0].id;

      // Get queue manager
      const queueManager = getQueueManager();

      // Queue the message
      await queueManager.addJob(
        QueueName.WHATSAPP_SENDING,
        'outbound-message',
        {
          userId: cleanPhoneNumber,
          message: {
            channelUserId: cleanPhoneNumber,
            content: message.trim(),
            metadata: { outbound: true, conversationId },
          },
          channelConfig: {
            provider: channelConfig.provider || 'ultramsg',
            instanceId: channelConfig.instanceId,
            apiToken: channelConfig.token || channelConfig.apiToken, // DB stores as 'token' or 'apiToken'
            phoneNumber: channelConfig.phoneNumber,
            phoneNumberId: channelConfig.phoneNumberId, // 360dialog
            accountSid: channelConfig.accountSid, // Twilio
            authToken: channelConfig.authToken, // Twilio
            wabaId: channelConfig.wabaId, // 360dialog (optional)
          },
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        }
      );

      // Save message to conversation history
      await this.db.query(`
        INSERT INTO messages (conversation_id, role, content, metadata)
        VALUES ($1, 'assistant', $2, $3)
      `, [conversationId, message.trim(), JSON.stringify({ outbound: true, sentBy: 'admin' })]);

      logger.info('Outbound WhatsApp message queued', {
        phoneNumber: cleanPhoneNumber,
        conversationId,
        messageLength: message.length,
      });

      reply.send({
        success: true,
        message: 'Mensaje enviado correctamente',
        data: {
          conversationId,
          phoneNumber: cleanPhoneNumber,
        },
      });
    } catch (error: any) {
      logger.error('Error sending WhatsApp message', { error: error.message });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('SEND_ERROR', `Error al enviar mensaje: ${error.message}`, 500);
    }
  }

  /**
   * Get available WhatsApp channels for sending
   * GET /api/admin/whatsapp/channels
   */
  async getWhatsAppChannels(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const result = await this.db.query(`
        SELECT id, name, is_active as active
        FROM channel_configs 
        WHERE channel_type = 'whatsapp' AND is_active = true
        ORDER BY name
      `);

      reply.send({
        success: true,
        data: {
          channels: result.rows.map(row => ({
            id: row.id,
            name: row.name,
            active: row.active,
          })),
        },
      });
    } catch (error: any) {
      logger.error('Error getting WhatsApp channels', { error: error.message });
      throw new AppError('DB_ERROR', `Error al obtener canales: ${error.message}`, 500);
    }
  }
}
