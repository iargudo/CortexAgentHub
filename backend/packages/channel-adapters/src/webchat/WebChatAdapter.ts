import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import {
  ChannelType,
  NormalizedMessage,
  OutgoingMessage,
  WebChatConfig,
  ChannelError,
  ERROR_CODES,
  generateUUID,
} from '@cortex/shared';
import { BaseChannelAdapter } from '../base/BaseChannelAdapter';

interface WebChatClient {
  ws: WebSocket;
  userId: string;
  authenticated: boolean;
  connectedAt: Date;
  lastActivity: Date;
  metadata?: {
    websiteId?: string;
    [key: string]: any;
  };
}

interface WebChatMessage {
  type: 'auth' | 'message' | 'ping' | 'pong';
  token?: string;
  content?: string;
  messageId?: string;
  timestamp?: string;
}

/**
 * WebChat adapter using WebSocket for real-time communication
 */
export class WebChatAdapter extends BaseChannelAdapter {
  readonly channelType = ChannelType.WEBCHAT;

  private wss!: WebSocketServer;
  private clients: Map<string, WebChatClient> = new Map();
  private messageHandlers: Map<string, (message: NormalizedMessage) => void> = new Map();
  private defaultMessageHandler?: (message: NormalizedMessage) => void | Promise<void>;
  private heartbeatInterval!: NodeJS.Timeout;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);
    this.config = config.config as WebChatConfig;

    // Check if we should use Fastify WebSocket instead of creating a separate server
    const useFastifyWebSocket = (config.config as any)?.useFastifyWebSocket === true;
    
    if (useFastifyWebSocket) {
      // Skip creating separate WebSocket server - Fastify will handle it
      this.logger.info('WebChat adapter initialized to use Fastify WebSocket (no separate server)');
      // Still start heartbeat for connection management
      this.startHeartbeat();
      return;
    }

    // Create WebSocket server (legacy mode for backward compatibility)
    try {
      this.wss = new WebSocketServer({
        port: this.config.wsPort,
        verifyClient: (info: any) => {
          // Check origin
          const origin = info.origin || info.req.headers.origin;
          
          // Log connection attempt for debugging
          this.logger.debug('WebSocket connection attempt', { 
            origin,
            allowedOrigins: this.config.allowedOrigins,
            url: info.req.url,
            headers: Object.keys(info.req.headers),
          });
          
          // If no allowed origins configured or '*' is in the list, allow all
          if (this.config.allowedOrigins.length === 0 || this.config.allowedOrigins.includes('*')) {
            this.logger.debug('WebSocket connection allowed: wildcard or no restrictions', { origin });
            return true;
          }
          
          // If origin is not provided, allow connection (for same-origin requests)
          if (!origin) {
            this.logger.debug('WebSocket connection allowed: no origin provided (same-origin)');
            return true;
          }
          
          // Check if origin is in allowed list
          const isAllowed = this.config.allowedOrigins.includes(origin);
          if (!isAllowed) {
            this.logger.warn('WebSocket connection rejected: origin not allowed', { 
              origin, 
              allowedOrigins: this.config.allowedOrigins 
            });
          } else {
            this.logger.debug('WebSocket connection allowed: origin in allowed list', { origin });
          }
          return isAllowed;
        },
      });

      this.setupWebSocketServer();
      this.startHeartbeat();

      this.logger.info(`WebChat adapter listening on port ${this.config.wsPort}`);
    } catch (error: any) {
      this.logger.error('Failed to initialize WebSocket server', { 
        error: error.message,
        port: this.config.wsPort,
        stack: error.stack,
      });
      throw error;
    }
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const tempId = generateUUID();
      const origin = req.headers.origin || 'no-origin';

      this.logger.info(`New WebSocket connection: ${tempId}`, { 
        origin,
        remoteAddress: req.socket.remoteAddress,
        url: req.url,
        readyState: ws.readyState,
      });
      
      // Store temp connection for authentication timeout check
      this.clients.set(tempId, {
        ws,
        userId: tempId,
        authenticated: false,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      // Wait for authentication
      const authTimeout = setTimeout(() => {
        if (!this.isClientAuthenticated(tempId)) {
          this.logger.warn(`Authentication timeout for connection: ${tempId}`);
          ws.close(1008, 'Authentication timeout');
        }
      }, 10000); // 10 seconds to authenticate

      ws.on('message', async (data: Buffer) => {
        try {
          const message: WebChatMessage = JSON.parse(data.toString());

          switch (message.type) {
            case 'auth':
              clearTimeout(authTimeout);
              await this.handleAuthentication(ws, tempId, message);
              break;

            case 'message':
              await this.handleIncomingMessage(ws, message);
              break;

            case 'ping':
              this.handlePing(ws);
              break;

            default:
              this.logger.warn(`Unknown message type: ${message.type}`);
          }
        } catch (error: any) {
          this.logger.error('Error handling WebSocket message', { error: error.message });
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', (code, reason) => {
        clearTimeout(authTimeout);
        this.logger.info(`WebSocket connection closed: ${tempId}`, {
          code,
          reason: reason.toString(),
          authenticated: this.isClientAuthenticated(tempId),
        });
        this.handleDisconnection(tempId);
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { 
          error: error.message,
          tempId,
          origin,
          readyState: ws.readyState,
          stack: error.stack,
        });
      });
    });

    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error', { error: error.message, stack: error.stack });
    });

    this.wss.on('listening', () => {
      this.logger.info(`WebSocket server is listening on port ${this.config.wsPort}`);
    });

    this.wss.on('headers', (headers, req) => {
      this.logger.debug('WebSocket upgrade headers', { 
        origin: req.headers.origin,
        headers: Object.keys(headers),
      });
    });
  }

  private async handleAuthentication(
    ws: WebSocket,
    tempId: string,
    message: WebChatMessage
  ): Promise<void> {
    try {
      if (!message.token) {
        throw new Error('Token is required');
      }

      // Verify JWT token
      const decoded = jwt.verify(message.token, this.config.jwtSecret) as {
        userId: string;
        websiteId?: string;
        [key: string]: any;
      };

      const userId = decoded.userId;
      const websiteId = decoded.websiteId || 'default';

      // Remove temp connection
      this.clients.delete(tempId);

      // Create authenticated client
      const client: WebChatClient = {
        ws,
        userId,
        authenticated: true,
        connectedAt: new Date(),
        lastActivity: new Date(),
        metadata: {
          websiteId,
        },
      };

      this.clients.set(userId, client);
      this.createOrUpdateSession(userId);

      this.logger.info(`User authenticated: ${userId}`, { websiteId });

      // Send authentication success
      this.sendToClient(ws, {
        type: 'auth_success',
        userId,
        websiteId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      this.logger.warn('Authentication failed', { error: error.message });
      this.sendError(ws, 'Authentication failed');
      ws.close(1008, 'Authentication failed');
    }
  }

  private async handleIncomingMessage(ws: WebSocket, message: WebChatMessage): Promise<void> {
    const client = this.getClientByWebSocket(ws);

    if (!client || !client.authenticated) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    if (!message.content) {
      this.sendError(ws, 'Message content is required');
      return;
    }

    // Update activity
    client.lastActivity = new Date();

    // Extract channelId from client metadata (websiteId is now channel_id UUID)
    const channelId = client.metadata?.websiteId || client.metadata?.channelId;

    // Create normalized message with channelId for routing
    const normalizedMessage = this.normalizeMessage(
      client.userId, // Use userId as conversationId for now
      client.userId,
      message.content,
      { 
        messageId: message.messageId,
        channelId: channelId,      // Channel UUID for routing
        channel_config_id: channelId, // Alias for consistency
        websiteId: channelId        // Keep for backward compatibility
      }
    );

    // Call message handler if registered
    const handler = this.messageHandlers.get(client.userId);
    if (handler) {
      handler(normalizedMessage);
    } else if (this.defaultMessageHandler) {
      // Call default handler if no specific handler is registered
      const result = this.defaultMessageHandler(normalizedMessage);
      if (result instanceof Promise) {
        result.catch((error) => {
          this.logger.error('Error in default message handler', { error: error.message });
        });
      }
    }

    // Send acknowledgment
    this.sendToClient(ws, {
      type: 'message_received',
      messageId: message.messageId || normalizedMessage.id,
      timestamp: normalizedMessage.timestamp,
    });

    this.logger.debug(`Received message from user: ${client.userId}`, { channelId });
  }

  private handlePing(ws: WebSocket): void {
    this.sendToClient(ws, { type: 'pong', timestamp: new Date().toISOString() });
  }

  private handleDisconnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.logger.info(`User disconnected: ${client.userId}`);
      this.clients.delete(clientId);
    }
  }

  private getClientByWebSocket(ws: WebSocket): WebChatClient | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) {
        return client;
      }
    }
    return undefined;
  }

  private isClientAuthenticated(tempId: string): boolean {
    const client = this.clients.get(tempId);
    return client ? client.authenticated : false;
  }

  private sendToClient(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.sendToClient(ws, {
      type: 'error',
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [userId, client] of this.clients.entries()) {
        // Check if client is inactive for more than 5 minutes
        const inactiveTime = now - client.lastActivity.getTime();

        if (inactiveTime > 300000) {
          // 5 minutes
          this.logger.info(`Closing inactive connection: ${userId}`);
          client.ws.close(1000, 'Inactive');
          this.clients.delete(userId);
        } else if (client.ws.readyState === WebSocket.OPEN) {
          // Send ping
          this.sendToClient(client.ws, { type: 'ping' });
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Register a message handler for a specific user
   */
  public onMessage(userId: string, handler: (message: NormalizedMessage) => void): void {
    this.messageHandlers.set(userId, handler);
  }

  /**
   * Send a message to a specific user
   */
  async sendMessage(userId: string, message: OutgoingMessage): Promise<void> {
    this.ensureInitialized();

    const client = this.clients.get(userId);

    if (!client || !client.authenticated) {
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `User ${userId} is not connected`
      );
    }

    if (client.ws.readyState !== WebSocket.OPEN) {
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `WebSocket connection is not open for user ${userId}`
      );
    }

    try {
      this.sendToClient(client.ws, {
        type: 'message',
        content: message.content,
        metadata: message.metadata,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(`Sent message to user: ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send message to user ${userId}`, { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send message: ${error.message}`
      );
    }
  }

  /**
   * Receive and normalize a message (for compatibility)
   */
  receiveMessage(payload: any): NormalizedMessage {
    // This is handled via WebSocket events, but implementing for interface compliance
    return this.normalizeMessage(
      payload.userId || 'unknown',
      payload.userId || 'unknown',
      payload.content || '',
      payload.metadata
    );
  }

  /**
   * WebChat doesn't use webhooks, return null
   */
  async handleWebhook(_payload: any): Promise<NormalizedMessage | null> {
    return null;
  }

  /**
   * Register a default message handler that will be called for all users
   * when no specific handler is registered for that user
   */
  public onDefaultMessage(handler: (message: NormalizedMessage) => void | Promise<void>): void {
    this.defaultMessageHandler = handler;
  }

  /**
   * Check if the WebSocket server is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.wss !== undefined && this.initialized;
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down WebChat adapter');

    // Clear heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all client connections
    for (const [userId, client] of this.clients.entries()) {
      client.ws.close(1000, 'Server shutting down');
      this.clients.delete(userId);
    }

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve, reject) => {
        this.wss.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    this.logger.info('WebChat adapter shut down successfully');
  }

  /**
   * Get connected users
   */
  getConnectedUsers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcast message to all connected users (admin feature)
   */
  async broadcast(message: string): Promise<void> {
    for (const [userId, client] of this.clients.entries()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(client.ws, {
          type: 'broadcast',
          content: message,
          timestamp: new Date().toISOString(),
        });
      }
    }
    this.logger.info(`Broadcast message sent to ${this.clients.size} users`);
  }
}
