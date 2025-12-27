import { Worker, Job } from 'bullmq';
import { QueueConnection } from '../connection';
import { QueueName } from '../jobs/types';
import { createLogger } from '@cortex/shared';

const logger = createLogger('BaseWorker');

/**
 * Base Worker
 * Abstract class for all job processors
 */
export abstract class BaseWorker<T = any> {
  protected worker: Worker;
  protected queueName: QueueName;

  constructor(queueName: QueueName, concurrency: number = 5) {
    this.queueName = queueName;

    this.worker = new Worker(
      queueName,
      async (job: Job<T>) => {
        logger.info(`Processing job: ${job.name}`, {
          jobId: job.id,
          queue: queueName,
        });

        try {
          const result = await this.process(job);

          logger.info(`Job completed: ${job.name}`, {
            jobId: job.id,
            queue: queueName,
          });

          return result;
        } catch (error: any) {
          logger.error(`Job failed: ${job.name}`, {
            jobId: job.id,
            queue: queueName,
            error: error.message,
          });

          throw error;
        }
      },
      {
        connection: QueueConnection.getConnection(),
        concurrency,
        limiter: {
          max: 10, // Max jobs per duration
          duration: 1000, // Duration in ms
        },
      }
    );

    this.setupEventListeners();

    logger.info(`Worker started for queue: ${queueName}`, { concurrency });
  }

  /**
   * Abstract process method - must be implemented by subclasses
   */
  protected abstract process(job: Job<T>): Promise<any>;

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.worker.on('completed', (job) => {
      logger.debug(`Worker completed job`, {
        jobId: job.id,
        queue: this.queueName,
      });
    });

    this.worker.on('failed', (job, error) => {
      logger.error(`Worker failed job`, {
        jobId: job?.id,
        queue: this.queueName,
        error: error.message,
      });
    });

    this.worker.on('error', (error) => {
      logger.error(`Worker error in ${this.queueName}`, {
        error: error.message,
      });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn(`Job stalled in ${this.queueName}`, { jobId });
    });
  }

  /**
   * Close the worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info(`Worker closed for queue: ${this.queueName}`);
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause();
    logger.info(`Worker paused for queue: ${this.queueName}`);
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
    logger.info(`Worker resumed for queue: ${this.queueName}`);
  }
}
