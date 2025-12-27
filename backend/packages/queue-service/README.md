# @cortex/queue-service

BullMQ-based queue service for CortexMCP - Provides reliable job processing with Redis.

## Features

- **5 Queue Types**: Message processing, webhooks, emails, analytics, notifications
- **BullMQ Integration**: Powerful Redis-based queue system
- **Worker System**: Dedicated workers for each queue type
- **Retry Logic**: Automatic retry with exponential backoff
- **Job Priority**: Priority-based job processing
- **Rate Limiting**: Built-in rate limiting per worker
- **Monitoring**: Queue statistics and health checks
- **Graceful Shutdown**: Proper cleanup on exit

## Why BullMQ over RabbitMQ?

- ✅ **Simpler Setup**: Uses existing Redis infrastructure (no separate service)
- ✅ **Better Performance**: Lower latency for small to medium workloads
- ✅ **Easier Monitoring**: Built-in Redis-based monitoring
- ✅ **TypeScript First**: Native TypeScript support
- ✅ **Flexible**: Easy to add/modify queues
- ✅ **Cost Effective**: No additional infrastructure needed

## Installation

```bash
pnpm install
```

## Queue Types

### 1. Message Processing (`message-processing`)
Processes incoming messages from all channels through the AI orchestrator.

```typescript
await queueManager.addJob(
  QueueName.MESSAGE_PROCESSING,
  'process-message',
  {
    messageId: 'msg-123',
    channelType: 'whatsapp',
    userId: 'user-456',
    content: 'Hello!',
    timestamp: new Date().toISOString(),
  }
);
```

### 2. Webhook Processing (`webhook-processing`)
Handles incoming webhooks from external services asynchronously.

```typescript
await queueManager.addJob(
  QueueName.WEBHOOK_PROCESSING,
  'process-webhook',
  {
    webhookId: 'wh-123',
    channel: 'telegram',
    payload: { /* webhook data */ },
    headers: { /* request headers */ },
    receivedAt: new Date().toISOString(),
  }
);
```

### 3. Email Sending (`email-sending`)
Queues emails for asynchronous sending.

```typescript
await queueManager.addJob(
  QueueName.EMAIL_SENDING,
  'send-email',
  {
    to: 'user@example.com',
    from: 'noreply@cortex.com',
    subject: 'Welcome!',
    body: 'Hello...',
    html: '<p>Hello...</p>',
  }
);
```

### 4. Analytics (`analytics`)
Processes analytics events for aggregation.

```typescript
await queueManager.addJob(
  QueueName.ANALYTICS,
  'track-event',
  {
    event: 'message_sent',
    data: { tokens: 100, cost: 0.002 },
    userId: 'user-123',
    timestamp: new Date().toISOString(),
  }
);
```

### 5. Notifications (`notifications`)
Sends notifications to users via various channels.

```typescript
await queueManager.addJob(
  QueueName.NOTIFICATIONS,
  'send-notification',
  {
    userId: 'user-123',
    type: 'email',
    title: 'New Message',
    message: 'You have a new message',
  }
);
```

## Usage

### Initialize Queue Manager

```typescript
import { getQueueManager } from '@cortex/queue-service';

const queueManager = getQueueManager();
```

### Add Jobs

```typescript
// Single job
const jobId = await queueManager.addJob(
  QueueName.MESSAGE_PROCESSING,
  'process-message',
  {
    messageId: 'msg-123',
    channelType: 'webchat',
    userId: 'user-456',
    content: 'Hello!',
    timestamp: new Date().toISOString(),
  },
  {
    priority: 1, // Higher priority
    delay: 5000, // Delay by 5 seconds
    attempts: 5, // Retry up to 5 times
  }
);

// Bulk jobs
const jobIds = await queueManager.addBulk(
  QueueName.MESSAGE_PROCESSING,
  [
    { name: 'process-message', data: { /* ... */ } },
    { name: 'process-message', data: { /* ... */ } },
  ]
);
```

### Get Queue Statistics

```typescript
// Single queue stats
const stats = await queueManager.getQueueStats(QueueName.MESSAGE_PROCESSING);
// {
//   queueName: 'message-processing',
//   waiting: 10,
//   active: 5,
//   completed: 100,
//   failed: 2,
//   delayed: 3
// }

// All queues stats
const allStats = await queueManager.getAllQueueStats();
```

### Queue Management

```typescript
// Pause a queue
await queueManager.pauseQueue(QueueName.MESSAGE_PROCESSING);

// Resume a queue
await queueManager.resumeQueue(QueueName.MESSAGE_PROCESSING);

// Clean completed jobs (older than 1 hour)
await queueManager.cleanQueue(
  QueueName.MESSAGE_PROCESSING,
  3600 * 1000, // 1 hour in ms
  100, // limit
  'completed'
);

// Drain all jobs from a queue
await queueManager.drainQueue(QueueName.MESSAGE_PROCESSING);
```

