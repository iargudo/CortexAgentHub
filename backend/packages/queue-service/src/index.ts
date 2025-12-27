// Export main components
export * from './connection';
export * from './queues/QueueManager';
export * from './workers';
export * from './jobs/types';

import { getQueueManager } from './queues/QueueManager';
import { QueueConnection } from './connection';

/**
 * Initialize queue service
 */
export async function initializeQueueService() {
  const queueManager = getQueueManager();

  // Test connection
  const healthy = await QueueConnection.healthCheck();
  if (!healthy) {
    throw new Error('Failed to connect to Redis for queue service');
  }

  return queueManager;
}
