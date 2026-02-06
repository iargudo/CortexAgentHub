import axios, { AxiosInstance } from 'axios';
import https from 'https';
import {
  ChannelType,
  NormalizedMessage,
  OutgoingMessage,
  WhatsAppConfig,
  WhatsAppWebhookPayload,
  ChannelError,
  ERROR_CODES,
  generateUUID,
} from '@cortex/shared';
import { BaseChannelAdapter } from '../base/BaseChannelAdapter';

/**
 * WhatsApp adapter using Ultramsg API
 * Can also be adapted for Twilio by changing the API implementation
 */
export class WhatsAppAdapter extends BaseChannelAdapter {
  readonly channelType = ChannelType.WHATSAPP;

  private client!: AxiosInstance;
  private baseUrl!: string;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);
    this.config = config.config as WhatsAppConfig;

    // Setup based on provider
    if (this.config.provider === 'ultramsg') {
      this.baseUrl = `https://api.ultramsg.com/${this.config.instanceId}`;
      this.client = axios.create({
        baseURL: this.baseUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        params: {
          token: this.config.apiToken,
        },
      });
    } else if (this.config.provider === 'twilio') {
      this.baseUrl = 'https://api.twilio.com/2010-04-01';
      this.client = axios.create({
        baseURL: this.baseUrl,
        auth: {
          username: this.config.accountSid!,
          password: this.config.authToken!,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } else if (this.config.provider === '360dialog') {
      // 360dialog uses WhatsApp Business Cloud API
      // Base URL: https://waba-v2.360dialog.io (official endpoint per 360Dialog support)
      this.baseUrl = 'https://waba-v2.360dialog.io';
      this.client = axios.create({
        baseURL: this.baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'D360-API-KEY': this.config.apiToken,
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: true,
          // Force TLS 1.2 or higher (required by 360Dialog)
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          keepAlive: true,
          keepAliveMsecs: 30000, // Increased from 1000ms to 30000ms to better handle slow connections
          maxSockets: 50, // Limit concurrent connections to prevent SNAT port exhaustion
          maxFreeSockets: 10, // Keep free sockets available for reuse
          scheduling: 'fifo', // First-in-first-out scheduling for connection reuse
        }),
        timeout: 60000, // 60 second timeout (increased due to frequent timeouts)
      });
    }

    this.logger.info(
      `WhatsApp adapter initialized with ${this.config.provider} provider`
    );
  }

  /**
   * Send a message via WhatsApp
   * @param userId - User ID to send message to
   * @param message - Message to send
   * @param channelConfig - Optional channel-specific configuration to use instead of initialized config
   */
  async sendMessage(
    userId: string, 
    message: OutgoingMessage,
    channelConfig?: WhatsAppConfig
  ): Promise<void> {
    this.ensureInitialized();

    // Use provided channel config if available, otherwise use initialized config
    const configToUse = channelConfig || this.config;

    try {
      if (configToUse.provider === 'ultramsg') {
        await this.sendViaUltramsg(userId, message, configToUse);
      } else if (configToUse.provider === 'twilio') {
        await this.sendViaTwilio(userId, message, configToUse);
      } else if (configToUse.provider === '360dialog') {
        await this.sendVia360dialog(userId, message, configToUse);
      }

      this.logger.info(`Message sent to WhatsApp user: ${userId}`, {
        provider: configToUse.provider,
        instanceId: configToUse.instanceId,
        phoneNumberId: configToUse.phoneNumberId,
      });
    } catch (error: any) {
      this.logger.error(`Failed to send WhatsApp message to ${userId}`, {
        error: error.message,
        instanceId: configToUse.instanceId,
      });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send WhatsApp message: ${error.message}`
      );
    }
  }

  /**
   * Send message via Ultramsg
   * @param userId - User ID to send message to
   * @param message - Message to send
   * @param config - WhatsApp configuration to use (defaults to initialized config)
   */
  private async sendViaUltramsg(
    userId: string, 
    message: OutgoingMessage,
    config: WhatsAppConfig = this.config
  ): Promise<void> {
    // Create client with specific instance configuration if different from initialized
    let client = this.client;
    const isUsingChannelConfig = config.instanceId !== this.config.instanceId || config.apiToken !== this.config.apiToken;
    
    let baseUrl = this.baseUrl;
    if (isUsingChannelConfig) {
      baseUrl = `https://api.ultramsg.com/${config.instanceId}`;
      client = axios.create({
        baseURL: baseUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        params: {
          token: config.apiToken,
        },
      });
      this.logger.info('Using channel-specific UltrMsg configuration', {
        instanceId: config.instanceId,
        baseUrl,
        hasToken: !!config.apiToken,
        tokenLength: config.apiToken?.length || 0,
      });
    } else {
      this.logger.debug('Using initialized UltrMsg configuration', {
        instanceId: config.instanceId,
        baseUrl: this.baseUrl,
      });
    }

    // UltrMsg requires the full WhatsApp format: number@c.us
    // If userId doesn't include @c.us, add it
    const formattedUserId = userId.includes('@c.us') ? userId : `${userId}@c.us`;
    
    const requestPayload: any = {
      to: formattedUserId,
      body: message.content,
      priority: 5,
    };

    // Add referenceId if conversationId is available in metadata
    // This allows UltraMsg to track the conversation in their system
    if (message.metadata?.conversationId) {
      requestPayload.referenceId = message.metadata.conversationId;
    }

    this.logger.debug('Sending WhatsApp message via UltrMsg', {
      userId,
      formattedUserId,
      instanceId: config.instanceId,
      messageLength: message.content?.length || 0,
      priority: requestPayload.priority,
      referenceId: requestPayload.referenceId || 'none',
      usingChannelConfig: isUsingChannelConfig,
      requestUrl: `${baseUrl}/messages/chat`,
      requestPayload: { ...requestPayload, body: requestPayload.body.substring(0, 50) + '...' },
    });

    try {
      const response = await client.post('/messages/chat', requestPayload);
      
      this.logger.debug('UltrMsg API response', {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        instanceId: config.instanceId,
      });

      // Check for error in response (even if HTTP status is 200)
      if (response.data && response.data.error) {
        const errorMessage = response.data.error;
        this.logger.error('UltrMsg API returned error in response', {
          error: errorMessage,
          instanceId: config.instanceId,
          userId: formattedUserId,
          fullResponse: response.data,
          httpStatus: response.status,
        });
        
        // Provide helpful context for common errors
        if (errorMessage.toLowerCase().includes('stopped') || 
            errorMessage.toLowerCase().includes('non-payment') ||
            errorMessage.toLowerCase().includes('subscription')) {
          throw new ChannelError(
            ERROR_CODES.CHANNEL_SEND_FAILED,
            `UltrMsg instance ${config.instanceId} is stopped or inactive. Please check your UltrMsg dashboard and subscription status. Original error: ${errorMessage}`
          );
        }
        
        throw new Error(errorMessage);
      }
      
      // Log success if response indicates message was sent
      if (response.data && (response.data.sent === true || response.data.id)) {
        this.logger.info('Message sent successfully via UltrMsg', {
          instanceId: config.instanceId,
          userId: formattedUserId,
          messageId: response.data.id,
        });
        return; // Success, exit early
      }
      
      // If we get here and no error was thrown, something unexpected happened
      this.logger.warn('UltrMsg API response unclear', {
        instanceId: config.instanceId,
        userId: formattedUserId,
        responseData: response.data,
      });
    } catch (error: any) {
      // Log detailed error information
      const errorDetails: any = {
        error: error.message,
        instanceId: config.instanceId,
        userId: formattedUserId,
        requestUrl: error.config?.url || `${baseUrl}/messages/chat`,
        requestPayload: { ...requestPayload, body: requestPayload.body.substring(0, 100) },
      };

      // Add HTTP error details if available
      if (error.response) {
        errorDetails.httpStatus = error.response.status;
        errorDetails.httpStatusText = error.response.statusText;
        errorDetails.responseData = error.response.data;
        
        // If response contains error object, use that message
        if (error.response.data && error.response.data.error) {
          errorDetails.apiError = error.response.data.error;
        }
      } else if (error.request) {
        errorDetails.networkError = 'No response received from UltrMsg API';
      }

      this.logger.error('UltrMsg API request failed', errorDetails);
      
      // Provide helpful error message
      if (errorDetails.apiError) {
        throw new ChannelError(
          ERROR_CODES.CHANNEL_SEND_FAILED,
          `UltrMsg API error: ${errorDetails.apiError}`
        );
      }
      
      throw error;
    }
  }

  /**
   * Send message via Twilio
   * @param userId - User ID to send message to
   * @param message - Message to send
   * @param config - WhatsApp configuration to use (defaults to initialized config)
   */
  private async sendViaTwilio(
    userId: string, 
    message: OutgoingMessage,
    config: WhatsAppConfig = this.config
  ): Promise<void> {
    // Create client with specific configuration if different from initialized
    let client = this.client;
    if (
      config.accountSid !== this.config.accountSid || 
      config.authToken !== this.config.authToken
    ) {
      client = axios.create({
        baseURL: 'https://api.twilio.com/2010-04-01',
        auth: {
          username: config.accountSid!,
          password: config.authToken!,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      this.logger.debug('Using channel-specific Twilio configuration', {
        accountSid: config.accountSid,
      });
    }

    const formData = new URLSearchParams({
      From: `whatsapp:${config.phoneNumber}`,
      To: `whatsapp:${userId}`,
      Body: message.content,
    });

    await client.post(
      `/Accounts/${config.accountSid}/Messages.json`,
      formData
    );
  }

  /**
   * Send message via 360dialog (WhatsApp Business Cloud API)
   * @param userId - User ID to send message to
   * @param message - Message to send
   * @param config - WhatsApp configuration to use (defaults to initialized config)
   */
  private async sendVia360dialog(
    userId: string, 
    message: OutgoingMessage,
    config: WhatsAppConfig = this.config
  ): Promise<void> {
    // Create client with specific configuration if different from initialized
    let client = this.client;
    if (
      config.apiToken !== this.config.apiToken || 
      config.phoneNumberId !== this.config.phoneNumberId
    ) {
      client = axios.create({
        baseURL: 'https://waba-v2.360dialog.io',
        headers: {
          'Content-Type': 'application/json',
          'D360-API-KEY': config.apiToken,
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: true,
          // Force TLS 1.2 or higher (required by 360Dialog)
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          keepAlive: true,
          keepAliveMsecs: 30000, // Increased from 1000ms to 30000ms to better handle slow connections
          maxSockets: 50, // Limit concurrent connections to prevent SNAT port exhaustion
          maxFreeSockets: 10, // Keep free sockets available for reuse
          scheduling: 'fifo', // First-in-first-out scheduling for connection reuse
        }),
        timeout: 60000, // 60 second timeout (increased due to frequent timeouts)
      });
      this.logger.debug('Using channel-specific 360dialog configuration', {
        phoneNumberId: config.phoneNumberId,
      });
    }

    if (!config.phoneNumberId) {
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        'phoneNumberId is required for 360dialog provider'
      );
    }

    // Format phone number: remove + and @c.us suffix if present
    // 360dialog expects format: 593995906687 (country code + number, no +)
    const formattedUserId = userId
      .replace(/^\+/, '')
      .replace(/@c\.us$/, '')
      .replace(/\s+/g, '');

    // Build request payload according to WhatsApp Business Cloud API format
    const requestPayload: any = {
      recipient_type: 'individual', // Required: individual or group
      messaging_product: 'whatsapp', // Required by WhatsApp Business API
      to: formattedUserId,
      type: 'text',
      text: {
        body: message.content,
      },
    };

    // Add context if conversationId is available (for threading)
    if (message.metadata?.conversationId) {
      // Note: Context requires message_id from previous message
      // For now, we'll just send without context
      // Future enhancement: store message IDs per conversation
    }

    const startTime = Date.now();
    this.logger.debug('Sending WhatsApp message via 360dialog', {
      userId,
      formattedUserId,
      phoneNumberId: config.phoneNumberId,
      messageLength: message.content?.length || 0,
      requestUrl: `https://waba-v2.360dialog.io/messages`,
      timeout: 60000,
    });

    try {
      // 360dialog API endpoint: POST /messages
      // Note: phone_number_id is NOT passed as query parameter per working cURL test
      // The API key in header (D360-API-KEY) identifies the account/phone number
      const response = await client.post(
        `/messages`,
        requestPayload
      );
      
      const duration = Date.now() - startTime;
      this.logger.debug(`360dialog API request completed in ${duration}ms`, {
        phoneNumberId: config.phoneNumberId,
        userId: formattedUserId,
      });

      this.logger.debug('360dialog API response', {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        phoneNumberId: config.phoneNumberId,
      });

      // Check for errors in response
      if (response.data && response.data.error) {
        const errorMessage = response.data.error.message || response.data.error;
        this.logger.error('360dialog API returned error in response', {
          error: errorMessage,
          phoneNumberId: config.phoneNumberId,
          userId: formattedUserId,
          fullResponse: response.data,
          httpStatus: response.status,
        });
        throw new ChannelError(
          ERROR_CODES.CHANNEL_SEND_FAILED,
          `360dialog API error: ${errorMessage}`
        );
      }

      // Log success if response indicates message was sent
      if (response.data && response.data.messages && response.data.messages.length > 0) {
        const messageId = response.data.messages[0].id;
        this.logger.info('Message sent successfully via 360dialog', {
          phoneNumberId: config.phoneNumberId,
          userId: formattedUserId,
          messageId,
        });
        return; // Success
      }

      // If we get here and no error was thrown, something unexpected happened
      this.logger.warn('360dialog API response unclear', {
        phoneNumberId: config.phoneNumberId,
        userId: formattedUserId,
        responseData: response.data,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      // Log detailed error information
      const errorDetails: any = {
        error: error.message,
        phoneNumberId: config.phoneNumberId,
        userId: formattedUserId,
        requestUrl: error.config?.url || `https://waba-v2.360dialog.io/messages`,
        requestPayload: { ...requestPayload, text: { body: requestPayload.text.body.substring(0, 100) + '...' } },
        duration: `${duration}ms`,
        timeout: 60000,
      };

      // Add HTTP error details if available
      if (error.response) {
        errorDetails.httpStatus = error.response.status;
        errorDetails.httpStatusText = error.response.statusText;
        errorDetails.responseData = error.response.data;
        
        // If response contains error object, use that message
        if (error.response.data && error.response.data.error) {
          errorDetails.apiError = error.response.data.error.message || error.response.data.error;
        }
      } else if (error.request) {
        errorDetails.networkError = 'No response received from 360dialog API';
        errorDetails.isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
      }

      this.logger.error('360dialog API request failed', errorDetails);
      
      // Provide helpful error message
      if (errorDetails.apiError) {
        throw new ChannelError(
          ERROR_CODES.CHANNEL_SEND_FAILED,
          `360dialog API error: ${errorDetails.apiError}`
        );
      }
      
      throw error;
    }
  }

  /**
   * Receive and normalize a message from webhook
   */
  receiveMessage(payload: any): NormalizedMessage {
    this.ensureInitialized();

    // Handle 360dialog format (WhatsApp Business Cloud API standard format)
    // Format: { object: "whatsapp_business_account", entry: [...] }
    if (payload.object === 'whatsapp_business_account' && payload.entry) {
      const entry = payload.entry[0];
      const changes = entry.changes?.[0];
      const value = changes?.value;
      
      // Only process incoming messages (not status updates)
      if (value?.messages && value.messages.length > 0) {
        const message = value.messages[0];
        
        // Extract phone number (format: 593995906687 or +593995906687)
        // Remove + if present
        const from = message.from.replace(/^\+/, '');
        
        // Get phone_number_id from metadata (identifies the instance)
        const phoneNumberId = value.metadata?.phone_number_id || 
                             entry.id || 
                             'default';
        
        // Create or update session
        this.createOrUpdateSession(from, {
          messageId: message.id,
          messageType: message.type,
          instanceId: phoneNumberId,
          toNumber: phoneNumberId,
        });

        // Extract content based on message type
        let messageContent = '';
        if (message.type === 'text') {
          messageContent = message.text?.body || '';
        } else if (message.type === 'image') {
          messageContent = message.image?.caption || '';
        } else if (message.type === 'video') {
          messageContent = message.video?.caption || '';
        } else if (message.type === 'document') {
          messageContent = message.document?.caption || '';
        } else if (message.type === 'audio') {
          // Audio messages don't have text content
          messageContent = '';
        } else if (message.type === 'location') {
          // Location messages - could extract coordinates
          messageContent = message.location ? 
            `Location: ${message.location.latitude}, ${message.location.longitude}` : '';
        } else if (message.type === 'contacts') {
          // Contact messages
          messageContent = message.contacts ? 
            `Contact shared: ${JSON.stringify(message.contacts)}` : '';
        }

        // Log media messages for debugging
        if (['image', 'video', 'document', 'audio'].includes(message.type)) {
          this.logger.debug('Received media message from 360dialog', {
            messageType: message.type,
            hasCaption: !!messageContent,
            captionLength: messageContent.length,
            phoneNumberId,
          });
        }
        
        return this.normalizeMessage(from, from, messageContent, {
          messageId: message.id,
          messageType: message.type,
          timestamp: parseInt(message.timestamp) * 1000, // Convert to milliseconds
          instanceId: phoneNumberId,
          toNumber: phoneNumberId,
          wabaId: entry.id, // WhatsApp Business Account ID
        });
      }
      
      // If it's a status update, ignore it
      if (value?.statuses) {
        this.logger.debug('Ignoring status update from 360dialog', {
          statuses: value.statuses,
        });
        throw new ChannelError(
          ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
          'IGNORE_MESSAGE'
        );
      }

      // If it's a user action (link clicks, etc.), ignore it
      if (value?.user_actions) {
        this.logger.debug('Ignoring user action from 360dialog', {
          userActions: value.user_actions,
        });
        throw new ChannelError(
          ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
          'IGNORE_MESSAGE'
        );
      }

      // If it's a 360dialog webhook but has no messages, statuses, or user_actions, ignore it
      // This handles cases like webhook verification, empty payloads, etc.
      this.logger.debug('Ignoring 360dialog webhook with no processable content', {
        hasMessages: !!value?.messages,
        hasStatuses: !!value?.statuses,
        hasUserActions: !!value?.user_actions,
        valueKeys: value ? Object.keys(value) : [],
      });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
        'IGNORE_MESSAGE'
      );
    }

    // Handle 360dialog alternative format (direct contacts and messages)
    // Format: { contacts: [...], messages: [...] }
    if (payload.contacts && payload.messages && Array.isArray(payload.messages)) {
      const message = payload.messages[0];
      if (message && message.from) {
        const from = message.from.replace(/^\+/, '').replace(/@c\.us$/, '');
        
        // Extract content based on message type
        let messageContent = '';
        if (message.type === 'text' && message.text) {
          messageContent = message.text.body || '';
        } else if (message.type === 'image' && message.image) {
          messageContent = message.image.caption || '';
        } else if (message.type === 'video' && message.video) {
          messageContent = message.video.caption || '';
        } else if (message.type === 'document' && message.document) {
          messageContent = message.document.caption || '';
        } else if (message.type === 'location' && message.location) {
          messageContent = `Location: ${message.location.latitude}, ${message.location.longitude}`;
        } else if (message.type === 'contacts' && message.contacts) {
          messageContent = `Contact shared: ${JSON.stringify(message.contacts)}`;
        }

        // Try to get phone_number_id from metadata if available
        const phoneNumberId = payload.metadata?.phone_number_id || 'default';

        this.createOrUpdateSession(from, {
          messageId: message.id,
          messageType: message.type,
          instanceId: phoneNumberId,
          toNumber: phoneNumberId,
        });

        return this.normalizeMessage(from, from, messageContent, {
          messageId: message.id,
          messageType: message.type,
          timestamp: parseInt(message.timestamp) * 1000,
          instanceId: phoneNumberId,
          toNumber: phoneNumberId,
        });
      }
    }

    // Handle Twilio format
    if (payload.MessageSid && payload.From && payload.Body !== undefined) {
      const from = payload.From.replace('whatsapp:', '');
      const to = payload.To?.replace('whatsapp:', '');
      
      this.createOrUpdateSession(from, {
        messageId: payload.MessageSid,
        messageType: payload.NumMedia > 0 ? 'media' : 'text',
        instanceId: to || 'default',
        toNumber: to,
      });

      return this.normalizeMessage(from, from, payload.Body || '', {
        messageId: payload.MessageSid,
        messageType: payload.NumMedia > 0 ? 'media' : 'text',
        timestamp: payload.Timestamp ? parseInt(payload.Timestamp) * 1000 : Date.now(),
        instanceId: to || 'default',
        toNumber: to,
      });
    }

      // Handle UltrMsg format with direct data object
      if (payload.data && !payload.messages) {
        const message = payload.data;
        
        // Log full message structure for debugging image with caption cases
        if (message.type === 'image' || message.type === 'video' || message.type === 'document') {
          this.logger.info('Received media message from UltraMsg', {
            messageType: message.type,
            hasBody: !!message.body,
            bodyContent: message.body,
            bodyLength: message.body?.length || 0,
            hasCaption: !!message.caption,
            captionContent: message.caption,
            captionLength: message.caption?.length || 0,
            allMessageFields: Object.keys(message),
          });
        }
        
        // Ignore messages sent by the bot itself to avoid loops
        if (message.fromMe) {
          this.logger.debug('Ignoring message from self', { messageId: message.id });
          throw new ChannelError(
            ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
            'IGNORE_MESSAGE' // Special error code to signal this should be ignored
          );
        }
        
        // Extract phone numbers from WhatsApp format (593995906687@c.us -> 593995906687)
        const from = message.from.split('@')[0];
        const to = message.to ? message.to.split('@')[0] : undefined;
        
        // Create or update session
        this.createOrUpdateSession(from, {
          messageId: message.id,
          messageType: message.type,
          instanceId: payload.instanceId,
          toNumber: to,
        });

        // Extract content: 
        // - CASE COMMON: Text messages -> message.body contains the text
        // - CASE EXCEPTION: Image with caption -> message.body contains the caption text
        // - CASE EXCEPTION: Image without text -> message.body is empty, use empty string
        // Priority: body (text/caption) > caption field > empty string
        const messageContent = message.body || message.caption || '';
        
        // Only log detailed info for media messages (exceptions), not for common text messages
        if (message.type === 'image' || message.type === 'video' || message.type === 'document') {
          this.logger.debug('Normalizing WhatsApp media message content', {
            messageType: message.type,
            hasBody: !!message.body,
            bodyLength: message.body?.length || 0,
            bodyPreview: message.body?.substring(0, 100),
            hasCaption: !!message.caption,
            captionLength: message.caption?.length || 0,
            captionPreview: message.caption?.substring(0, 100),
            finalContent: messageContent,
            finalContentLength: messageContent.length,
          });
        }
        
        return this.normalizeMessage(from, from, messageContent, {
          messageId: message.id,
          messageType: message.type,
          timestamp: message.time || Date.now(),
          pushname: message.pushname,
          instanceId: payload.instanceId,
          toNumber: to, // Número al que llega el mensaje (identifica la instancia)
        });
      }

    // Handle standard format with messages array
    if (!payload.messages || payload.messages.length === 0) {
      throw new ChannelError(
        ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
        'Invalid WhatsApp webhook payload'
      );
    }

    const message = payload.messages[0];

    // Create or update session
    this.createOrUpdateSession(message.from, {
      messageId: message.id,
      messageType: message.type,
    });

    // Extract content:
    // - CASE COMMON: Text messages -> message.body contains the text
    // - CASE EXCEPTION: Image with caption -> message.body contains the caption text
    // - CASE EXCEPTION: Image without text -> message.body is empty, use empty string
    // Priority: body (text/caption) > caption field > empty string
    const messageContent = message.body || message.caption || '';
    
    // Only log detailed info for media messages (exceptions), not for common text messages
    if (message.type === 'image' || message.type === 'video' || message.type === 'document') {
      this.logger.debug('Normalizing WhatsApp media message content', {
        messageType: message.type,
        hasBody: !!message.body,
        bodyLength: message.body?.length || 0,
        bodyPreview: message.body?.substring(0, 100),
        hasCaption: !!message.caption,
        captionLength: message.caption?.length || 0,
        captionPreview: message.caption?.substring(0, 100),
        finalContent: messageContent,
        finalContentLength: messageContent.length,
      });
    }
    
    return this.normalizeMessage(message.from, message.from, messageContent, {
      messageId: message.id,
      messageType: message.type,
      timestamp: message.timestamp,
    });
  }

  /**
   * Handle webhook from WhatsApp provider
   */
  async handleWebhook(payload: any): Promise<NormalizedMessage | null> {
    this.ensureInitialized();

    try {
      // Extract the actual payload - 360Dialog may send it wrapped in 'body'
      // Handle both cases: direct payload or wrapped in 'body' property
      // Check if payload has a 'body' property that contains the actual webhook data
      let actualPayload = payload;
      
      // Priority 1: Check if payload.body has webhook data (360Dialog format)
      // CRITICAL: 360Dialog sends payload as {"body": {"object": "whatsapp_business_account", ...}}
      if (payload?.body && typeof payload.body === 'object') {
        // If body exists and has webhook indicators
        if (payload.body.object === 'whatsapp_business_account' || 
            payload.body.entry || 
            payload.body.event_type || 
            payload.body.instanceId ||
            payload.body.MessageSid) {
          actualPayload = payload.body;
          this.logger.info('✅ Extracted payload from body wrapper', {
            extractedObject: actualPayload?.object,
            hasEntry: !!actualPayload?.entry,
            hasEventType: !!actualPayload?.event_type,
            entryLength: actualPayload?.entry?.length,
          });
        }
      }
      
      // Priority 2: If payload itself has webhook data, use it directly
      // (This handles cases where payload is already the actual webhook data)
      // But only if we didn't already extract from body
      if (actualPayload === payload && payload?.object === 'whatsapp_business_account') {
        this.logger.info('Payload is already in correct format (no wrapper)');
      }

      // Debug: Log the payload structure to understand what we're receiving
      // Use INFO level to ensure it appears in logs even if DEBUG is filtered
      this.logger.info('handleWebhook received payload - DEBUG INFO', {
        hasBody: !!payload?.body,
        bodyObject: payload?.body?.object,
        bodyHasEntry: !!payload?.body?.entry,
        actualPayloadObject: actualPayload?.object,
        actualPayloadHasEntry: !!actualPayload?.entry,
        entryLength: actualPayload?.entry?.length,
        hasEventType: !!actualPayload?.event_type,
        eventType: actualPayload?.event_type,
        payloadKeys: payload ? Object.keys(payload) : [],
        actualPayloadKeys: actualPayload ? Object.keys(actualPayload) : [],
        fullPayload: JSON.stringify(payload, null, 2),
        fullActualPayload: JSON.stringify(actualPayload, null, 2),
      });

      // Verify webhook secret only if it's explicitly configured
      // Note: webhookSecret must be a non-empty string for verification to occur
      const secretValue = this.config.webhookSecret;
      const hasConfiguredSecret = secretValue && 
                                   typeof secretValue === 'string' && 
                                   secretValue.trim().length > 0;
      
      this.logger.debug('Webhook secret check', { 
        hasSecret: !!secretValue, 
        secretType: typeof secretValue,
        secretLength: typeof secretValue === 'string' ? secretValue.length : 0,
        hasConfiguredSecret 
      });
      
      if (hasConfiguredSecret) {
        if (!actualPayload.secret || actualPayload.secret !== this.config.webhookSecret) {
          this.logger.warn('Invalid webhook secret - secret verification enabled but not matched');
          throw new ChannelError(
            ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
            'Invalid webhook secret'
          );
        }
        this.logger.debug('Webhook secret verified successfully');
      } else {
        this.logger.debug('Webhook secret verification disabled');
      }

      // Handle 360dialog format (WhatsApp Business Cloud API)
      // CRITICAL: Check MULTIPLE ways to detect 360Dialog format - be VERY explicit
      // The payload comes as: {"body": {"object": "whatsapp_business_account", "entry": [...]}}
      // After extraction, actualPayload should be: {"object": "whatsapp_business_account", "entry": [...]}
      const has360DialogInBody = payload?.body?.object === 'whatsapp_business_account';
      const has360DialogInActual = actualPayload?.object === 'whatsapp_business_account';
      const has360DialogEntry = !!(payload?.body?.entry || actualPayload?.entry);
      
      // Also check if payload itself is the 360Dialog format (direct, no wrapper)
      const isDirect360Dialog = payload?.object === 'whatsapp_business_account';
      
      // CRITICAL: If we extracted from body, actualPayload should have the object property
      // So we should check actualPayload first, then fallback to payload.body
      const is360Dialog = has360DialogInActual || has360DialogInBody || has360DialogEntry || isDirect360Dialog;
      
      this.logger.info('🔍 360Dialog detection check', {
        has360DialogInBody,
        has360DialogInActual,
        has360DialogEntry,
        isDirect360Dialog,
        is360Dialog,
        payloadBodyObject: payload?.body?.object,
        actualPayloadObject: actualPayload?.object,
        payloadObject: payload?.object,
        payloadBodyHasEntry: !!payload?.body?.entry,
        actualPayloadHasEntry: !!actualPayload?.entry,
        payloadKeys: payload ? Object.keys(payload) : [],
        payloadBodyKeys: payload?.body ? Object.keys(payload.body) : [],
      });
      
      if (is360Dialog) {
        this.logger.info('✅ Detected 360Dialog webhook format - Processing', {
          actualPayloadObject: actualPayload?.object,
          payloadBodyObject: payload?.body?.object,
          hasEntry: !!actualPayload?.entry || !!payload?.body?.entry,
          entryLength: actualPayload?.entry?.length || payload?.body?.entry?.length,
        });
        
        // Determine which payload to use - prioritize the one with 'object' property
        let payloadToProcess: any;
        if (actualPayload?.object === 'whatsapp_business_account') {
          payloadToProcess = actualPayload;
          this.logger.info('Using actualPayload for processing');
        } else if (payload?.body?.object === 'whatsapp_business_account') {
          payloadToProcess = payload.body;
          this.logger.info('Using payload.body for processing');
        } else if (actualPayload?.entry) {
          payloadToProcess = actualPayload;
          this.logger.info('Using actualPayload (has entry) for processing');
        } else if (payload?.body?.entry) {
          payloadToProcess = payload.body;
          this.logger.info('Using payload.body (has entry) for processing');
        } else {
          payloadToProcess = payload;
          this.logger.warn('Fallback: Using raw payload for processing');
        }
        
        this.logger.info('Payload to process structure', {
          hasObject: !!payloadToProcess?.object,
          objectValue: payloadToProcess?.object,
          hasEntry: !!payloadToProcess?.entry,
          entryLength: payloadToProcess?.entry?.length,
          payloadToProcessKeys: payloadToProcess ? Object.keys(payloadToProcess) : [],
        });
        
        try {
          const message = this.receiveMessage(payloadToProcess);
          this.logger.info('✅ 360Dialog message processed successfully', {
            messageId: message?.id,
            userId: message?.channelUserId,
            contentLength: message?.content?.length,
            contentPreview: message?.content?.substring(0, 100),
          });
          return message;
        } catch (error: any) {
          // If it's an "IGNORE_MESSAGE" error, return null to skip processing
          if (error.message === 'IGNORE_MESSAGE') {
            this.logger.info('Message ignored by filter (360dialog)', {
              error: error.message,
              reason: 'Status update or non-message event',
            });
            return null;
          }
          // Log other errors for debugging
          this.logger.error('❌ Error processing 360Dialog message', {
            error: error.message,
            stack: error.stack,
            payloadToProcessKeys: payloadToProcess ? Object.keys(payloadToProcess) : [],
            payloadToProcessPreview: JSON.stringify(payloadToProcess, null, 2).substring(0, 500),
          });
          // Re-throw other errors
          throw error;
        }
      }

      // Handle Twilio format
      if (actualPayload.MessageSid) {
        try {
          const message = this.receiveMessage(actualPayload);
          return message;
        } catch (error: any) {
          if (error.message === 'IGNORE_MESSAGE') {
            this.logger.debug('Message ignored by filter (Twilio)');
            return null;
          }
          throw error;
        }
      }

      // Handle different webhook event types
      // UltrMsg sends "message_received" for new messages
      if (actualPayload.event_type === 'message' || actualPayload.event_type === 'message_received') {
        try {
          const message = this.receiveMessage(actualPayload);
          return message;
        } catch (error: any) {
          // If it's an "IGNORE_MESSAGE" error, return null to skip processing
          if (error.message === 'IGNORE_MESSAGE') {
            this.logger.debug('Message ignored by filter');
            return null;
          }
          // Re-throw other errors
          throw error;
        }
      }

      // Handle status updates (delivered, read, etc.)
      if (actualPayload.event_type === 'status') {
        this.logger.debug('Received status update', { status: actualPayload.data });
        return null; // Don't process status updates as messages
      }

      this.logger.warn('Unknown webhook event type', { 
        eventType: actualPayload.event_type,
        hasObject: !!actualPayload?.object,
        objectValue: actualPayload?.object,
        payloadKeys: actualPayload ? Object.keys(actualPayload) : [],
      });
      return null;
    } catch (error: any) {
      this.logger.error('Error handling WhatsApp webhook', { error: error.message });
      throw error;
    }
  }

  /**
   * Send a media message (image, video, document)
   */
  async sendMedia(
    userId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'document',
    caption?: string
  ): Promise<void> {
    this.ensureInitialized();

    try {
      if (this.config.provider === 'ultramsg') {
        const endpoint = `/messages/${mediaType}`;
        const payload = {
          to: userId,
          [mediaType]: mediaUrl,
          caption: caption || '',
        };
        const response = await this.client.post(endpoint, payload);

        // Validate Ultramsg response (same as sendViaUltramsg: 200 can still contain error)
        if (response.data && response.data.error) {
          const errorMessage = response.data.error;
          this.logger.error('UltrMsg API returned error for media send', {
            error: errorMessage,
            instanceId: this.config.instanceId,
            userId,
            mediaType,
            fullResponse: response.data,
          });
          if (
            errorMessage.toLowerCase().includes('stopped') ||
            errorMessage.toLowerCase().includes('non-payment') ||
            errorMessage.toLowerCase().includes('subscription')
          ) {
            throw new ChannelError(
              ERROR_CODES.CHANNEL_SEND_FAILED,
              `UltrMsg instance ${this.config.instanceId} is stopped or inactive. Original: ${errorMessage}`
            );
          }
          throw new Error(errorMessage);
        }

        // Log actual API response for diagnosis when messages don't reach the client
        if (response.data && (response.data.sent === true || response.data.id)) {
          this.logger.info('Message sent successfully via UltrMsg', {
            instanceId: this.config.instanceId,
            userId,
            mediaType,
            messageId: response.data.id,
          });
        } else {
          this.logger.warn('UltrMsg media response unclear (delivery may have failed)', {
            instanceId: this.config.instanceId,
            userId,
            mediaType,
            responseData: response.data,
          });
        }
      } else if (this.config.provider === 'twilio') {
        const formData = new URLSearchParams({
          From: `whatsapp:${this.config.phoneNumber}`,
          To: `whatsapp:${userId}`,
          MediaUrl: mediaUrl,
          Body: caption || '',
        });

        await this.client.post(
          `/Accounts/${this.config.accountSid}/Messages.json`,
          formData
        );
      } else if (this.config.provider === '360dialog') {
        if (!this.config.phoneNumberId) {
          throw new ChannelError(
            ERROR_CODES.CHANNEL_SEND_FAILED,
            'phoneNumberId is required for 360dialog provider'
          );
        }

        const formattedUserId = userId
          .replace(/^\+/, '')
          .replace(/@c\.us$/, '')
          .replace(/\s+/g, '');

        const requestPayload: any = {
          recipient_type: 'individual', // Required: individual or group
          messaging_product: 'whatsapp', // Required by WhatsApp Business API
          to: formattedUserId,
          type: mediaType,
          [mediaType]: {
            link: mediaUrl,
          },
        };

        if (caption) {
          requestPayload[mediaType].caption = caption;
        }

        await this.client.post(
          `/messages`,
          requestPayload
        );
      }

      this.logger.info(`Sent ${mediaType} to WhatsApp user: ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send ${mediaType}`, { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send ${mediaType}: ${error.message}`
      );
    }
  }

  /**
   * Send a location
   */
  async sendLocation(
    userId: string,
    latitude: number,
    longitude: number,
    address?: string
  ): Promise<void> {
    this.ensureInitialized();

    try {
      if (this.config.provider === 'ultramsg') {
        await this.client.post('/messages/location', {
          to: userId,
          lat: latitude,
          lng: longitude,
          address: address || '',
        });
      }

      this.logger.info(`Sent location to WhatsApp user: ${userId}`);
    } catch (error: any) {
      this.logger.error('Failed to send location', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send location: ${error.message}`
      );
    }
  }

  /**
   * Send a contact card
   */
  async sendContact(
    userId: string,
    contactName: string,
    contactPhone: string
  ): Promise<void> {
    this.ensureInitialized();

    try {
      if (this.config.provider === 'ultramsg') {
        await this.client.post('/messages/contact', {
          to: userId,
          contact: JSON.stringify({
            name: contactName,
            phone: contactPhone,
          }),
        });
      }

      this.logger.info(`Sent contact to WhatsApp user: ${userId}`);
    } catch (error: any) {
      this.logger.error('Failed to send contact', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send contact: ${error.message}`
      );
    }
  }

  /**
   * Get chat information
   */
  async getChatInfo(userId: string): Promise<any> {
    this.ensureInitialized();

    try {
      if (this.config.provider === 'ultramsg') {
        const response = await this.client.get('/chats/chat', {
          params: { chatId: userId },
        });
        return response.data;
      }
      return null;
    } catch (error: any) {
      this.logger.error('Failed to get chat info', { error: error.message });
      return null;
    }
  }

  /**
   * Check if a number is registered on WhatsApp
   */
  async checkNumber(phoneNumber: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      if (this.config.provider === 'ultramsg') {
        const response = await this.client.get('/contacts/check', {
          params: { chatId: phoneNumber },
        });
        return response.data.status === 'valid';
      }
      return true; // Assume valid for other providers
    } catch (error: any) {
      this.logger.error('Failed to check number', { error: error.message });
      return false;
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (this.config.provider === 'ultramsg') {
        const response = await this.client.get('/instance/status');
        return response.data.status === 'authenticated';
      } else if (this.config.provider === 'twilio') {
        // Check Twilio account status
        const response = await this.client.get(
          `/Accounts/${this.config.accountSid}.json`
        );
        return response.data.status === 'active';
      } else if (this.config.provider === '360dialog') {
        // For 360dialog, we can check by trying to get phone number info
        // or just verify the API key is valid by making a simple request
        if (!this.config.phoneNumberId) {
          return false;
        }
        try {
          // Try to get phone number info as health check
          const response = await this.client.get(
            `/phone_numbers/${this.config.phoneNumberId}`,
            {
              params: {
                phone_number_id: this.config.phoneNumberId,
              },
            }
          );
          // If we get a response, the API key is valid
          return response.status === 200;
        } catch (error: any) {
          // If 404, phone number might not exist but API key could be valid
          // If 401/403, API key is invalid
          if (error.response?.status === 404) {
            // Phone number not found, but API key might be valid
            // Return true to avoid false negatives
            return true;
          }
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down WhatsApp adapter');
    this.sessions.clear();
  }
}