### Health Check

```typescript
const health = await queueManager.healthCheck();
// {
//   healthy: true,
//   queues: {
//     'message-processing': true,
//     'webhook-processing': true,
//     'email-sending': true,
//     'analytics': true,
//     'notifications': true
//   }
// }
```

## Workers

Workers process jobs from queues. Each worker can have different concurrency settings.

### Start Workers

```bash
# Start all workers
pnpm worker

# Or programmatically
import { WorkerManager } from '@cortex/queue-service';

const workerManager = new WorkerManager();
await workerManager.startAll();
```

### Worker Configuration

Workers are configured with:
- **Concurrency**: Number of jobs processed simultaneously
- **Rate Limiting**: Max jobs per time window
- **Retry Logic**: Exponential backoff on failures

Example worker configuration:
```typescript
new MessageProcessingWorker(10); // Process 10 jobs concurrently
```

### Creating Custom Workers

```typescript
import { BaseWorker } from '@cortex/queue-service';
import { QueueName } from '@cortex/queue-service';

class MyCustomWorker extends BaseWorker<MyJobData> {
  constructor() {
    super(QueueName.MESSAGE_PROCESSING, 5); // 5 concurrent jobs
  }

  protected async process(job: Job<MyJobData>): Promise<any> {
    // Process the job
    const { data } = job;

    // Your processing logic here

    return { status: 'completed' };
  }
}
```

## Job Options

```typescript
interface JobOptions {
  priority?: number;        // Job priority (higher = processed first)
  delay?: number;           // Delay in ms before processing
  attempts?: number;        // Max retry attempts
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;          // Backoff delay in ms
  };
  removeOnComplete?: boolean | number;  // Remove on completion
  removeOnFail?: boolean | number;      // Remove on failure
}
```

## Monitoring

### BullBoard (Optional)

Install BullBoard for a web UI:

```bash
pnpm add @bull-board/api @bull-board/fastify
```

Add to your API server:
```typescript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';

const serverAdapter = new FastifyAdapter();

createBullBoard({
  queues: [
    new BullMQAdapter(queueManager.getQueue(QueueName.MESSAGE_PROCESSING)),
    new BullMQAdapter(queueManager.getQueue(QueueName.WEBHOOK_PROCESSING)),
    // ... other queues
  ],
  serverAdapter,
});

serverAdapter.setBasePath('/admin/queues');
fastify.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues' });
```

Access at: `http://localhost:3000/admin/queues`

### Redis Commander

Monitor queues in Redis:

```bash
docker run -d \
  -p 8081:8081 \
  -e REDIS_HOSTS=local:redis:6379 \
  rediscommander/redis-commander
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
```

## Architecture

```
Client/Webhook
    ↓
API Service → Add Job to Queue
    ↓
Redis (BullMQ)
    ↓
Workers (process jobs)
    ↓
- Message Processing Worker (10 concurrent)
- Webhook Processing Worker (15 concurrent)
- Email Sending Worker (5 concurrent)
- Analytics Worker (10 concurrent)
- Notification Worker (5 concurrent)
```

## Benefits

### Reliability
- Jobs are persisted in Redis
- Automatic retry on failure
- Exponential backoff
- Job status tracking

### Performance
- Asynchronous processing
- Configurable concurrency
- Rate limiting
- Priority queues

### Scalability
- Horizontal scaling (multiple workers)
- Independent queue processing
- Load distribution
- Graceful degradation

### Monitoring
- Real-time statistics
- Job history
- Failure tracking
- Performance metrics

## Integration with API Service

In your API service:

```typescript
import { getQueueManager, QueueName } from '@cortex/queue-service';

// Initialize
const queueManager = getQueueManager();

// In webhook handler
fastify.post('/webhooks/whatsapp', async (request, reply) => {
  // Queue the webhook for async processing
  await queueManager.addJob(
    QueueName.WEBHOOK_PROCESSING,
    'process-whatsapp-webhook',
    {
      webhookId: `wh-${Date.now()}`,
      channel: 'whatsapp',
      payload: request.body,
      headers: request.headers,
      receivedAt: new Date().toISOString(),
    }
  );

  // Return immediate acknowledgment
  return { success: true };
});
```

## Production Considerations

1. **Redis Persistence**: Enable AOF in Redis for durability
2. **Worker Scaling**: Run workers on separate instances
3. **Monitoring**: Set up alerts for failed jobs
4. **Job Retention**: Configure removeOnComplete/removeOnFail
5. **Rate Limits**: Adjust per your workload
6. **Dead Letter Queue**: Handle repeatedly failing jobs

## License

MIT
