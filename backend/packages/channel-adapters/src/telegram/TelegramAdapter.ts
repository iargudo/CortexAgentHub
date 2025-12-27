import axios, { AxiosInstance } from 'axios';
import {
  ChannelType,
  NormalizedMessage,
  OutgoingMessage,
  TelegramConfig,
  TelegramWebhookPayload,
  ChannelError,
  ERROR_CODES,
  generateUUID,
} from '@cortex/shared';
import { BaseChannelAdapter } from '../base/BaseChannelAdapter';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/**
 * Telegram Bot adapter using Bot API
 */
export class TelegramAdapter extends BaseChannelAdapter {
  readonly channelType = ChannelType.TELEGRAM;

  private client!: AxiosInstance;
  private botInfo: any;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);
    this.config = config.config as TelegramConfig;

    // Setup Telegram Bot API client
    this.client = axios.create({
      baseURL: `https://api.telegram.org/bot${this.config.botToken}`,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Get bot information
    try {
      const response = await this.client.get('/getMe');
      this.botInfo = response.data.result;
      this.logger.info('Telegram bot initialized', {
        botName: this.botInfo.username,
        botId: this.botInfo.id,
      });
    } catch (error: any) {
      this.logger.error('Failed to get bot info', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_NOT_CONFIGURED,
        'Failed to initialize Telegram bot'
      );
    }

    // Set webhook if configured
    if (this.config.webhookUrl) {
      await this.setWebhook();
    }
  }

  /**
   * Set up webhook for receiving updates
   */
  private async setWebhook(): Promise<void> {
    try {
      const response = await this.client.post('/setWebhook', {
        url: this.config.webhookUrl,
        allowed_updates: this.config.allowedUpdates || ['message', 'callback_query'],
        secret_token: this.config.webhookSecret,
      });

      if (response.data.ok) {
        this.logger.info('Telegram webhook set successfully', {
          url: this.config.webhookUrl,
        });
      } else {
        throw new Error(response.data.description);
      }
    } catch (error: any) {
      this.logger.error('Failed to set webhook', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_NOT_CONFIGURED,
        `Failed to set webhook: ${error.message}`
      );
    }
  }

  /**
   * Send a message via Telegram
   */
  async sendMessage(userId: string, message: OutgoingMessage): Promise<void> {
    this.ensureInitialized();

    try {
      const response = await this.client.post('/sendMessage', {
        chat_id: userId,
        text: message.content,
        parse_mode: message.metadata?.parseMode || 'Markdown',
        disable_web_page_preview: message.metadata?.disableWebPagePreview || false,
        reply_markup: message.metadata?.replyMarkup,
      });

      if (!response.data.ok) {
        throw new Error(response.data.description);
      }

      this.logger.info(`Message sent to Telegram user: ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send Telegram message to ${userId}`, {
        error: error.message,
      });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send Telegram message: ${error.message}`
      );
    }
  }

  /**
   * Receive and normalize a message from webhook
   */
  receiveMessage(payload: TelegramWebhookPayload): NormalizedMessage {
    this.ensureInitialized();

    if (!payload.message) {
      throw new ChannelError(
        ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
        'Invalid Telegram webhook payload'
      );
    }

    const message = payload.message;
    const userId = message.from.id.toString();
    const text = message.text || '';

    // Create or update session
    this.createOrUpdateSession(userId, {
      messageId: message.message_id,
      chatId: message.chat.id,
      chatType: message.chat.type,
      firstName: message.from.first_name,
      username: message.from.username,
    });

    return this.normalizeMessage(message.chat.id.toString(), userId, text, {
      messageId: message.message_id,
      updateId: payload.update_id,
      chatType: message.chat.type,
      date: message.date,
      from: message.from,
    });
  }

  /**
   * Handle webhook from Telegram
   */
  async handleWebhook(payload: any): Promise<NormalizedMessage | null> {
    this.ensureInitialized();

    try {
      // Verify webhook secret if configured
      const secretToken = payload.headers?.['x-telegram-bot-api-secret-token'];
      if (this.config.webhookSecret && secretToken !== this.config.webhookSecret) {
        this.logger.warn('Invalid webhook secret token');
        throw new ChannelError(
          ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
          'Invalid webhook secret'
        );
      }

      // Handle message updates
      if (payload.message) {
        return this.receiveMessage(payload);
      }

      // Handle callback queries (inline keyboard button presses)
      if (payload.callback_query) {
        await this.handleCallbackQuery(payload.callback_query);
        return null;
      }

      // Handle other update types
      this.logger.debug('Received non-message update', {
        updateType: Object.keys(payload).filter((k) => k !== 'update_id'),
      });

      return null;
    } catch (error: any) {
      this.logger.error('Error handling Telegram webhook', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle callback query from inline keyboard
   */
  private async handleCallbackQuery(callbackQuery: any): Promise<void> {
    try {
      // Answer the callback query to remove loading state
      await this.client.post('/answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: 'Processing...',
      });

      // Here you would typically emit an event or call a handler
      // For now, just log it
      this.logger.info('Callback query received', {
        data: callbackQuery.data,
        userId: callbackQuery.from.id,
      });
    } catch (error: any) {
      this.logger.error('Failed to handle callback query', { error: error.message });
    }
  }

  /**
   * Send a photo
   */
  async sendPhoto(userId: string, photoUrl: string, caption?: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client.post('/sendPhoto', {
        chat_id: userId,
        photo: photoUrl,
        caption: caption || '',
      });

      this.logger.info(`Photo sent to Telegram user: ${userId}`);
    } catch (error: any) {
      this.logger.error('Failed to send photo', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send photo: ${error.message}`
      );
    }
  }

  /**
   * Send a document
   */
  async sendDocument(userId: string, documentUrl: string, caption?: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client.post('/sendDocument', {
        chat_id: userId,
        document: documentUrl,
        caption: caption || '',
      });

      this.logger.info(`Document sent to Telegram user: ${userId}`);
    } catch (error: any) {
      this.logger.error('Failed to send document', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send document: ${error.message}`
      );
    }
  }

  /**
   * Send a location
   */
  async sendLocation(userId: string, latitude: number, longitude: number): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client.post('/sendLocation', {
        chat_id: userId,
        latitude,
        longitude,
      });

      this.logger.info(`Location sent to Telegram user: ${userId}`);
    } catch (error: any) {
      this.logger.error('Failed to send location', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send location: ${error.message}`
      );
    }
  }

  /**
   * Send a message with inline keyboard
   */
  async sendMessageWithKeyboard(
    userId: string,
    text: string,
    buttons: TelegramKeyboardButton[][]
  ): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client.post('/sendMessage', {
        chat_id: userId,
        text,
        reply_markup: {
          inline_keyboard: buttons,
        },
      });

      this.logger.info(`Message with keyboard sent to Telegram user: ${userId}`);
    } catch (error: any) {
      this.logger.error('Failed to send message with keyboard', {
        error: error.message,
      });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send message with keyboard: ${error.message}`
      );
    }
  }

  /**
   * Send typing action
   */
  async sendTypingAction(userId: string): Promise<void> {
    try {
      await this.client.post('/sendChatAction', {
        chat_id: userId,
        action: 'typing',
      });
    } catch (error: any) {
      // Don't throw error for typing action
      this.logger.debug('Failed to send typing action', { error: error.message });
    }
  }

  /**
   * Get chat information
   */
  async getChatInfo(chatId: string): Promise<any> {
    this.ensureInitialized();

    try {
      const response = await this.client.get('/getChat', {
        params: { chat_id: chatId },
      });
      return response.data.result;
    } catch (error: any) {
      this.logger.error('Failed to get chat info', { error: error.message });
      return null;
    }
  }

  /**
   * Get user profile photos
   */
  async getUserProfilePhotos(userId: string): Promise<any> {
    this.ensureInitialized();

    try {
      const response = await this.client.get('/getUserProfilePhotos', {
        params: { user_id: userId },
      });
      return response.data.result;
    } catch (error: any) {
      this.logger.error('Failed to get user profile photos', { error: error.message });
      return null;
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(): Promise<void> {
    try {
      await this.client.post('/deleteWebhook');
      this.logger.info('Telegram webhook deleted');
    } catch (error: any) {
      this.logger.error('Failed to delete webhook', { error: error.message });
    }
  }

  /**
   * Get webhook info
   */
  async getWebhookInfo(): Promise<any> {
    try {
      const response = await this.client.get('/getWebhookInfo');
      return response.data.result;
    } catch (error: any) {
      this.logger.error('Failed to get webhook info', { error: error.message });
      return null;
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.client.get('/getMe');
      return response.data.ok;
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Telegram adapter');
    this.sessions.clear();
  }

  /**
   * Get bot info
   */
  getBotInfo(): any {
    return this.botInfo;
  }
}
