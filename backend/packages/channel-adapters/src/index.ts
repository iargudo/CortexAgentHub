/**
 * @cortex/channel-adapters - Multi-channel Communication Adapters
 * Main entry point for the Channel Adapters package
 */

export * from './base';
export * from './webchat';
export * from './whatsapp';
export * from './telegram';
export * from './email';

// Re-export important types from shared
export type {
  IChannelAdapter,
  ChannelConfig,
  ChannelType,
  NormalizedMessage,
  IncomingMessage,
  OutgoingMessage,
  SessionContext,
  WhatsAppConfig,
  TelegramConfig,
  WebChatConfig,
  EmailConfig,
} from '@cortex/shared';
