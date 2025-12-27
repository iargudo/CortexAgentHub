import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { createLogger, Logger, LLMProvider } from '@cortex/shared';

const logger = createLogger('APIServer');
import { AIOrchestrator, MessageRouter, ContextManager, FlowBasedMessageRouter } from '@cortex/core';
import { MCPServer } from '@cortex/mcp-server';
import { LoadBalancer } from '@cortex/llm-gateway';
import {
  WhatsAppAdapter,
  TelegramAdapter,
  EmailAdapter,
  WebChatAdapter,
} from '@cortex/channel-adapters';
import { errorHandler } from './middleware';
import { registerRoutes } from './routes';
import {
  MessagesController,
  WebhooksController,
  AdminController,
  ServicesController,
  KnowledgeBasesController,
} from './controllers';
import { WorkerManager, DocumentProcessingWorker, getQueueManager } from '@cortex/queue-service';

/**
 * API Server
 */
export class APIServer {
  private app: FastifyInstance;
  private db: Pool;
  private redis: Redis;
  private mcpServer: MCPServer;
  private loadBalancer: LoadBalancer;
  private flowRouter: FlowBasedMessageRouter;
  private orchestrator: AIOrchestrator;
  private whatsappAdapter: WhatsAppAdapter;
  private telegramAdapter: TelegramAdapter;
  private emailAdapter: EmailAdapter;
  private webchatAdapter: WebChatAdapter;
  private workerManager: WorkerManager | null = null;
  private documentProcessingWorker: DocumentProcessingWorker | null = null;

