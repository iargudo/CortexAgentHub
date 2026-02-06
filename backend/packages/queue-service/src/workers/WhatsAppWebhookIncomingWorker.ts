import { Job } from 'bullmq';
import { BaseWorker } from './BaseWorker';
import { QueueName, WhatsAppWebhookIncomingJob } from '../jobs/types';
import { createLogger } from '@cortex/shared';

const logger = createLogger('WhatsAppWebhookIncomingWorker');

/**
 * WhatsApp Webhook Incoming Worker
 * Processes incoming WhatsApp webhook payloads from the queue.
 * Processor function is injected from api-service (WebhooksController.processWhatsAppWebhookPayload).
 */
export class WhatsAppWebhookIncomingWorker extends BaseWorker<WhatsAppWebhookIncomingJob> {
  private processorFn?: (webhookBody: any) => Promise<void>;

  constructor(concurrency: number = 10) {
    super(QueueName.WHATSAPP_WEBHOOK_INCOMING, concurrency);
  }

  /**
   * Set the processor function (injected from WebhooksController)
   */
  setProcessorFn(fn: (webhookBody: any) => Promise<void>): void {
    this.processorFn = fn;
  }

  protected async process(job: Job<WhatsAppWebhookIncomingJob>): Promise<any> {
    const { webhookBody } = job.data;

    logger.info('Processing WhatsApp webhook from queue', {
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    });

    if (!this.processorFn) {
      throw new Error(
        'WhatsApp webhook processor not set. Call setProcessorFn() from api-service first.'
      );
    }

    await this.processorFn(webhookBody);

    return {
      jobId: job.id,
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
  }
}
