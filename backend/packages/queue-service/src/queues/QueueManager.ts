import { Queue, QueueEvents } from 'bullmq';
import { QueueConnection } from '../connection';
import { QueueName, JobOptions } from '../jobs/types';
import { createLogger } from '@cortex/shared';

const logger = createLogger('QueueManager');

/**
 * Queue Manager
 * Manages all BullMQ queues
 */
export class QueueManager {
  private queues: Map<QueueName, Queue> = new Map();
  private queueEvents: Map<QueueName, QueueEvents> = new Map();
  private connection = QueueConnection.getConnection();

  constructor() {
    this.initializeQueues();
    this.setupEventListeners();
  }

  /**
   * Initialize all queues
   */
  private initializeQueues(): void {
    Object.values(QueueName).forEach((queueName) => {
      const queue = new Queue(queueName, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 500, // Keep last 500 failed jobs
        },
      });

      this.queues.set(queueName, queue);
      logger.info(`Queue initialized: ${queueName}`);
    });
  }

  /**
   * Setup event listeners for all queues
   */
  private setupEventListeners(): void {
    Object.values(QueueName).forEach((queueName) => {
      const events = new QueueEvents(queueName, {
        connection: this.connection,
      });

      events.on('completed', ({ jobId }) => {
        logger.debug(`Job completed in ${queueName}`, { jobId });
      });

      events.on('failed', ({ jobId, failedReason }) => {
        logger.error(`Job failed in ${queueName}`, {
          jobId,
          reason: failedReason,
        });
      });

      events.on('stalled', ({ jobId }) => {
        logger.warn(`Job stalled in ${queueName}`, { jobId });
      });

      this.queueEvents.set(queueName, events);
    });
  }

  /**
   * Get a queue by name
   */
  getQueue(queueName: QueueName): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }
    return queue;
  }

  /**
   * Add a job to a queue
   */
  async addJob<T = any>(
    queueName: QueueName,
    jobName: string,
    data: T,
    options?: JobOptions
  ): Promise<string> {
    const queue = this.getQueue(queueName);

    const job = await queue.add(jobName, data, {
      ...options,
      jobId: options?.priority ? undefined : `${jobName}-${Date.now()}`,
    });

    logger.info(`Job added to ${queueName}`, {
      jobId: job.id,
      jobName,
    });

    return job.id!;
  }

  /**
   * Add bulk jobs to a queue
   */
  async addBulk<T = any>(
    queueName: QueueName,
    jobs: Array<{ name: string; data: T; options?: JobOptions }>
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);

    const bullJobs = await queue.addBulk(
      jobs.map((job) => ({
        name: job.name,
        data: job.data,
        opts: job.options,
      }))
    );

    logger.info(`Bulk jobs added to ${queueName}`, {
      count: bullJobs.length,
    });

    return bullJobs.map((job) => job.id!);
  }

  /**
   * Get job by ID
   */
  async getJob(queueName: QueueName, jobId: string) {
    const queue = this.getQueue(queueName);
    return queue.getJob(jobId);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: QueueName) {
    const queue = this.getQueue(queueName);

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Get stats for all queues
   */
  async getAllQueueStats() {
    const stats = await Promise.all(
      Array.from(this.queues.keys()).map((queueName) =>
        this.getQueueStats(queueName)
      )
    );

    return stats;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: QueueName): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.pause();
    logger.info(`Queue paused: ${queueName}`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: QueueName): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.resume();
    logger.info(`Queue resumed: ${queueName}`);
  }

  /**
   * Clean a queue (remove completed/failed jobs)
   */
  async cleanQueue(
    queueName: QueueName,
    grace: number = 0,
    limit: number = 100,
    type: 'completed' | 'failed' = 'completed'
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);
    const jobs = await queue.clean(grace, limit, type);
    logger.info(`Queue cleaned: ${queueName}`, {
      type,
      count: jobs.length,
    });
    return jobs;
  }

  /**
   * Reset statistics for all queues (remove all completed and failed jobs)
   */
  async resetAllStatistics(): Promise<{
    queues: Record<string, { completed: number; failed: number }>;
    totalCompleted: number;
    totalFailed: number;
  }> {
    const results: Record<string, { completed: number; failed: number }> = {};
    let totalCompleted = 0;
    let totalFailed = 0;

    for (const queueName of this.queues.keys()) {
      try {
        const queue = this.getQueue(queueName);
        
        // Clean completed jobs (remove all, no grace period, large limit)
        const completedJobs = await queue.clean(0, 10000, 'completed');
        
        // Clean failed jobs (remove all, no grace period, large limit)
        const failedJobs = await queue.clean(0, 10000, 'failed');
        
        const completedCount = completedJobs.length;
        const failedCount = failedJobs.length;
        
        results[queueName] = {
          completed: completedCount,
          failed: failedCount,
        };
        
        totalCompleted += completedCount;
        totalFailed += failedCount;
        
        logger.info(`Statistics reset for queue: ${queueName}`, {
          completed: completedCount,
          failed: failedCount,
        });
      } catch (error: any) {
        logger.error(`Failed to reset statistics for queue: ${queueName}`, {
          error: error.message,
        });
        results[queueName] = {
          completed: 0,
          failed: 0,
        };
      }
    }

    return {
      queues: results,
      totalCompleted,
      totalFailed,
    };
  }

  /**
   * Drain a queue (remove all jobs)
   */
  async drainQueue(queueName: QueueName): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.drain();
    logger.warn(`Queue drained: ${queueName}`);
  }

  /**
   * Close all queues and connections
   */
  async close(): Promise<void> {
    logger.info('Closing all queues...');

    // Close all queue events
    for (const events of this.queueEvents.values()) {
      await events.close();
    }

    // Close all queues
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    // Close Redis connection
    await QueueConnection.close();

    logger.info('All queues closed');
  }

  /**
   * Health check for queue system
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    queues: Record<string, boolean>;
  }> {
    const redisHealthy = await QueueConnection.healthCheck();

    const queueHealth: Record<string, boolean> = {};
    let allHealthy = redisHealthy;

    for (const [queueName, queue] of this.queues) {
      try {
        await queue.getJobCounts();
        queueHealth[queueName] = true;
      } catch (error) {
        queueHealth[queueName] = false;
        allHealthy = false;
      }
    }

    return {
      healthy: allHealthy,
      queues: queueHealth,
    };
  }
}

// Singleton instance
let queueManager: QueueManager | null = null;

export function getQueueManager(): QueueManager {
  if (!queueManager) {
    queueManager = new QueueManager();
  }
  return queueManager;
}
