import type { IncomingMessage } from '@cortex/shared';

/**
 * Dependencies for WhatsApp webhook pipeline (processMessage flow).
 * Provided by WebhooksController via getWhatsAppPipelineDeps().
 */
export interface IWhatsAppPipelineDeps {
  tryLoadFlowFromConversation(
    channelType: string,
    userId: string,
    requestedChannelId?: string
  ): Promise<
    | { routingResult: any; conversationId: string }
    | { conversationId: string; flowInactive: true }
    | null
  >;
  flowRouter: { route(message: IncomingMessage): Promise<any> };
  enhanceWithRAGContext(routingResult: any, queryText: string): Promise<any>;
  attachExternalContextToProcessing(
    normalizedMessage: IncomingMessage,
    routingResult: any,
    preferredConversationId?: string | null
  ): Promise<{ routingResult: any; conversationId?: string; conversationMetadata?: any }>;
  extractExplicitFlowIdFromConversationMetadata(conversationMetadata: any): string | undefined;
  tryLoadExplicitFlowRouting(
    flowId: string,
    channelType: string,
    requestedChannelId?: string,
    allowInactive?: boolean
  ): Promise<any>;
  loadAndRestoreHistoryForConversation(
    conversationId: string,
    channelType: string,
    userId: string
  ): Promise<void>;
  orchestrator: { processMessage(message: IncomingMessage, routingResult?: any): Promise<any> };
  saveConversationAndMessages(
    normalizedMessage: IncomingMessage,
    result: any,
    routingResult: any
  ): Promise<void>;
  getChannelConfigById(channelId?: string): Promise<any>;
  getChannelConfigFromRoutingResult(routingResult: any): Promise<any>;
  sendWhatsAppMessage(userId: string, message: any, channelConfig?: any): Promise<void>;
  logSystemEvent(level: string, message: string, options?: any): Promise<void>;
  identifyWhatsAppChannelFromWebhook(webhookPayload: any): Promise<string | undefined>;
  /** Returns true if message is duplicate and should be skipped */
  executeDedupCheck(messageId: string): Promise<boolean>;
  whatsappAdapter: { handleWebhook(webhookBody: any): Promise<IncomingMessage | null> };
}

/**
 * Dependencies for Telegram webhook pipeline.
 */
export interface ITelegramPipelineDeps {
  flowRouter: { route(message: IncomingMessage): Promise<any> };
  enhanceWithRAGContext(routingResult: any, queryText: string): Promise<any>;
  orchestrator: { processMessage(message: IncomingMessage, routingResult?: any): Promise<any> };
  saveConversationAndMessages(
    normalizedMessage: IncomingMessage,
    result: any,
    routingResult: any
  ): Promise<void>;
  telegramAdapter: {
    receiveMessage(body: any): IncomingMessage;
    sendMessage(userId: string, message: { channelUserId: string; content: string; metadata?: any }): Promise<void>;
  };
}

/**
 * Dependencies for Email webhook pipeline.
 */
export interface IEmailPipelineDeps {
  flowRouter: { route(message: IncomingMessage): Promise<any> };
  enhanceWithRAGContext(routingResult: any, queryText: string): Promise<any>;
  orchestrator: { processMessage(message: IncomingMessage, routingResult?: any): Promise<any> };
  saveConversationAndMessages(
    normalizedMessage: IncomingMessage,
    result: any,
    routingResult: any
  ): Promise<void>;
  emailAdapter: {
    receiveMessage(body: any): IncomingMessage;
    sendMessage(userId: string, message: { channelUserId: string; content: string; metadata?: any }): Promise<void>;
  };
}
