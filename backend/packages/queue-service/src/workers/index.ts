import { MessageProcessingWorker } from './MessageProcessingWorker';
import { WebhookProcessingWorker } from './WebhookProcessingWorker';
import { EmailSendingWorker } from './EmailSendingWorker';
import { DocumentProcessingWorker } from './DocumentProcessingWorker';
import { WhatsAppSendingWorker } from './WhatsAppSendingWorker';
import { WhatsAppWebhookIncomingWorker } from './WhatsAppWebhookIncomingWorker';
import { createLogger } from '@cortex/shared';

const logger = createLogger('WorkerManager');

/**
 * Worker Manager
 * Starts and manages all workers
 */
export class WorkerManager {
  private workers: Array<any> = [];

  /**
   * Start all workers
   */
  async startAll(): Promise<void> {
    logger.info('Starting all workers...');

    this.workers = [
      new MessageProcessingWorker(10),
      new WebhookProcessingWorker(15),
      new EmailSendingWorker(5),
      new WhatsAppSendingWorker(5),
    ];

    logger.info(`Started ${this.workers.length} workers`);
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    logger.info('Stopping all workers...');

    await Promise.all(this.workers.map((worker) => worker.close()));

    logger.info('All workers stopped');
  }

  /**
   * Pause all workers
   */
  async pauseAll(): Promise<void> {
    logger.info('Pausing all workers...');

    await Promise.all(this.workers.map((worker) => worker.pause()));

    logger.info('All workers paused');
  }

  /**
   * Resume all workers
   */
  async resumeAll(): Promise<void> {
    logger.info('Resuming all workers...');

    await Promise.all(this.workers.map((worker) => worker.resume()));

    logger.info('All workers resumed');
  }
}

// CLI entry point for starting workers
if (require.main === module) {
  const workerManager = new WorkerManager();

  workerManager.startAll().then(() => {
    logger.info('Workers are running. Press Ctrl+C to exit.');

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down workers...');
      await workerManager.stopAll();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down workers...');
      await workerManager.stopAll();
      process.exit(0);
    });
  });
}

export * from './MessageProcessingWorker';
export * from './WebhookProcessingWorker';
export * from './EmailSendingWorker';
export * from './DocumentProcessingWorker';
export * from './WhatsAppSendingWorker';
export * from './WhatsAppWebhookIncomingWorker';
