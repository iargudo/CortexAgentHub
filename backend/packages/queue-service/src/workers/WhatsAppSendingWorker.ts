import { Job } from 'bullmq';
import { BaseWorker } from './BaseWorker';
import { QueueName, WhatsAppSendingJob } from '../jobs/types';
import { createLogger } from '@cortex/shared';
import { WhatsAppAdapter } from '@cortex/channel-adapters';
import { WhatsAppConfig } from '@cortex/shared';

const logger = createLogger('WhatsAppSendingWorker');

/**
 * WhatsApp Sending Worker
 * Processes WhatsApp message sending with automatic retries for retryable errors
 */
export class WhatsAppSendingWorker extends BaseWorker<WhatsAppSendingJob> {
  constructor(concurrency: number = 5) {
    super(QueueName.WHATSAPP_SENDING, concurrency);
  }

  protected async process(job: Job<WhatsAppSendingJob>): Promise<any> {
    const { userId, message, channelConfig } = job.data;
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 5;

    logger.info('Processing WhatsApp message', {
      jobId: job.id,
      userId,
      attemptNumber,
      maxAttempts,
      messageLength: message.content?.length || 0,
    });

    try {
      // Create WhatsApp adapter instance
      const whatsappAdapter = new WhatsAppAdapter();

      // Convert channelConfig to WhatsAppConfig format
      // apiToken and phoneNumber are required, so we provide defaults if missing
      // IMPORTANT: DB stores token as 'token' or 'apiToken', check both (same as admin.controller.ts)
      const adapterConfig: WhatsAppConfig = {
        provider: channelConfig.provider,
        instanceId: channelConfig.instanceId,
        apiToken: channelConfig.token || channelConfig.apiToken || '',
        phoneNumber: channelConfig.phoneNumber || '',
        phoneNumberId: channelConfig.phoneNumberId, // 360dialog
        accountSid: channelConfig.accountSid, // Twilio
        authToken: channelConfig.authToken, // Twilio
        webhookUrl: '', // Not needed for sending
        webhookSecret: undefined, // Not needed for sending
        wabaId: channelConfig.wabaId, // 360dialog (optional)
      };

      // Initialize adapter with channel-specific configuration
      await whatsappAdapter.initialize({
        config: adapterConfig,
      });

      // Send message (text or media with caption)
      if (message.mediaUrl && message.mediaType) {
        logger.info('Sending WhatsApp media message', {
          jobId: job.id,
          userId,
          mediaType: message.mediaType,
          hasCaption: !!message.content,
        });
        await whatsappAdapter.sendMedia(userId, message.mediaUrl, message.mediaType, message.content || '');
      } else {
      await whatsappAdapter.sendMessage(userId, message, adapterConfig);
      }

      logger.info('WhatsApp message sent successfully', {
        jobId: job.id,
        userId,
        attemptNumber,
      });

      return {
        success: true,
        userId,
        attemptNumber,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      const isRetryable = this.isRetryableError(error);
      const httpStatus = error.response?.status;
      const errorMessage = error.message || 'Unknown error';

      logger.error('WhatsApp message sending failed', {
        jobId: job.id,
        userId,
        attemptNumber,
        maxAttempts,
        error: errorMessage,
        isRetryable,
        httpStatus,
        willRetry: isRetryable && attemptNumber < maxAttempts,
      });

      // If it's a retryable error and we haven't exhausted attempts, throw to trigger retry
      if (isRetryable && attemptNumber < maxAttempts) {
        // Log retry information
        logger.warn('Retryable error detected, will retry', {
          jobId: job.id,
          userId,
          attemptNumber,
          nextAttempt: attemptNumber + 1,
          error: errorMessage,
          httpStatus,
        });
        throw error; // BullMQ will automatically retry with exponential backoff
      }

      // If not retryable or max attempts reached, mark as permanently failed
      const failureReason = isRetryable
        ? `Failed after ${attemptNumber} attempts: ${errorMessage}`
        : `Non-retryable error: ${errorMessage}`;

      logger.error('WhatsApp message permanently failed', {
        jobId: job.id,
        userId,
        attemptNumber,
        reason: failureReason,
        httpStatus,
      });

      throw new Error(failureReason);
    }
  }

  /**
   * Determines if an error is retryable
   * Retryable errors: 502, 503, 504, 520 (Cloudflare errors), network errors, timeouts
   * Non-retryable: 400, 401, 403, 404, 429 (rate limit handled separately), 500 (server error)
   */
  private isRetryableError(error: any): boolean {
    // HTTP status code errors
    if (error.response?.status) {
      const status = error.response.status;
      
      // Retryable HTTP errors (temporary server/gateway issues)
      if ([502, 503, 504, 520].includes(status)) {
        return true;
      }

      // Non-retryable HTTP errors (client errors, auth issues)
      if ([400, 401, 403, 404].includes(status)) {
        return false;
      }

      // Rate limiting - could be retryable but with longer delay
      if (status === 429) {
        return true; // Retry with longer backoff
      }

      // 500 errors - could be temporary, but also could be permanent
      // We'll treat them as retryable but with caution
      if (status === 500) {
        return true;
      }
    }

    // Network errors (retryable)
    if (error.code) {
      const retryableCodes = [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'EHOSTUNREACH',
        'EAI_AGAIN',
      ];
      if (retryableCodes.includes(error.code)) {
        return true;
      }
    }

    // Timeout errors (retryable)
    if (error.message) {
      const timeoutKeywords = ['timeout', 'timed out', 'ETIMEDOUT'];
      if (timeoutKeywords.some((keyword) => error.message.toLowerCase().includes(keyword))) {
        return true;
      }

      // Cloudflare errors (retryable)
      const cloudflareKeywords = [
        'cloudflare',
        'bad gateway',
        'unknown error',
        'web server is returning',
        '502',
        '520',
      ];
      if (cloudflareKeywords.some((keyword) => error.message.toLowerCase().includes(keyword))) {
        return true;
      }

      // Network-related errors (retryable)
      const networkKeywords = ['network', 'connection', 'econnreset', 'enotfound'];
      if (networkKeywords.some((keyword) => error.message.toLowerCase().includes(keyword))) {
        return true;
      }
    }

    // Request errors (no response received - retryable)
    if (error.request && !error.response) {
      return true;
    }

    // Default: non-retryable if we can't determine
    return false;
  }
}

