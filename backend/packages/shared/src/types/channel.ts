import { ChannelType, Metadata } from './common';
import { NormalizedMessage, IncomingMessage, OutgoingMessage } from './message';

/**
 * Channel Adapter Types
 */

export interface ChannelConfig {
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: ChannelSpecificConfig;
  metadata?: Metadata;
}

export type ChannelSpecificConfig =
  | WhatsAppConfig
  | TelegramConfig
  | WebChatConfig
  | EmailConfig;

export interface WhatsAppConfig {
  provider: 'ultramsg' | 'twilio' | '360dialog';
  apiToken: string; // Ultramsg token or 360dialog D360-API-KEY
  instanceId?: string; // Ultramsg
  accountSid?: string; // Twilio
  authToken?: string; // Twilio
  phoneNumberId?: string; // 360dialog - WhatsApp Business Phone Number ID
  phoneNumber: string; // Phone number for all providers
  webhookUrl: string;
  webhookSecret?: string;
  wabaId?: string; // 360dialog - WhatsApp Business Account ID (optional)
}

export interface TelegramConfig {
  botToken: string;
  webhookUrl: string;
  webhookSecret?: string;
  allowedUpdates?: string[];
}

export interface WebChatConfig {
  wsPort: number;
  allowedOrigins: string[];
  jwtSecret: string;
  maxConnections?: number;
  messageRateLimit?: {
    requests: number;
    window: number;
  };
}

export interface EmailConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  imap?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    tls: boolean;
  };
  fromAddress: string;
  webhookUrl?: string;
}

export interface SessionContext {
  sessionId: string;
  channelType: ChannelType;
  userId: string;
  startedAt: Date;
  lastActivity: Date;
  metadata: Metadata;
}

/**
 * Webhook payload interfaces for different channels
 */

export interface WhatsAppWebhookPayload {
  instanceId?: string;
  messages?: Array<{
    id: string;
    from: string;
    to: string;
    body: string;
    type: string;
    timestamp: number;
  }>;
}

export interface TelegramWebhookPayload {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

/**
 * Base interface for all channel adapters
 */
export interface IChannelAdapter {
  readonly channelType: ChannelType;

  initialize(config: ChannelConfig): Promise<void>;
  sendMessage(userId: string, message: OutgoingMessage): Promise<void>;
  receiveMessage(payload: any): NormalizedMessage;
  getSessionContext(userId: string): SessionContext;
  handleWebhook(payload: any): Promise<NormalizedMessage | null>;
  isHealthy(): Promise<boolean>;
  shutdown(): Promise<void>;
}
