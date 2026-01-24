import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import {
  MessagesController,
  WebhooksController,
  AdminController,
  ServicesController,
  KnowledgeBasesController,
} from '../controllers';
import { IntegrationsController } from '../controllers/integrations.controller';
import { messagesRoutes } from './messages.routes';
import { conversationsRoutes } from './conversations.routes';
import { webhooksRoutes } from './webhooks.routes';
import { adminRoutes } from './admin.routes';
import { servicesRoutes } from './services.routes';
import { integrationsRoutes } from './integrations.routes';
import {
  knowledgeBasesRoutes,
  flowKnowledgeBasesRoutes,
  embeddingModelsRoutes,
} from './knowledge-bases.routes';
import { createLogger } from '@cortex/shared';

const logger = createLogger('Routes');

/**
 * Register all application routes
 */
export async function registerRoutes(
  fastify: FastifyInstance,
  controllers: {
    messages: MessagesController;
    webhooks: WebhooksController;
    admin: AdminController;
    services: ServicesController;
    knowledgeBases: KnowledgeBasesController;
    integrations: IntegrationsController;
  },
  webchatAdapter?: any,
  db?: Pool
): Promise<void> {
  // Global hook to ensure CORS headers for widget endpoints
  // Add onRequest hook to log WebSocket upgrade attempts and agent public requests
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url || '';
    
    // Log all requests to /api/agents/* for debugging
    if (url.includes('/api/agents/')) {
      logger.info('Request to /api/agents/* detected', {
        url: request.url,
        method: request.method,
        path: request.routerPath,
        params: (request as any).params,
        query: request.query,
        headers: {
          origin: request.headers.origin,
          'user-agent': request.headers['user-agent'],
        },
        ip: request.ip,
      });
    }
    
    const upgrade = request.headers.upgrade;
    const connection = request.headers.connection;
    
    // Log WebSocket upgrade attempts
    if (upgrade === 'websocket' || (connection && connection.toLowerCase().includes('upgrade'))) {
      logger.info('WebSocket upgrade request detected', {
        url: request.url,
        method: request.method,
        headers: {
          upgrade: upgrade,
          connection: connection,
          'sec-websocket-key': request.headers['sec-websocket-key'],
          'sec-websocket-version': request.headers['sec-websocket-version'],
          origin: request.headers.origin,
        },
        ip: request.ip,
      });
    }
  });
  
  // Use onSend hook which runs BEFORE response is sent but after handler
  fastify.addHook('onSend', async (request, reply, payload) => {
    const url = request.url || '';
    
    // Only apply to widget-related endpoints and public agent endpoint
    if (url.includes('/api/widgets/') || url.includes('/widget.js') || url.includes('/api/v1/webchat/auth') || (url.includes('/api/agents/') && url.includes('/public'))) {
      const origin = request.headers.origin;
      
      // Log for debugging
      logger.info('Widget CORS onSend hook triggered', {
        url,
        origin: origin || 'no-origin',
        method: request.method,
        statusCode: reply.statusCode,
        currentHeaders: {
          'Access-Control-Allow-Origin': reply.getHeader('Access-Control-Allow-Origin'),
        },
      });
      
      // Force set CORS headers - this will override any previous headers
      // IMPORTANT: When using wildcard (*), we cannot use Access-Control-Allow-Credentials
      // Azure App Service handles CORS, so we need to be compatible with its settings
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
        // Only set credentials if origin is specific (not wildcard)
        // Azure App Service has supportCredentials: false, so we match that
        // reply.header('Access-Control-Allow-Credentials', 'true');
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
      
      // Log headers that were set
      logger.info('CORS headers forced in onSend', {
        url,
        origin: origin || '*',
        finalHeaders: {
          'Access-Control-Allow-Origin': reply.getHeader('Access-Control-Allow-Origin'),
          'Access-Control-Allow-Methods': reply.getHeader('Access-Control-Allow-Methods'),
        },
      });
    }
    
    return payload;
  });
  
  // Also add onResponse hook as backup (runs after response is sent)
  fastify.addHook('onResponse', async (request, reply) => {
    const url = request.url || '';
    
    // Log 404 errors for debugging, but filter out common bot/health check requests
    if (reply.statusCode === 404) {
      // Normalize URL: remove query string, trailing slashes, and convert to lowercase
      const normalizedUrl = url.split('?')[0].replace(/\/$/, '').toLowerCase() || '/';
      
      // Skip logging for common bot requests and root path
      const skipPaths = ['/', '/robots.txt', '/favicon.ico', '/sitemap.xml'];
      // Also check for dynamic robot paths like /robots933456.txt
      const isRobotFile = /^\/robots\d+\.txt$/i.test(normalizedUrl);
      
      const userAgent = (request.headers['user-agent'] || '').toLowerCase();
      const isBot = /bot|crawler|spider|crawling|scraper|monitor|check|ping/i.test(userAgent);
      
      // Skip logging for common paths, robot files, and bots
      const shouldSkip = skipPaths.includes(normalizedUrl) || isRobotFile || isBot;
      
      // Only log if we should NOT skip - completely silent for filtered paths
      if (!shouldSkip) {
        // Use debug level instead of warn to reduce noise in production logs
        logger.debug('404 Not Found', {
          url: request.url,
          method: request.method,
          routerPath: request.routerPath,
          params: (request as any).params,
          query: request.query,
        });
      }
      // No logging at all for filtered paths - return early
    }
    
    // Only apply to widget-related endpoints and public agent endpoint
    if (url.includes('/api/widgets/') || url.includes('/widget.js') || url.includes('/api/v1/webchat/auth') || (url.includes('/api/agents/') && url.includes('/public'))) {
      const origin = request.headers.origin;
      
      logger.info('Widget CORS onResponse hook (backup)', {
        url,
        origin: origin || '*',
        statusCode: reply.statusCode,
        headersSent: reply.sent,
      });
    }
  });
  // Health check endpoint (no auth required)
  fastify.get('/health', async (request, reply) => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
      components: {
        api: 'healthy',
        database: 'unknown',
        redis: 'unknown',
        mcpServer: 'unknown',
      },
    };

    try {
      // Check database connection (quick query)
      const dbCheck = await (fastify as any).db.query('SELECT 1');
      health.components.database = dbCheck ? 'healthy' : 'unhealthy';
    } catch (error) {
      health.components.database = 'unhealthy';
      health.status = 'degraded';
    }

    try {
      // Check Redis connection
      const redisCheck = await (fastify as any).redis.ping();
      health.components.redis = redisCheck === 'PONG' ? 'healthy' : 'unhealthy';
    } catch (error) {
      health.components.redis = 'unhealthy';
      health.status = 'degraded';
    }

    // MCP Server is assumed healthy if API is running
    health.components.mcpServer = 'healthy';

    return health;
  });

  // Public Agent Info route (no auth required) - MUST be registered BEFORE any prefixed routes
  // For chat client to get channel_id (UUID) for WebSocket connection
  // Using fastify.route() for more explicit control
  logger.info('Registering public agent info route: /api/agents/:agentId/public');
  
  fastify.route({
    method: 'OPTIONS',
    url: '/api/agents/:agentId/public',
    preHandler: async (request, reply) => {
      const origin = request.headers.origin;
      logger.info('OPTIONS /api/agents/:agentId/public preHandler', { 
        origin, 
        url: request.url,
        params: (request as any).params 
      });
      
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
    },
    handler: async (request, reply) => {
      const origin = request.headers.origin;
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return reply.code(204).send();
    }
  });

  fastify.route({
    method: 'GET',
    url: '/api/agents/:agentId/public',
    preHandler: async (request, reply) => {
      const origin = request.headers.origin;
      logger.info('GET /api/agents/:agentId/public preHandler', { 
        origin, 
        url: request.url,
        routerPath: request.routerPath,
        params: (request as any).params 
      });
      
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    },
    handler: async (request, reply) => {
      const origin = request.headers.origin;
      logger.info('GET /api/agents/:agentId/public handler START', { 
        origin, 
        url: request.url,
        routerPath: request.routerPath,
        params: (request as any).params 
      });
      
      try {
        if (origin) {
          reply.header('Access-Control-Allow-Origin', origin);
        } else {
          reply.header('Access-Control-Allow-Origin', '*');
        }
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        await controllers.admin.getAgentPublicInfo(request as any, reply);
        
        logger.info('GET /api/agents/:agentId/public handler SUCCESS', { 
          url: request.url,
          statusCode: reply.statusCode
        });
      } catch (error: any) {
        logger.error('GET /api/agents/:agentId/public handler ERROR', { 
          url: request.url,
          error: error.message,
          stack: error.stack,
          statusCode: error.statusCode || 500
        });
        throw error;
      }
    }
  });
  
  logger.info('Public agent info route registered successfully');
  
  // Test endpoint to verify route registration works
  fastify.get('/api/test-route-registration', async (request, reply) => {
    logger.info('Test route called - route registration is working');
    return { success: true, message: 'Route registration is working', timestamp: new Date().toISOString() };
  });

  // Temporary test endpoint to verify 360Dialog connectivity from Azure
  fastify.post('/api/test-360dialog', async (request, reply) => {
    try {
      const https = require('https');
      const { body } = request as any;
      const { apiKey, phoneNumber, testMessage } = body;

      if (!apiKey || !phoneNumber) {
        return reply.status(400).send({
          success: false,
          error: 'apiKey and phoneNumber are required',
        });
      }

      const payload = JSON.stringify({
        recipient_type: 'individual',
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: testMessage || 'Test from Azure App Service',
        },
      });

      const startTime = Date.now();
      logger.info('Testing 360Dialog connectivity from Azure', {
        apiKey: apiKey.substring(0, 10) + '...',
        phoneNumber,
        url: 'https://waba-v2.360dialog.io/messages',
      });

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: 'waba-v2.360dialog.io',
            path: '/messages',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'D360-API-KEY': apiKey,
              'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 60000,
            rejectUnauthorized: true,
          },
          (res: any) => {
            let responseData = '';
            res.on('data', (chunk: Buffer) => {
              responseData += chunk.toString();
            });
            res.on('end', () => {
              const duration = Date.now() - startTime;
              logger.info('360Dialog test response received', {
                statusCode: res.statusCode,
                duration: `${duration}ms`,
                responseLength: responseData.length,
              });
              resolve(
                reply.send({
                  success: true,
                  statusCode: res.statusCode,
                  duration: `${duration}ms`,
                  response: JSON.parse(responseData || '{}'),
                  headers: res.headers,
                })
              );
            });
          }
        );

        req.on('error', (error: any) => {
          const duration = Date.now() - startTime;
          logger.error('360Dialog test request failed', {
            error: error.message,
            code: error.code,
            duration: `${duration}ms`,
          });
          resolve(
            reply.status(500).send({
              success: false,
              error: error.message,
              code: error.code,
              duration: `${duration}ms`,
            })
          );
        });

        req.on('timeout', () => {
          const duration = Date.now() - startTime;
          req.destroy();
          logger.error('360Dialog test request timeout', {
            duration: `${duration}ms`,
          });
          resolve(
            reply.status(504).send({
              success: false,
              error: 'Request timeout after 60 seconds',
              duration: `${duration}ms`,
            })
          );
        });

        req.write(payload);
        req.end();
      });
    } catch (error: any) {
      logger.error('Error in 360Dialog test endpoint', {
        error: error.message,
        stack: error.stack,
      });
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // API v1 routes
  fastify.register(
    async (instance) => {
      // Messages routes
      instance.register(
        async (msgs) => messagesRoutes(msgs, controllers.messages),
        { prefix: '/messages' }
      );

      // Conversations routes
      instance.register(
        async (convs) => conversationsRoutes(convs, controllers.messages),
        { prefix: '/conversations' }
      );

      // Integrations routes (generic, API-key auth)
      instance.register(
        async (ints) => integrationsRoutes(ints, controllers.integrations),
        { prefix: '/integrations' }
      );
      
      // WebChat WebSocket route (integrated with Fastify for Azure App Service)
      // This allows WebSockets to work in Azure App Service through Fastify
      // We need to bridge Fastify WebSocket with WebChatAdapter's sendMessage functionality
      if (webchatAdapter) {
        // Map to store Fastify WebSocket connections by userId
        // This allows WebChatAdapter.sendMessage to find and send to the correct connection
        const fastifyWsConnections = new Map<string, any>();
        // Set to track which users have already received greeting message (prevent duplicates)
        const greetingSentSet = new Set<string>();
        
        instance.get('/webchat/ws', { websocket: true }, (connection, req) => {
          try {
            // Fastify WebSocket connection - connection is the WebSocket itself
            const socket = connection as any;
            const jwt = require('jsonwebtoken');
            const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
            const { generateUUID } = require('@cortex/shared');
            
            let userId: string | null = null;
            let authenticated = false;
            let tempId = generateUUID();
            const origin = req.headers.origin || 'no-origin';
            let websiteId = 'default';
            let keepaliveInterval: NodeJS.Timeout | null = null;
            
            // CRITICAL: Log immediately when handler is called
            logger.info('WebSocket handler called - connection established via Fastify', {
              tempId,
              url: req.url,
              origin,
              ip: req.ip,
              socketType: typeof socket,
              socketReadyState: socket?.readyState,
              hasSocket: !!socket,
              headers: {
                'upgrade': req.headers.upgrade,
                'connection': req.headers.connection,
                'sec-websocket-key': req.headers['sec-websocket-key'],
                'sec-websocket-version': req.headers['sec-websocket-version'],
              },
            });
            
            // Verify socket is valid
            if (!socket) {
              logger.error('WebSocket handler called but socket is null/undefined', { tempId });
              return;
            }
            
            // Log socket properties
            logger.info('WebSocket socket properties', {
              tempId,
              readyState: socket.readyState,
              hasOn: typeof socket.on === 'function',
              hasSend: typeof socket.send === 'function',
              socketKeys: Object.keys(socket).slice(0, 10),
            });
          
          // Wait for socket to be ready before sending initial message
          // WebSocket.OPEN = 1
          const sendInitialMessage = () => {
            if (socket.readyState === 1) { // OPEN
              try {
                socket.send(JSON.stringify({
                  type: 'connected',
                  message: 'WebSocket connection established',
                  tempId,
                  timestamp: new Date().toISOString(),
                }));
                logger.info('Initial connection message sent', { tempId });
              } catch (error: any) {
                logger.error('Error sending initial connection message', {
                  error: error.message,
                  errorStack: error.stack,
                  tempId,
                  readyState: socket.readyState,
                });
              }
            } else {
              // Wait a bit and retry if socket is not ready
              logger.warn('Socket not ready for initial message, waiting...', {
                tempId,
                readyState: socket.readyState,
              });
              setTimeout(() => {
                if (socket.readyState === 1) {
                  sendInitialMessage();
                } else {
                  logger.error('Socket never became ready for initial message', {
                    tempId,
                    readyState: socket.readyState,
                  });
                }
              }, 100);
            }
          };
          
          // Try to send initial message immediately or wait
          sendInitialMessage();
          
          // Authentication timeout - increased to 20 seconds to account for network latency
          // and token fetching delays
          const authTimeout = setTimeout(() => {
            if (!authenticated) {
              // Log as INFO instead of WARN - this is expected behavior when clients
              // don't authenticate (e.g., page closed before auth, network issues)
              logger.info(`Authentication timeout for connection: ${tempId}`, {
                tempId,
                userId,
                authenticated,
                socketReadyState: socket.readyState,
                wasAuthenticated: authenticated,
                closeCodeMeaning: 'Policy violation',
                note: 'Client did not authenticate within timeout period - this may be normal if client disconnected',
              });
              socket.close(1008, 'Authentication timeout');
            }
          }, 20000); // 20 seconds - increased from 10 to handle slower connections
          
          socket.on('message', async (message: Buffer) => {
            try {
              const data = JSON.parse(message.toString());
              
              logger.info('WebSocket message received', {
                tempId,
                messageType: data.type,
                authenticated,
                socketReadyState: socket.readyState,
                hasToken: !!(data.type === 'auth' && data.token),
                messageLength: message.length,
              });
              
              if (data.type === 'auth' && data.token) {
                clearTimeout(authTimeout);
                
                try {
                  logger.info('Verifying JWT token for WebSocket authentication', {
                    tempId,
                    tokenLength: data.token?.length || 0,
                    socketReadyState: socket.readyState,
                    origin,
                  });
                  
                  const decoded = jwt.verify(data.token, jwtSecret) as any;
                  userId = decoded.userId;
                  websiteId = decoded.websiteId || 'default';
                  const flowId = decoded.flowId || null;
                  authenticated = true;
                  
                  logger.info('JWT token verified successfully', {
                    tempId,
                    userId,
                    websiteId,
                    flowId: decoded.flowId || 'NOT_IN_JWT',
                    decodedKeys: Object.keys(decoded),
                    socketReadyState: socket.readyState,
                  });
                  
                  // Store connection for sendMessage to use
                  if (userId) {
                    fastifyWsConnections.set(userId, socket);
                    logger.info('WebSocket connection stored in map', {
                      tempId,
                      userId,
                      totalConnections: fastifyWsConnections.size,
                      socketReadyState: socket.readyState,
                    });
                  }
                  
                  logger.info('WebSocket authenticated via Fastify', { userId, tempId, websiteId });
                  
                  // Start keepalive ping to prevent Azure App Service timeout (230 seconds)
                  // Send ping every 60 seconds to keep connection alive
                  if (keepaliveInterval) {
                    clearInterval(keepaliveInterval);
                  }
                  keepaliveInterval = setInterval(() => {
                    if (socket.readyState === 1 && authenticated) { // WebSocket.OPEN = 1
                      try {
                        socket.send(JSON.stringify({ type: 'ping' }));
                        logger.debug('Keepalive ping sent', { userId, tempId });
                      } catch (error: any) {
                        logger.debug('Error sending keepalive ping', {
                          error: error.message,
                          userId,
                          tempId,
                          readyState: socket.readyState,
                        });
                        // Clear interval if socket is closed
                        if (socket.readyState !== 1) {
                          if (keepaliveInterval) {
                            clearInterval(keepaliveInterval);
                            keepaliveInterval = null;
                          }
                        }
                      }
                    } else {
                      // Socket is not open, clear interval
                      if (keepaliveInterval) {
                        clearInterval(keepaliveInterval);
                        keepaliveInterval = null;
                      }
                    }
                  }, 60000); // Every 60 seconds
                  
                  // Send authentication success - check socket is still open
                  if (socket.readyState === 1) { // OPEN
                    try {
                      const authSuccessMessage = JSON.stringify({
                        type: 'auth_success',
                        userId,
                        websiteId,
                        timestamp: new Date().toISOString(),
                      });
                      socket.send(authSuccessMessage);
                      logger.info('auth_success message sent successfully', {
                        tempId,
                        userId,
                        messageLength: authSuccessMessage.length,
                      });
                    } catch (sendError: any) {
                      logger.error('Error sending auth_success message', {
                        error: sendError.message,
                        errorStack: sendError.stack,
                        userId,
                        tempId,
                        readyState: socket.readyState,
                      });
                      // Don't close the socket here - let it continue
                    }
                    
                    // Send greeting message if configured for this flow
                    // Use setTimeout to ensure client is ready to receive the message
                    if (db && websiteId && userId) {
                      // Small delay to ensure client has processed auth_success
                      setTimeout(async () => {
                        try {
                          // First, try to get greeting message directly by flowId (fastest)
                          // Then check if user has existing messages to decide whether to send
                          let greetingMessage = null;
                          let greetingResult = null;
                          
                          logger.info('🔍 Starting greeting message lookup', {
                            userId,
                            websiteId,
                            flowIdFromJWT: flowId,
                          });
                          
                          // Check if user already has messages in a conversation (in parallel)
                          // Note: conversations table doesn't have instance_identifier column
                          // We check by channel and channel_user_id only
                          const existingMessagesPromise = db.query(`
                            SELECT COUNT(*) as message_count
                            FROM messages m
                            JOIN conversations conv ON m.conversation_id = conv.id
                            WHERE conv.channel = 'webchat'
                              AND conv.channel_user_id = $1
                          `, [userId]);
                          
                          // Strategy 1: If flowId is available in JWT, use it directly (most reliable)
                          if (flowId) {
                            try {
                              greetingResult = await db.query(`
                                SELECT f.greeting_message, f.id as flow_id, f.name as flow_name, f.active
                                FROM orchestration_flows f
                                WHERE f.id = $1
                              `, [flowId]);
                              
                              logger.info('📋 Greeting query by flowId result', {
                                flowId,
                                rowsFound: greetingResult.rows.length,
                                flowActive: greetingResult.rows[0]?.active,
                                greetingMessage: greetingResult.rows[0]?.greeting_message,
                                greetingIsNull: greetingResult.rows[0]?.greeting_message === null,
                                greetingIsEmpty: greetingResult.rows[0]?.greeting_message === '',
                                greetingLength: greetingResult.rows[0]?.greeting_message?.length,
                              });
                              
                              if (greetingResult.rows.length > 0 && 
                                  greetingResult.rows[0].greeting_message && 
                                  greetingResult.rows[0].greeting_message.trim() !== '') {
                                greetingMessage = greetingResult.rows[0].greeting_message;
                              }
                            } catch (err: any) {
                              logger.error('❌ Error querying greeting by flowId', {
                                error: err.message,
                                errorStack: err.stack,
                                flowId,
                              });
                            }
                          }
                          
                          // Strategy 2: Fallback - Find flow by channel_id
                          if (!greetingMessage && websiteId) {
                            try {
                              // websiteId should now be the channel_id (UUID)
                              greetingResult = await db.query(`
                                SELECT f.greeting_message, f.id as flow_id, f.name as flow_name, f.active
                                FROM orchestration_flows f
                                JOIN flow_channels fc ON f.id = fc.flow_id AND fc.active = true
                                JOIN channel_configs c ON fc.channel_id = c.id
                                WHERE c.channel_type = 'webchat' 
                                  AND c.id = $1
                                  AND f.active = true
                                  AND c.is_active = true
                                ORDER BY f.priority ASC
                                LIMIT 1
                              `, [websiteId]);
                              
                              logger.info('📋 Greeting query by channel_id result', {
                                channelId: websiteId,
                                rowsFound: greetingResult.rows.length,
                                flowId: greetingResult.rows[0]?.flow_id,
                                flowName: greetingResult.rows[0]?.flow_name,
                                flowActive: greetingResult.rows[0]?.active,
                                greetingMessage: greetingResult.rows[0]?.greeting_message,
                                greetingIsNull: greetingResult.rows[0]?.greeting_message === null,
                                greetingIsEmpty: greetingResult.rows[0]?.greeting_message === '',
                                greetingLength: greetingResult.rows[0]?.greeting_message?.length,
                              });
                              
                              if (greetingResult.rows.length > 0 && 
                                  greetingResult.rows[0].greeting_message && 
                                  greetingResult.rows[0].greeting_message.trim() !== '') {
                                greetingMessage = greetingResult.rows[0].greeting_message;
                              }
                            } catch (err: any) {
                              logger.error('❌ Error querying greeting by channel_id', {
                                error: err.message,
                                errorStack: err.stack,
                                websiteId,
                              });
                            }
                          }
                          
                          // Check if user has existing messages
                          const existingMessagesResult = await existingMessagesPromise;
                          const hasExistingMessages = parseInt(existingMessagesResult.rows[0]?.message_count || '0') > 0;
                          
                          logger.info('📊 Conversation status', {
                            userId,
                            websiteId,
                            hasExistingMessages,
                            messageCount: existingMessagesResult.rows[0]?.message_count,
                            hasGreetingMessage: !!greetingMessage,
                          });
                          
                          // Only send greeting if this is a new conversation AND we have a greeting message
                          // Also check if greeting was already sent to prevent duplicates
                          const greetingAlreadySent = userId ? greetingSentSet.has(userId) : false;
                          
                          logger.info('🎯 Greeting decision', {
                            userId,
                            websiteId,
                            flowId,
                            hasExistingMessages,
                            hasGreetingMessage: !!greetingMessage,
                            greetingMessageLength: greetingMessage?.length || 0,
                            socketReadyState: socket?.readyState,
                            socketExists: !!socket,
                            greetingAlreadySent,
                            willSendGreeting: !hasExistingMessages && !!greetingMessage && socket?.readyState === 1 && !greetingAlreadySent,
                          });
                          
                          if (!hasExistingMessages && greetingMessage && !greetingAlreadySent && userId) {
                            // Check socket is still open before sending
                            if (socket && socket.readyState === 1) { // OPEN
                              try {
                                // Mark greeting as sent to prevent duplicates
                                greetingSentSet.add(userId);
                                
                                // Send greeting as a message from the assistant
                                const greetingPayload = JSON.stringify({
                                  type: 'message',
                                  content: greetingMessage,
                                  timestamp: new Date().toISOString(),
                                });
                                
                                socket.send(greetingPayload);
                                
                                logger.info('✅ Greeting message sent successfully', {
                                  userId,
                                  websiteId,
                                  flowId,
                                  greetingLength: greetingMessage.length,
                                  greetingPreview: greetingMessage.substring(0, 50),
                                  socketReadyState: socket.readyState,
                                  payloadLength: greetingPayload.length,
                                });
                                
                                // Remove from set after 5 seconds to allow reconnection greeting
                                setTimeout(() => {
                                  if (userId) greetingSentSet.delete(userId);
                                }, 5000);
                              } catch (sendError: any) {
                                // Remove from set on error so it can be retried
                                if (userId) greetingSentSet.delete(userId);
                                logger.error('❌ Error sending greeting message via socket', {
                                  userId,
                                  websiteId,
                                  flowId,
                                  error: sendError.message,
                                  errorStack: sendError.stack,
                                  socketReadyState: socket.readyState,
                                });
                              }
                            } else {
                              logger.warn('❌ Socket not open when trying to send greeting', {
                                userId,
                                websiteId,
                                flowId,
                                socketReadyState: socket?.readyState,
                                socketExists: !!socket,
                              });
                            }
                          } else {
                            // Determine why greeting is not being sent
                            if (hasExistingMessages) {
                              logger.info('⏭️ Skipping greeting message - user already has messages', {
                                userId,
                                websiteId,
                                messageCount: existingMessagesResult.rows[0]?.message_count,
                                hasGreetingMessage: !!greetingMessage,
                              });
                            } else if (greetingAlreadySent) {
                              logger.info('⏭️ Skipping greeting message - already sent to this user', {
                                userId,
                                websiteId,
                                flowId,
                                hasGreetingMessage: !!greetingMessage,
                              });
                            } else if (!greetingMessage) {
                              logger.warn('⚠️ No greeting message found or empty', {
                                userId,
                                websiteId,
                                flowId,
                                hasFlowId: !!flowId,
                                queryResultRows: greetingResult?.rows?.length || 0,
                              });
                            } else {
                              logger.warn('⚠️ Greeting message not sent - unknown reason', {
                                userId,
                                websiteId,
                                flowId,
                                hasExistingMessages,
                                hasGreetingMessage: !!greetingMessage,
                                greetingAlreadySent,
                                socketReadyState: socket?.readyState,
                              });
                            }
                          }
                        } catch (greetingError: any) {
                          logger.error('Error sending greeting message', {
                            error: greetingError.message,
                            errorStack: greetingError.stack,
                            userId,
                            websiteId,
                          });
                          // Don't fail the connection if greeting fails
                        }
                      }, 200); // 200ms delay to ensure client is ready
                    }
                  } else {
                    logger.error('Socket not open when trying to send auth_success', {
                      userId,
                      tempId,
                      readyState: socket.readyState,
                      socketState: socket.readyState === 0 ? 'CONNECTING' :
                                   socket.readyState === 1 ? 'OPEN' :
                                   socket.readyState === 2 ? 'CLOSING' : 'CLOSED',
                    });
                  }
                } catch (error: any) {
                  logger.error('WebSocket authentication failed via Fastify', { 
                    error: error.message,
                    errorStack: error.stack,
                    errorName: error.name,
                    tempId,
                    origin,
                    socketReadyState: socket.readyState,
                  });
                  
                  // Only send error and close if socket is still open
                  if (socket.readyState === 1) {
                    try {
                      socket.send(JSON.stringify({
                        type: 'error',
                        message: 'Authentication failed',
                      }));
                      // Give client a moment to receive the error before closing
                      setTimeout(() => {
                        if (socket.readyState === 1) {
                          socket.close(1008, 'Authentication failed');
                        }
                      }, 100);
                    } catch (closeError: any) {
                      logger.error('Error closing socket after auth failure', {
                        error: closeError.message,
                        tempId,
                        readyState: socket.readyState,
                      });
                    }
                  } else {
                    logger.warn('Socket already closed when auth failed', {
                      tempId,
                      readyState: socket.readyState,
                    });
                  }
                }
              } else if (data.type === 'message' && authenticated && userId) {
                // Forward message to WebChatAdapter's default handler
                // The WebChatAdapter will process this through processWebChatMessage
                if (webchatAdapter && webchatAdapter.defaultMessageHandler) {
                  const normalizedMessage = {
                    id: data.messageId || generateUUID(),
                    conversationId: userId,
                    channelType: 'webchat',
                    channelUserId: userId,
                    role: 'user' as const,
                    content: data.content,
                    timestamp: new Date().toISOString(),
                    metadata: {
                      messageId: data.messageId,
                      channelId: websiteId, // websiteId is now channel_id (UUID)
                      channel_config_id: websiteId,
                      websiteId: websiteId, // Keep for backward compatibility
                    },
                  };
                  
                  // Call the default message handler
                  const handlerResult = webchatAdapter.defaultMessageHandler(normalizedMessage);
                  if (handlerResult instanceof Promise) {
                    handlerResult.catch((error: any) => {
                      logger.error('Error in WebChat message handler', { error: error.message });
                    });
                  }
                  
                  // Send acknowledgment
                  socket.send(JSON.stringify({
                    type: 'message_received',
                    messageId: data.messageId || normalizedMessage.id,
                    timestamp: normalizedMessage.timestamp,
                  }));
                } else {
                  logger.warn('WebChatAdapter defaultMessageHandler not available');
                  socket.send(JSON.stringify({
                    type: 'error',
                    message: 'Message handler not available',
                  }));
                }
              } else if (data.type === 'ping') {
                socket.send(JSON.stringify({ type: 'pong' }));
              } else if (!authenticated) {
                socket.send(JSON.stringify({
                  type: 'error',
                  message: 'Not authenticated',
                }));
              }
            } catch (error: any) {
              logger.error('Error processing WebSocket message via Fastify', { 
                error: error.message,
                userId,
                tempId,
              });
              socket.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
              }));
            }
          });
          
          socket.on('close', (code: number, reason: Buffer) => {
            clearTimeout(authTimeout);
            // Clear keepalive interval
            if (keepaliveInterval) {
              clearInterval(keepaliveInterval);
              keepaliveInterval = null;
            }
            if (userId) {
              fastifyWsConnections.delete(userId);
            }
            
            // Determine close code meaning
            const closeCodeMeaning = code === 1000 ? 'Normal closure' :
                                   code === 1001 ? 'Going away' :
                                   code === 1002 ? 'Protocol error' :
                                   code === 1003 ? 'Unsupported data' :
                                   code === 1006 ? 'Abnormal closure (no close frame)' :
                                   code === 1008 ? 'Policy violation' :
                                   code === 1009 ? 'Message too big' :
                                   code === 1011 ? 'Server error' :
                                   `Unknown (${code})`;
            
            // Log level based on close code and authentication status
            // Code 1006 is common and expected when:
            // - User closes browser tab/window
            // - Network connection is lost
            // - Azure App Service timeout
            // Code 1008 with "Authentication timeout" is expected when:
            // - Client doesn't send auth message within timeout period
            // - Client closes connection before authenticating
            // - Network issues prevent auth message from arriving
            // Only log as WARN for actual errors, not normal disconnections
            const isNormalClosure = code === 1000 || code === 1001;
            const isAbnormalButExpected = code === 1006 && authenticated; // 1006 is common for tab closes
            const isAuthTimeout = code === 1008 && reason.toString().includes('Authentication timeout');
            const isError = code === 1002 || code === 1003 || code === 1009 || code === 1011 || 
                          (code === 1008 && !isAuthTimeout); // 1008 is error only if not auth timeout
            
            const logData = {
              userId,
              tempId,
              code,
              reason: reason.toString(),
              authenticated,
              wasAuthenticated: authenticated,
              closeCodeMeaning,
            };
            
            if (isAuthTimeout) {
              // Authentication timeouts are expected in some cases (client closes before auth, network issues)
              // Log as INFO instead of WARN to reduce noise
              logger.info('WebSocket connection closed: Authentication timeout (may be normal if client disconnected)', {
                ...logData,
                note: 'This can happen if client closes before completing authentication or network issues occur',
              });
            } else if (isError) {
              // Real errors should be logged as WARN/ERROR
              logger.warn('WebSocket connection closed with error code', logData);
            } else if (isNormalClosure) {
              // Normal closures can be logged as INFO
              logger.info('WebSocket connection closed normally', logData);
            } else if (isAbnormalButExpected) {
              // 1006 with authenticated connection is usually user closing tab - log as DEBUG
              logger.debug('WebSocket connection closed (likely user closed tab/browser)', logData);
            } else {
              // Other cases (1006 without auth, etc.) - log as INFO
              logger.info('WebSocket connection closed', logData);
            }
          });
          
          socket.on('error', (error: Error) => {
            logger.error('WebSocket error via Fastify', {
              error: error.message,
              errorStack: error.stack,
              errorName: error.name,
              userId,
              tempId,
              authenticated,
              socketReadyState: socket.readyState,
            });
            
            // Close socket on error if still open
            if (socket.readyState === 1) {
              try {
                socket.close(1011, `Server error: ${error.message}`);
              } catch (closeError: any) {
                logger.error('Error closing socket after error event', {
                  error: closeError.message,
                  tempId,
                });
              }
            }
          });
          
          // Log initial socket state to help diagnose connection issues
          const socketState = socket.readyState;
          logger.info('WebSocket socket state after connection handler', {
            tempId,
            readyState: socketState,
            // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
            readyStateText: socketState === 0 ? 'CONNECTING' : 
                           socketState === 1 ? 'OPEN' : 
                           socketState === 2 ? 'CLOSING' : 'CLOSED',
          });
          } catch (handlerError: any) {
            logger.error('CRITICAL: Error in WebSocket handler setup', {
              error: handlerError.message,
              errorStack: handlerError.stack,
              errorName: handlerError.name,
            });
            // Try to close the connection if it exists
            try {
              if (connection && typeof (connection as any).close === 'function') {
                (connection as any).close(1011, `Handler setup error: ${handlerError.message}`);
              }
            } catch (closeError: any) {
              logger.error('Error closing socket after handler setup error', {
                error: closeError.message,
              });
            }
          }
        });
        
        // Override WebChatAdapter's sendMessage to use Fastify WebSocket connections
        // This allows the adapter to send messages back to clients
        const originalSendMessage = webchatAdapter.sendMessage.bind(webchatAdapter);
        webchatAdapter.sendMessage = async (userId: string, message: any) => {
          const fastifySocket = fastifyWsConnections.get(userId);
          if (fastifySocket && fastifySocket.readyState === 1) { // WebSocket.OPEN = 1
            try {
              fastifySocket.send(JSON.stringify({
                type: 'message',
                content: message.content,
                metadata: message.metadata,
                timestamp: new Date().toISOString(),
              }));
              logger.debug(`Sent message to user via Fastify WebSocket: ${userId}`);
            } catch (error: any) {
              logger.error(`Failed to send message to user ${userId} via Fastify WebSocket`, { 
                error: error.message 
              });
              // Fallback to original method if available
              if (webchatAdapter.clients && webchatAdapter.clients.has(userId)) {
                return originalSendMessage(userId, message);
              }
              throw error;
            }
          } else {
            // Fallback to original method if Fastify connection not found
            logger.debug(`Fastify WebSocket not found for ${userId}, using original sendMessage`);
            return originalSendMessage(userId, message);
          }
        };
      }
    },
    { prefix: '/api/v1' }
  );

  // Webhooks routes
  fastify.register(
    async (instance) => webhooksRoutes(instance, controllers.webhooks),
    { prefix: '/webhooks' }
  );

  // Admin routes
  fastify.register(
    async (instance) => adminRoutes(instance, controllers.admin),
    { prefix: '/api/admin' }
  );

  // Services routes
  fastify.register(
    async (instance) => servicesRoutes(instance, controllers.services),
    { prefix: '/api/services' }
  );

  // Knowledge Bases routes
  fastify.register(
    async (instance) => knowledgeBasesRoutes(instance, controllers.knowledgeBases),
    { prefix: '/api/admin/knowledge-bases' }
  );

  // Flow Knowledge Bases routes
  fastify.register(
    async (instance) => flowKnowledgeBasesRoutes(instance, controllers.knowledgeBases),
    { prefix: '/api/admin/flows' }
  );

  // Embedding Models routes
  fastify.register(
    async (instance) => embeddingModelsRoutes(instance, controllers.knowledgeBases),
    { prefix: '/api/admin/embedding-models' }
  );


  // Public Widget Config route (no auth required)
  // IMPORTANT: These routes must be registered BEFORE any global hooks
  // Disable CORS plugin for these routes and handle manually
  fastify.options('/api/widgets/:widgetKey/config', {
    preHandler: async (request, reply) => {
      const origin = request.headers.origin;
      logger.info('OPTIONS preflight for widget config', { origin, url: request.url });
      
      // Set CORS headers in preHandler
      // Azure App Service handles CORS with supportCredentials: false
      // So we don't set Access-Control-Allow-Credentials to avoid conflicts
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
    },
    onResponse: async (request, reply) => {
      // Ensure headers are still set in onResponse
      const origin = request.headers.origin;
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
    }
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Max-Age', '86400');
    return reply.code(204).send();
  });
  
  fastify.get('/api/widgets/:widgetKey/config', {
    preHandler: async (request, reply) => {
      const origin = request.headers.origin;
      logger.info('GET widget config preHandler', { origin, url: request.url });
      
      // Set CORS headers in preHandler
      // Azure App Service handles CORS with supportCredentials: false
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    },
    onResponse: async (request, reply) => {
      // Ensure headers are still set in onResponse
      const origin = request.headers.origin;
      logger.info('GET widget config onResponse', { 
        origin, 
        url: request.url,
        statusCode: reply.statusCode,
        headersSet: reply.getHeader('Access-Control-Allow-Origin'),
      });
      
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  }, async (request, reply) => {
    // Set CORS headers BEFORE calling controller
    // Azure App Service handles CORS with supportCredentials: false
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return controllers.admin.getWidgetConfig(request as any, reply);
  });

  // Handle OPTIONS preflight for widget.js CORS
  fastify.options('/widget.js', {
    onResponse: async (request, reply) => {
      const origin = request.headers.origin;
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400'); // 24 hours
    }
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Max-Age', '86400');
    return reply.code(204).send();
  });

  // Serve widget.js file
  fastify.get('/widget.js', {
    onResponse: async (request, reply) => {
      // Ensure CORS headers are set in onResponse hook
      const origin = request.headers.origin;
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
    }
  }, async (request, reply) => {
    // Set CORS headers for widget.js
    // Azure App Service handles CORS with supportCredentials: false
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Max-Age', '86400'); // 24 hours
    
    const fs = require('fs');
    const path = require('path');
    try {
      // Try multiple possible paths for widget.js
      // In development: src/routes/index.ts -> ../../public/widget.js
      // In production: dist/routes/index.js -> ../../public/widget.js
      // Also try absolute path from process.cwd()
      const possiblePaths = [
        path.join(__dirname, '../../public/widget.js'),
        path.join(process.cwd(), 'backend/api-service/public/widget.js'),
        path.join(process.cwd(), 'packages/api-service/public/widget.js'), // Legacy path
        path.join(process.cwd(), 'public/widget.js'),
        path.join(__dirname, '../../../public/widget.js'),
      ];
      
      let widgetCode: string | null = null;
      let lastError: Error | null = null;
      
      for (const widgetPath of possiblePaths) {
        try {
          if (fs.existsSync(widgetPath)) {
            widgetCode = fs.readFileSync(widgetPath, 'utf8');
            break;
          }
        } catch (error: any) {
          lastError = error;
          continue;
        }
      }
      
      if (!widgetCode) {
        throw new Error(`Widget file not found. Tried paths: ${possiblePaths.join(', ')}. Last error: ${lastError?.message || 'unknown'}`);
      }
      
      reply.type('application/javascript').send(widgetCode);
    } catch (error: any) {
      logger.error('Failed to serve widget.js', { error: error.message, stack: error.stack });
      reply.code(404).send({ error: 'Widget file not found' });
    }
  });

  // Handle OPTIONS preflight for WebChat auth CORS
  fastify.options('/api/v1/webchat/auth', {
    onResponse: async (request, reply) => {
      const origin = request.headers.origin;
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400'); // 24 hours
    }
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Max-Age', '86400');
    return reply.code(204).send();
  });

  // WebChat authentication endpoint for widgets
  fastify.post('/api/v1/webchat/auth', {
    onResponse: async (request, reply) => {
      // Ensure CORS headers are set in onResponse hook
      // Azure App Service handles CORS with supportCredentials: false
      const origin = request.headers.origin;
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
      } else {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
    }
  }, async (request, reply) => {
    // Set CORS headers for WebChat auth
    // Azure App Service handles CORS with supportCredentials: false
    const origin = request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Max-Age', '86400'); // 24 hours
    
    const { userId, websiteId, flowId } = request.body as { userId: string; websiteId: string; flowId?: string };
    const fastifyInstance = request.server as any;
    
    if (!fastifyInstance.jwt || typeof fastifyInstance.jwt.sign !== 'function') {
      reply.code(500).send({ error: 'JWT not configured' });
      return;
    }

    try {
      const token = fastifyInstance.jwt.sign({
        userId: userId,
        websiteId: websiteId || 'default',
        flowId: flowId || null, // Include flowId in JWT for direct greeting lookup
        timestamp: Date.now(),
      }, {
        expiresIn: '24h',
      });

      reply.send({ success: true, token });
    } catch (error: any) {
      reply.code(500).send({ error: error.message });
    }
  });
}