  constructor() {
    this.app = Fastify({
      logger: false, // Use custom logger
      trustProxy: true,
    });

    // Initialize database with error handling
    try {
      this.db = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20,
      });
      // Test connection
      this.db.on('error', (err) => {
        logger.error('Database pool error', { error: err.message });
      });
    } catch (error: any) {
      logger.error('Failed to initialize database pool', { error: error.message });
      throw error;
    }

    // Initialize Redis with error handling
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          // Solo loguear como WARN después de varios intentos, los primeros como DEBUG
          if (times <= 3) {
            logger.debug(`Redis retry attempt ${times}, delay: ${delay}ms`);
          } else {
            logger.warn(`Redis retry attempt ${times}, delay: ${delay}ms`);
          }
          // Limitar reintentos a 10 para evitar loops infinitos
          if (times > 10) {
            logger.error('Redis connection failed after 10 retry attempts');
            return null; // Detener reintentos
          }
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true, // No conectar inmediatamente
        connectTimeout: 10000, // 10 segundos timeout
        keepAlive: 30000, // Keep-alive cada 30 segundos
        reconnectOnError: (err) => {
          // Reconectar automáticamente en errores específicos
          const targetError = 'READONLY';
          return err.message.includes(targetError);
        },
        enableOfflineQueue: true, // Encolar comandos si está offline para evitar errores en el primer uso
      });

      this.redis.on('connect', () => {
        logger.info('Redis connected');
      });

      this.redis.on('ready', () => {
        logger.info('Redis ready');
      });

      this.redis.on('error', (err) => {
        // Solo loguear errores críticos, ignorar errores de conexión temporales
        if (!err.message.includes('ECONNREFUSED') && 
            !err.message.includes('ETIMEDOUT') &&
            !err.message.includes('Connection is closed')) {
          logger.error('Redis connection error', { error: err.message });
        } else {
          logger.debug('Redis connection error (will retry)', { error: err.message });
        }
      });

      this.redis.on('close', () => {
        // Cambiar a DEBUG - las desconexiones son normales y se reconectan automáticamente
        logger.debug('Redis connection closed (will reconnect automatically)');
      });

      this.redis.on('reconnecting', (delay: number) => {
        logger.debug(`Redis reconnecting in ${delay}ms`);
      });
    } catch (error: any) {
      logger.error('Failed to initialize Redis', { error: error.message });
      throw error;
    }

    // Will be initialized in initialize()
    this.mcpServer = null as any;
    this.loadBalancer = null as any;
    this.flowRouter = null as any;
    this.orchestrator = null as any;
    this.whatsappAdapter = null as any;
    this.telegramAdapter = null as any;
    this.emailAdapter = null as any;
    this.webchatAdapter = null as any;
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    logger.info('Initializing API Server...');
    
    // Test database connection first
    try {
      logger.info('Testing database connection...');
      await this.db.query('SELECT 1');
      logger.info('Database connection successful');
      
      // Configure Logger to use database for automatic error/warn logging
      Logger.setDatabase(this.db);
      logger.info('Logger configured to save error/warn logs to database');
    } catch (error: any) {
      logger.error('Database connection failed', { 
        error: error.message,
        code: error.code,
      });
      throw new Error(`Database connection failed: ${error.message}`);
    }

    // Test Redis connection (non-blocking)
    try {
      logger.info('Testing Redis connection...');
      await this.redis.connect();
      logger.info('Redis connection successful');
    } catch (error: any) {
      logger.warn('Redis connection failed, continuing without Redis', { 
        error: error.message,
      });
      // Redis is optional for basic functionality, so we continue
    }

    // Register plugins
    await this.registerPlugins();

    // Initialize core components
    await this.initializeComponents();

    // Register routes
    await this.registerApplicationRoutes();

    // Set error handler
    this.app.setErrorHandler(errorHandler);

    logger.info('API Server initialized successfully');
  }

  /**
   * Register Fastify plugins
   */
  private async registerPlugins(): Promise<void> {
    // CORS
    // Soporta múltiples orígenes separados por coma o un solo origen
    const corsOrigin = process.env.CORS_ORIGIN || '*';
    
    // Parsear orígenes permitidos
    let allowedOrigins: string | string[] = '*';
    if (corsOrigin !== '*') {
      allowedOrigins = corsOrigin.includes(',')
        ? corsOrigin.split(',').map((origin) => origin.trim())
        : corsOrigin;
    }
    
    logger.info('Configurando CORS', {
      corsOrigin,
      allowedOrigins: Array.isArray(allowedOrigins) ? allowedOrigins.join(', ') : allowedOrigins,
    });
    
    // CORS configuration
    // Use function-based origin to allow all origins when wildcard is set
    // This is necessary because with credentials: true, we can't use '*' directly
    await this.app.register(cors, {
      origin: (origin, callback) => {
        // Always allow requests with no origin (like mobile apps, Postman, etc.)
        if (!origin) {
          return callback(null, true);
        }
        
        // If wildcard is configured, allow all origins
        // This is safe because widget routes handle their own CORS validation
        if (allowedOrigins === '*' || (Array.isArray(allowedOrigins) && allowedOrigins.includes('*'))) {
          return callback(null, true);
        }
        
        // Check if origin is in allowed list
        const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
        if (origins.includes(origin)) {
          return callback(null, true);
        }
        
        // Default: allow all origins (widget routes will validate if needed)
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
      // Preflight continue: allow preflight requests to continue
      preflightContinue: false,
      // Options success status: return 204 for OPTIONS requests
      optionsSuccessStatus: 204,
    });
    
    logger.info('CORS configurado exitosamente');

    // JWT
    await this.app.register(jwt, {
      secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    });

    // Rate limiting (disabled in development)
    // IMPORTANT: Exclude WebSocket upgrade requests from rate limiting
    if (process.env.NODE_ENV === 'production') {
      await this.app.register(rateLimit, {
        max: parseInt(process.env.RATE_LIMIT_REQUESTS || '100'),
        timeWindow: (parseInt(process.env.RATE_LIMIT_WINDOW || '60') * 1000).toString(),
        redis: this.redis,
        skip: (request: any) => {
          // Skip rate limiting for WebSocket upgrade requests
          const upgrade = request.headers?.upgrade;
          const connection = request.headers?.connection;
          return upgrade === 'websocket' || (connection && typeof connection === 'string' && connection.toLowerCase().includes('upgrade'));
        },
      } as any);
      logger.info('Rate limiting enabled (WebSocket upgrades excluded)');
    } else {
      logger.info('Rate limiting disabled (development mode)');
    }

    // WebSocket
    await this.app.register(websocket);

    // Multipart (file uploads)
    // Increase file size limit to 50MB (for large PDFs and Excel files)
    await this.app.register(multipart, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB
        files: 100, // Allow up to 100 files in batch upload
      },
    });

    logger.info('Fastify plugins registered');
  }

  /**
   * Load LLM providers configuration from database
   */
  private async loadProvidersFromDatabase(): Promise<any[]> {
    try {
      const result = await this.db.query(`
        SELECT id, provider, model, config, priority, active, instance_identifier, name
        FROM llm_configs
        WHERE active = true
        ORDER BY priority ASC
      `);

      const providers = result.rows.map((row) => {
        const config = row.config || {};
        
        // Convert provider string to LLMProvider enum
        const providerEnum = this.stringToLLMProvider(row.provider);

        return {
          provider: providerEnum,
          model: row.model,
          instance_identifier: row.instance_identifier || 'default',
          name: row.name,
          apiKey: config.apiKey || this.getApiKeyForProvider(row.provider),
          baseURL: config.baseURL || this.getBaseURLForProvider(row.provider),
          temperature: config.temperature || 0.7,
          maxTokens: config.maxTokens,
          topP: config.topP,
          frequencyPenalty: config.frequencyPenalty,
          presencePenalty: config.presencePenalty,
          stopSequences: config.stopSequences,
          priority: row.priority || 10,
        };
      });

      logger.info('Loaded LLM providers from database', {
        count: providers.length,
        providers: providers.map(p => `${p.provider}/${p.model}${p.instance_identifier !== 'default' ? ` (${p.instance_identifier})` : ''}`),
      });

      return providers;
    } catch (error: any) {
      logger.error('Failed to load providers from database', { error: error.message });
      return [];
    }
  }

  /**
   * Get API key from environment for a provider
   */
  private getApiKeyForProvider(provider: string): string | undefined {
    switch (provider.toLowerCase()) {
      case 'openai':
        return process.env.OPENAI_API_KEY;
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY;
      case 'google':
        return process.env.GOOGLE_API_KEY;
      case 'huggingface':
        return process.env.HUGGINGFACE_API_KEY;
      default:
        return undefined;
    }
  }

  /**
   * Get base URL from environment for a provider
   */
  private getBaseURLForProvider(provider: string): string | undefined {
    switch (provider.toLowerCase()) {
      case 'ollama':
        return process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      case 'lmstudio':
        return process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
      default:
        return undefined;
    }
  }

  /**
   * Convert provider string to LLMProvider enum
   */
  private stringToLLMProvider(provider: string): LLMProvider {
    const normalized = provider.toLowerCase();
    switch (normalized) {
      case 'openai':
        return LLMProvider.OPENAI;
      case 'anthropic':
        return LLMProvider.ANTHROPIC;
      case 'google':
        return LLMProvider.GOOGLE;
      case 'ollama':
        return LLMProvider.OLLAMA;
      case 'huggingface':
        return LLMProvider.HUGGINGFACE;
      case 'lmstudio':
        return LLMProvider.LMSTUDIO;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Initialize core components (MCP, LLM Gateway, Orchestrator, Adapters)
   */
  private async initializeComponents(): Promise<void> {
    // Initialize MCP Server (using a different port to avoid conflicts)
    // MCP Server runs internally, API Server uses PORT from Azure
    const mcpPort = parseInt(process.env.MCP_SERVER_PORT || '8081');
    this.mcpServer = new MCPServer({
      port: mcpPort,
      tools: [],
      resources: [],
      contextStore: {
        provider: 'redis',
        ttl: parseInt(process.env.MCP_CONTEXT_TTL || '3600'),
        config: {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
        },
      },
      security: {
        enablePermissions: true,
        enableRateLimiting: true,
      },
    });
    
    try {
      await this.mcpServer.start();
      logger.info(`MCP Server initialized on port ${mcpPort}`);
    } catch (error: any) {
      logger.error('Failed to start MCP Server', { error: error.message });
      throw error;
    }

    // Initialize LLM Gateway with providers from database
    try {
      const providersConfig = await this.loadProvidersFromDatabase();
      this.loadBalancer = new LoadBalancer({
        strategy: 'least-latency',
        providers: providersConfig,
        fallbackEnabled: true,
        retryAttempts: 3,
        retryDelay: 1000,
        circuitBreaker: {
          failureThreshold: 5,
          resetTimeout: 60000,
        },
      });
      await this.loadBalancer.initialize();
      logger.info('LLM Gateway initialized', { providerCount: providersConfig.length });
    } catch (error: any) {
      logger.warn('LLM Gateway initialization failed, continuing without LLM providers', { 
        error: error.message 
      });
      // Create a minimal load balancer to prevent crashes
      this.loadBalancer = new LoadBalancer({
        strategy: 'least-latency',
        providers: [],
        fallbackEnabled: false,
        retryAttempts: 3,
        retryDelay: 1000,
        circuitBreaker: {
          failureThreshold: 5,
          resetTimeout: 60000,
        },
      });
    }

    // Initialize Flow-Based Message Router (from database)
    this.flowRouter = new FlowBasedMessageRouter(this.db);
    logger.info('Flow-Based Message Router initialized');

    // Initialize Legacy Message Router (fallback)
    const messageRouter = new MessageRouter({
      rules: [],
      defaultProvider: 'openai' as any,
      defaultModel: 'gpt-4',
    });
    logger.info('Legacy Message Router initialized');

    // Initialize Context Manager
    const contextManager = new ContextManager(this.mcpServer, {
      provider: 'redis',
      ttl: parseInt(process.env.MCP_CONTEXT_TTL || '3600'),
      maxHistoryLength: 100,
      compressionEnabled: false,
    });
    logger.info('Context Manager initialized');

    // Initialize Orchestrator
    this.orchestrator = new AIOrchestrator(
      this.mcpServer,
      this.loadBalancer,
      messageRouter,
      contextManager,
      {
        defaultLLMProvider: 'openai' as any,
        defaultLLMModel: 'gpt-4',
        routingRules: [],
        contextTTL: parseInt(process.env.MCP_CONTEXT_TTL || '3600'),
        enableToolExecution: true,
        maxToolExecutions: 10,
      }
    );
    logger.info('AI Orchestrator initialized');

    // Initialize Channel Adapters
    // WhatsApp
    try {
      const whatsappProvider = (process.env.WHATSAPP_PROVIDER || 'ultramsg') as 'ultramsg' | 'twilio' | '360dialog';
      
      // Build WhatsApp config based on provider
      let whatsappConfig: any = {
        provider: whatsappProvider,
        phoneNumber: process.env.WHATSAPP_PHONE_NUMBER || '',
        webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
        webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET,
      };

      // Provider-specific configuration
      if (whatsappProvider === 'ultramsg') {
        whatsappConfig.apiToken = process.env.WHATSAPP_ULTRAMSG_TOKEN || '';
        whatsappConfig.instanceId = process.env.WHATSAPP_ULTRAMSG_INSTANCE_ID || '';
      } else if (whatsappProvider === 'twilio') {
        whatsappConfig.apiToken = ''; // Twilio doesn't use apiToken
        whatsappConfig.accountSid = process.env.WHATSAPP_TWILIO_ACCOUNT_SID || '';
        whatsappConfig.authToken = process.env.WHATSAPP_TWILIO_AUTH_TOKEN || '';
      } else if (whatsappProvider === '360dialog') {
        whatsappConfig.apiToken = process.env.WHATSAPP_360DIALOG_API_KEY || '';
        whatsappConfig.phoneNumberId = process.env.WHATSAPP_360DIALOG_PHONE_NUMBER_ID || '';
        whatsappConfig.wabaId = process.env.WHATSAPP_360DIALOG_WABA_ID; // Optional
      }

      this.whatsappAdapter = new WhatsAppAdapter();
      await this.whatsappAdapter.initialize({
        config: whatsappConfig,
      });
      logger.info('WhatsApp Adapter initialized', { provider: whatsappProvider });
    } catch (error: any) {
      logger.warn('WhatsApp Adapter initialization failed - channel disabled', { error: error.message });
      this.whatsappAdapter = null as any;
    }

    // Telegram
    try {
      this.telegramAdapter = new TelegramAdapter();
      await this.telegramAdapter.initialize({
        config: {
          botToken: process.env.TELEGRAM_BOT_TOKEN || '',
          webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
        },
      });
      logger.info('Telegram Adapter initialized');
    } catch (error: any) {
      logger.warn('Telegram Adapter initialization failed - channel disabled', { error: error.message });
      this.telegramAdapter = null as any;
    }

    // Email
    try {
      this.emailAdapter = new EmailAdapter();
      await this.emailAdapter.initialize({
        config: {
          smtp: {
            host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
            secure: process.env.EMAIL_SMTP_SECURE === 'true',
            user: process.env.EMAIL_SMTP_USER || '',
            pass: process.env.EMAIL_SMTP_PASS || '',
          },
          imap: {
            host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
            port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
            user: process.env.EMAIL_IMAP_USER || '',
            pass: process.env.EMAIL_IMAP_PASS || '',
          },
          fromAddress: process.env.EMAIL_FROM_ADDRESS || '',
        },
      });
      logger.info('Email Adapter initialized');
    } catch (error: any) {
      logger.warn('Email Adapter initialization failed - channel disabled', { error: error.message });
      this.emailAdapter = null as any;
    }

    // WebChat
    try {
      this.webchatAdapter = new WebChatAdapter();
      
      // Get allowed origins from environment or use wildcard
      let allowedOrigins: string[] = [];
      if (process.env.WEBCHAT_ALLOWED_ORIGINS) {
        allowedOrigins = process.env.WEBCHAT_ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
      } else {
        // Default to wildcard in development
        allowedOrigins = ['*'];
      }
      
      // In development, automatically add common localhost origins to allowed origins
      // This allows the widget to connect from various localhost ports
      if (process.env.NODE_ENV !== 'production') {
        const commonOrigins = [
          'http://localhost:3000',  // Frontend default port
          'http://localhost:5174',  // Vite default port
          'http://localhost:8080',  // API server port
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5174',
          'http://127.0.0.1:8080',
        ];
        
        // Add API server origin dynamically
        const apiPort = parseInt(process.env.PORT || process.env.API_PORT || '8080');
        const apiHost = process.env.API_HOST || 'localhost';
        const apiOrigin = `http://${apiHost}:${apiPort}`;
        if (!commonOrigins.includes(apiOrigin)) {
          commonOrigins.push(apiOrigin);
        }
        
        // Add all common origins if not using wildcard
        if (!allowedOrigins.includes('*')) {
          for (const origin of commonOrigins) {
            if (!allowedOrigins.includes(origin)) {
              allowedOrigins.push(origin);
            }
          }
          logger.info(`Added development origins to WebChat allowed origins: ${commonOrigins.join(', ')}`);
        } else {
          logger.info('Using wildcard for WebChat allowed origins (development mode)');
        }
      }
      
      // Initialize WebChatAdapter WITHOUT creating a separate WebSocket server
      // We'll use Fastify WebSocket instead (works both locally and in Azure)
      await this.webchatAdapter.initialize({
        config: {
          wsPort: parseInt(process.env.WEBCHAT_WS_PORT || '8081'), // Not used, but kept for compatibility
          jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
          allowedOrigins: allowedOrigins,
          useFastifyWebSocket: true, // Flag to skip creating separate server
        },
      });
      
      // Register message handler for WebChat
      // We need to register handlers for each user when they connect
      // For now, we'll use a global handler that processes all messages
      const processWebChatMessage = async (message: any) => {
        try {
          logger.info('WebChat message received', {
            userId: message.channelUserId,
            content: message.content.substring(0, 100),
          });

          // Load conversation history from database before processing
          // This ensures the AI has access to previous conversation context
          const conversationId = message.metadata?.conversationId || message.channelUserId;
          let conversationId_db: string | null = null;
          
          if (this.db) {
            try {
              // Get or create conversation
              let convResult = await this.db.query(
                `SELECT id FROM conversations 
                 WHERE channel = $1 AND channel_user_id = $2
                 LIMIT 1`,
                [message.channelType, message.channelUserId]
              );

              if (convResult.rows.length === 0) {
                // Create new conversation (flow_id will be updated after routing)
                const insertResult = await this.db.query(
                  `INSERT INTO conversations (channel, channel_user_id, started_at, last_activity, status)
                   VALUES ($1, $2, NOW(), NOW(), 'active')
                   RETURNING id`,
                  [message.channelType, message.channelUserId]
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

              if (messagesResult.rows.length > 0) {
                // Get orchestrator's context manager
                const contextManager = (this.orchestrator as any).contextManager;
                if (contextManager) {
                  // Get or create context using the same channelType and userId
                  const mcpContext = await contextManager.getOrCreateContext(
                    conversationId_db,
                    message.channelType,
                    message.channelUserId
                  );
                  
                  // Update context with the correct conversationId from database
                  await (this.orchestrator as any).mcpServer.updateContext(mcpContext.sessionId, {
                    conversationId: conversationId_db,
                  });

                  // Check if context already has history
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
                    }
                  } else {
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
                  }
                }
              }
            } catch (dbError: any) {
              logger.warn('Failed to load history from database', { 
                error: dbError.message,
                conversationId,
              });
              // Continue processing even if history load fails
            }
          }

          // Route message to determine flow and LLM
          // Log message metadata for debugging
          logger.debug('Routing WebChat message', {
            channelType: message.channelType,
            channelUserId: message.channelUserId,
            instanceId: message.metadata?.instanceId,
            websiteId: message.metadata?.websiteId,
            allMetadata: message.metadata,
          });
          
          let routingResult = await this.flowRouter.route(message);
          
          if (routingResult) {
            logger.info('WebChat message routed to flow', {
              flowId: routingResult.flow.id,
              flowName: routingResult.flow.name,
              channelConfigId: routingResult.channelConfigId,
              llmProvider: routingResult.llmProvider,
              llmModel: routingResult.llmModel,
              hasSystemPrompt: !!routingResult.flow.flow_config?.systemPrompt,
            });
          } else {
            logger.warn('No flow found for WebChat message', {
              channelType: message.channelType,
              instanceId: message.metadata?.instanceId,
            });
          }

          // Process message through orchestrator
          const result = await this.orchestrator.processMessage(message, routingResult);

          // Log tool execution results IMMEDIATELY after orchestrator - BEFORE anything else
          logger.info('=== WebChat orchestrator result (IMMEDIATE) ===', {
            userId: message.channelUserId,
            conversationId: conversationId_db || 'not-set-yet',
            hasResult: !!result,
            resultType: typeof result,
            resultKeys: result ? Object.keys(result) : [],
            hasToolExecutions: !!(result && result.toolExecutions),
            toolExecutionsType: typeof result?.toolExecutions,
            toolExecutionsIsArray: Array.isArray(result?.toolExecutions),
            toolExecutionsCount: result?.toolExecutions?.length || 0,
            toolExecutionsValue: JSON.stringify(result?.toolExecutions || []),
            toolNames: result?.toolExecutions?.map((t: any) => t?.toolName) || [],
            enabledToolsFromFlow: routingResult?.enabledTools || [],
            flowName: routingResult?.flow?.name || 'unknown',
          });

          // Prepare to save messages and tool executions
          // We'll save everything in one transaction-like block

          // Save to database if available
          // Use conversationId_db if we already have it, otherwise get/create it
          if (this.db) {
            try {
              let dbConversationId = conversationId_db;
              
              // If we don't have conversationId_db, get or create it
              if (!dbConversationId) {
                let convResult = await this.db.query(
                  `SELECT id FROM conversations 
                   WHERE channel = $1 AND channel_user_id = $2
                   LIMIT 1`,
                  [message.channelType, message.channelUserId]
                );

                if (convResult.rows.length === 0) {
                  const flowIdForInsert = routingResult?.flow?.id || null;
                  const insertResult = await this.db.query(
                    `INSERT INTO conversations (channel, channel_user_id, started_at, last_activity, status, flow_id)
                     VALUES ($1, $2, NOW(), NOW(), 'active', $3)
                     RETURNING id`,
                    [message.channelType, message.channelUserId, flowIdForInsert]
                  );
                  dbConversationId = insertResult.rows[0].id;
                } else {
                  dbConversationId = convResult.rows[0].id;
                }
              }

              // Update last activity and flow_id (if available from routing)
              const flowId = routingResult?.flow?.id || null;
              if (flowId) {
                await this.db.query(
                  `UPDATE conversations SET last_activity = NOW(), flow_id = $2 WHERE id = $1`,
                  [dbConversationId, flowId]
                );
                logger.debug('Updated conversation flow_id', {
                  conversationId: dbConversationId,
                  flowId: flowId,
                });
              } else {
                await this.db.query(
                  `UPDATE conversations SET last_activity = NOW() WHERE id = $1`,
                  [dbConversationId]
                );
                logger.warn('No flow_id to update - routingResult is null or has no flow', {
                  conversationId: dbConversationId,
                  hasRoutingResult: !!routingResult,
                  hasFlow: !!routingResult?.flow,
                });
              }

              // Save messages
              await this.db.query(
                `INSERT INTO messages (conversation_id, role, content, timestamp, llm_provider, llm_model, tokens_used, cost, metadata)
                 VALUES ($1, 'user', $2, NOW(), NULL, NULL, NULL, NULL, $3)`,
                [dbConversationId, message.content, JSON.stringify(message.metadata || {})]
              );

              // Build metadata object explicitly to ensure all values are captured
              const assistantMetadata = {
                processingTimeMs: result.processingTimeMs || 0,
                toolExecutions: result.toolExecutions?.length || 0,
                flowId: routingResult?.flow?.id || null,
                flowName: routingResult?.flow?.name || null,
                ...(result.metadata || {}),
              };
              
              logger.info('WebChat assistant message metadata being saved', {
                conversationId: dbConversationId,
                hasRoutingResult: !!routingResult,
                hasFlow: !!routingResult?.flow,
                flowId: assistantMetadata.flowId,
                flowName: assistantMetadata.flowName,
                toolExecutions: assistantMetadata.toolExecutions,
                processingTimeMs: assistantMetadata.processingTimeMs,
                metadataString: JSON.stringify(assistantMetadata),
              });

              const assistantMsgResult = await this.db.query(
                `INSERT INTO messages (conversation_id, role, content, timestamp, llm_provider, llm_model, tokens_used, cost, metadata)
                 VALUES ($1, 'assistant', $2, NOW(), $3, $4, $5, $6, $7)
                 RETURNING id`,
                [
                  dbConversationId,
                  result.outgoingMessage.content,
                  result.llmProvider || null,
                  result.llmModel || null,
                  result.tokensUsed ? JSON.stringify(result.tokensUsed) : null,
                  result.cost || null,
                  JSON.stringify(assistantMetadata),
                ]
              );
              
              logger.info('WebChat assistant message saved to database', {
                conversationId: dbConversationId,
                messageId: assistantMsgResult.rows[0]?.id,
                llmProvider: result.llmProvider,
                llmModel: result.llmModel,
              });

              // Save tool executions IMMEDIATELY after saving assistant message
              const assistantMessageId = assistantMsgResult.rows[0]?.id;
              
              if (result.toolExecutions && result.toolExecutions.length > 0) {
                if (assistantMessageId) {
                  logger.info('WebChat: Saving tool executions', {
                    conversationId: dbConversationId,
                    messageId: assistantMessageId,
                    toolCount: result.toolExecutions.length,
                    tools: result.toolExecutions.map((t: any) => ({
                      name: t.toolName,
                      status: t.status,
                      hasError: !!t.error,
                    })),
                  });

                  let savedCount = 0;
                  let failedCount = 0;

                  for (const toolExec of result.toolExecutions) {
                    try {
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
                          assistantMessageId,
                          toolExec.toolName,
                          JSON.stringify(toolExec.parameters || {}),
                          toolExec.result ? JSON.stringify(toolExec.result) : null,
                          toolExec.executionTimeMs || null,
                          dbStatus, // Use mapped status
                          toolExec.error || null,
                        ]
                      );
                      savedCount++;
                    } catch (toolExecError: any) {
                      failedCount++;
                      logger.error('WebChat: Failed to save tool execution', {
                        error: toolExecError.message,
                        stack: toolExecError.stack,
                        toolName: toolExec.toolName,
                        toolStatus: toolExec.status,
                        toolError: toolExec.error,
                        messageId: assistantMessageId,
                        conversationId: dbConversationId,
                      });
                    }
                  }

                  logger.info('WebChat: Tool executions save completed', {
                    conversationId: dbConversationId,
                    messageId: assistantMessageId,
                    totalTools: result.toolExecutions.length,
                    savedCount,
                    failedCount,
                  });
                } else {
                  logger.error('Cannot save tool executions: assistantMessageId is null', {
                    conversationId: dbConversationId,
                  });
                }
              } else {
                logger.debug('WebChat: No tool executions to save', {
                  conversationId: dbConversationId,
                  messageId: assistantMessageId,
                  hasToolExecutions: !!(result.toolExecutions),
                  toolExecutionsCount: result.toolExecutions?.length || 0,
                  toolExecutionsType: typeof result.toolExecutions,
                  isArray: Array.isArray(result.toolExecutions),
                });
              }

            } catch (dbError: any) {
              logger.error('WebChat: Failed to save message to database', { 
                error: dbError.message,
                errorCode: (dbError as any).code,
                errorStack: dbError.stack,
                conversationId: conversationId_db,
                userId: message.channelUserId,
              });
            }
          }

          // Send response back through WebChat adapter
          await this.webchatAdapter.sendMessage(message.channelUserId, {
            channelUserId: message.channelUserId,
            content: result.outgoingMessage.content,
            metadata: result.metadata,
          });

          logger.info('WebChat message processed and sent', {
            userId: message.channelUserId,
          });
        } catch (error: any) {
          logger.error('Error processing WebChat message', {
            error: error.message,
            stack: error.stack,
            userId: message.channelUserId,
          });

          // Send error message to user
          try {
            await this.webchatAdapter.sendMessage(message.channelUserId, {
              channelUserId: message.channelUserId,
              content: 'Lo siento, ocurrió un error al procesar tu mensaje. Por favor intenta de nuevo.',
              metadata: {},
            });
          } catch (sendError: any) {
            logger.error('Failed to send error message to user', { error: sendError.message });
          }
        }
      };

      // Register default message handler for all WebChat users
      // Verify method exists before calling (workaround for ts-node-dev cache issues)
      if (typeof this.webchatAdapter.onDefaultMessage === 'function') {
        this.webchatAdapter.onDefaultMessage(processWebChatMessage);
        logger.info('WebChat Adapter initialized with default message handler');
      } else {
        // Direct assignment as fallback if method not available
        logger.warn('onDefaultMessage method not found, using direct assignment');
        (this.webchatAdapter as any).defaultMessageHandler = processWebChatMessage;
        logger.info('WebChat Adapter initialized with direct defaultMessageHandler assignment');
      }
    } catch (error: any) {
      logger.warn('WebChat Adapter initialization failed - channel disabled', { error: error.message, stack: error.stack });
      this.webchatAdapter = null as any;
    }
  }

  /**
   * Register application routes
   */
  private async registerApplicationRoutes(): Promise<void> {
    // Initialize controllers
    const messagesController = new MessagesController(this.orchestrator, this.flowRouter, this.db);
    const webhooksController = new WebhooksController(
      this.orchestrator,
      this.whatsappAdapter,
      this.telegramAdapter,
      this.emailAdapter,
      this.flowRouter,
      this.db
    );
    // Initialize queue system and workers
    let enableDocumentQueue = false;
    try {
      const queueManager = getQueueManager();
      
      // Initialize WorkerManager to start all workers (including WhatsAppSendingWorker)
      // CRITICAL: Wrap in try-catch to ensure server starts even if workers fail
      try {
        this.workerManager = new WorkerManager();
        await this.workerManager.startAll();
        logger.info('Queue workers started successfully');
      } catch (workerError: any) {
        logger.error('Failed to start queue workers, continuing without workers', {
          error: workerError.message,
        });
        // Don't throw - allow server to continue without workers
        // The system will fall back to synchronous sending
        this.workerManager = null;
      }
      
      this.documentProcessingWorker = new DocumentProcessingWorker(3); // Process 3 documents concurrently
      
      // Get the KnowledgeBaseService instance to connect the worker
      // We'll need to create it temporarily to get the processDocument method
      const { EmbeddingService, KnowledgeBaseService } = await import('./services');
      const embeddingService = new EmbeddingService(this.db);
      const kbService = new KnowledgeBaseService(this.db, embeddingService, false); // Don't enable queue yet
      
      // Connect worker to the processDocument method
      this.documentProcessingWorker.setProcessDocumentFn(
        (documentId: string, knowledgeBaseId: string) => 
          kbService.processDocument(documentId, knowledgeBaseId)
      );
      
      // The worker is automatically started when created (BullMQ Worker starts immediately)
      // But we need to ensure it's properly initialized
      logger.info('Document processing worker created and ready', {
        queueName: 'document-processing',
        concurrency: 3,
      });
      
      enableDocumentQueue = true;
      logger.info('Document processing queue initialized');
    } catch (error: any) {
      logger.warn('Document processing queue not available, using synchronous processing', {
        error: error.message,
      });
      enableDocumentQueue = false;
    }

    const adminController = new AdminController(this.db, this.mcpServer);
    const servicesController = new ServicesController();
    const knowledgeBasesController = new KnowledgeBasesController(this.db, enableDocumentQueue);

    // Register routes
    logger.info('Starting route registration...');
    await registerRoutes(this.app, {
      messages: messagesController,
      webhooks: webhooksController,
      admin: adminController,
      services: servicesController,
      knowledgeBases: knowledgeBasesController,
    }, this.webchatAdapter, this.db);

    // Log all registered routes for debugging (in development)
    if (process.env.NODE_ENV === 'development' || process.env.LOG_ROUTES === 'true') {
      const routes = this.app.printRoutes();
      logger.info('Registered routes:', { routes });
    }

    logger.info('Application routes registered');
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Azure App Service usa PORT, pero también soportamos API_PORT
    const port = parseInt(process.env.PORT || process.env.API_PORT || '8080');
    const host = process.env.API_HOST || '0.0.0.0';

    try {
      await this.app.listen({ port, host });
      logger.info(`API Server listening on ${host}:${port}`);
      logger.info('API Server started successfully');
    } catch (error: any) {
      logger.error('Failed to start API Server', { 
        error: error.message,
        port,
        host,
        stack: error.stack 
      });
      console.error('Full error:', error);
      throw error;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    logger.info('Stopping API Server...');

    // Stop workers gracefully - wrap in try-catch to ensure cleanup continues even if workers fail
    if (this.workerManager) {
      try {
        await this.workerManager.stopAll();
      } catch (error: any) {
        logger.error('Error stopping worker manager', { error: error.message });
        // Continue with shutdown even if workers fail to stop
      }
    }
    if (this.documentProcessingWorker) {
      try {
        await this.documentProcessingWorker.close();
      } catch (error: any) {
        logger.error('Error closing document processing worker', { error: error.message });
        // Continue with shutdown
      }
    }

    await this.app.close();
    await this.db.end();
    await this.redis.quit();

    logger.info('API Server stopped');
  }

  /**
   * Get Fastify instance (for testing)
   */
  getApp(): FastifyInstance {
    return this.app;
  }

  /**
   * Get Flow Router
   */
  getFlowRouter(): FlowBasedMessageRouter {
    return this.flowRouter;
  }

  /**
   * Get Orchestrator
   */
  getOrchestrator(): AIOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get Channel Adapters
   */
  getAdapters() {
    return {
      whatsapp: this.whatsappAdapter,
      telegram: this.telegramAdapter,
      email: this.emailAdapter,
      webchat: this.webchatAdapter,
    };
  }

  /**
   * Get MCP Server instance
   */
  getMCPServer(): MCPServer {
    return this.mcpServer;
  }
}
