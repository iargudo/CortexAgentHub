import { Job } from 'bullmq';
import { BaseWorker } from './BaseWorker';
import { QueueName, EmailSendingJob } from '../jobs/types';
import { createLogger } from '@cortex/shared';

const logger = createLogger('EmailSendingWorker');

/**
 * Email Sending Worker
 * Sends emails asynchronously
 */
export class EmailSendingWorker extends BaseWorker<EmailSendingJob> {
  constructor(concurrency: number = 5) {
    super(QueueName.EMAIL_SENDING, concurrency);
  }

  protected async process(job: Job<EmailSendingJob>): Promise<any> {
    const { to, from, subject, body } = job.data;

    logger.info('Sending email', {
      to,
      subject,
    });

    // In a real implementation, this would use nodemailer
    // or another email service

    await new Promise((resolve) => setTimeout(resolve, 200));

    return {
      to,
      from,
      status: 'sent',
      timestamp: new Date().toISOString(),
    };
  }
}
