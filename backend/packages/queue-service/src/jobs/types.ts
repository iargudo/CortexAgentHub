/**
 * Job Type Definitions for BullMQ Queues
 */

export enum QueueName {
  MESSAGE_PROCESSING = 'message-processing',
  WEBHOOK_PROCESSING = 'webhook-processing',
  EMAIL_SENDING = 'email-sending',
  ANALYTICS = 'analytics',
  NOTIFICATIONS = 'notifications',
  DOCUMENT_PROCESSING = 'document-processing',
  WHATSAPP_SENDING = 'whatsapp-sending',
}

/**
 * Message Processing Job
 */
export interface MessageProcessingJob {
  messageId: string;
  channelType: string;
  userId: string;
  content: string;
  metadata?: any;
  timestamp: string;
}

/**
 * Webhook Processing Job
 */
export interface WebhookProcessingJob {
  webhookId: string;
  channel: string;
  payload: any;
  headers: Record<string, string>;
  receivedAt: string;
}

/**
 * Email Sending Job
 */
export interface EmailSendingJob {
  to: string;
  from: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
  }>;
}

/**
 * Analytics Job
 */
export interface AnalyticsJob {
  event: string;
  data: any;
  userId?: string;
  conversationId?: string;
  timestamp: string;
}

/**
 * Notification Job
 */
export interface NotificationJob {
  userId: string;
  type: 'email' | 'push' | 'sms';
  title: string;
  message: string;
  data?: any;
}

/**
 * Document Processing Job
 */
export interface DocumentProcessingJob {
  documentId: string;
  knowledgeBaseId: string;
  retryCount?: number;
}

/**
 * WhatsApp Sending Job
 */
export interface WhatsAppSendingJob {
  userId: string;
  message: {
    channelUserId: string;
    content: string;
    metadata?: any;
  };
  channelConfig: {
    provider: 'ultramsg' | 'twilio' | '360dialog';
    instanceId?: string;
    token?: string; // DB may store as 'token' (legacy) or 'apiToken'
    apiToken?: string; // DB may store as 'apiToken' or 'token'
    phoneNumber?: string;
    phoneNumberId?: string; // 360dialog
    accountSid?: string; // Twilio
    authToken?: string; // Twilio
    wabaId?: string; // 360dialog (optional)
  };
  retryCount?: number;
  maxRetries?: number;
}

/**
 * Job Options
 */
export interface JobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}
