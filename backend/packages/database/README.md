# @cortex/database

Database client layer and repository pattern implementation for CortexMCP.

## Features

- **Connection Management**: Singleton database connection pool with health checks
- **Repository Pattern**: Type-safe repositories for all database tables
- **Migrations**: Automated database schema migrations
- **Seeding**: Initial data seeding for development
- **Transaction Support**: Built-in transaction handling
- **Query Logging**: Automatic query performance logging

## Installation

```bash
pnpm install
```

## Usage

### Initialize Database

```typescript
import { initializeDatabase } from '@cortex/database';

const { db, repositories } = await initializeDatabase();

// Use repositories
const conversations = await repositories.conversations.findAll();
const messages = await repositories.messages.findByConversationId('conv-123');
```

### Direct Connection

```typescript
import { getDatabase } from '@cortex/database';

const db = getDatabase();
const result = await db.query('SELECT * FROM conversations LIMIT 10');
```

### Using Repositories

#### Conversation Repository

```typescript
import { RepositoryFactory } from '@cortex/database';

const conversationRepo = RepositoryFactory.getConversationRepository();

// Find by ID
const conversation = await conversationRepo.findById('conv-123');

// Find by user
const userConversations = await conversationRepo.findByUserId('user-456');

// Find active conversations
const activeConvs = await conversationRepo.findActive(24); // Last 24 hours

// Get statistics
const stats = await conversationRepo.getStats();
// {
//   total: 1247,
//   active: 342,
//   byChannel: { whatsapp: 500, telegram: 400, ... },
//   byStatus: { active: 800, closed: 447 }
// }

// Create new conversation
const newConv = await conversationRepo.create({
  id: 'conv-new',
  user_id: 'user-123',
  channel_type: 'webchat',
  status: 'active',
});

// Update conversation
await conversationRepo.update('conv-123', { status: 'closed' });

// Delete conversation
await conversationRepo.delete('conv-123');
```

#### Message Repository

```typescript
import { RepositoryFactory } from '@cortex/database';

const messageRepo = RepositoryFactory.getMessageRepository();

// Find by conversation
const messages = await messageRepo.findByConversationId('conv-123', 50, 0);

// Find by user
const userMessages = await messageRepo.findByUserId('user-456');

// Search messages
const searchResults = await messageRepo.search('pricing', 20);

// Get token usage statistics
const tokenStats = await messageRepo.getTokenStats(
  new Date('2024-01-01'),
  new Date('2024-01-31')
);
// {
//   totalTokens: 125000,
//   totalCost: 15.75,
//   byProvider: {
//     openai: { tokens: 75000, cost: 11.25 },
//     anthropic: { tokens: 50000, cost: 4.50 }
//   }
// }

// Get message statistics
const stats = await messageRepo.getStats();
```

#### Tool Execution Repository

```typescript
import { RepositoryFactory } from '@cortex/database';

const toolRepo = RepositoryFactory.getToolExecutionRepository();

// Find by conversation
const executions = await toolRepo.findByConversationId('conv-123');

// Find by tool name
const searchExecutions = await toolRepo.findByToolName('search_knowledge_base');

// Find failed executions
const failed = await toolRepo.findFailed();

// Get statistics
const stats = await toolRepo.getStats();
// {
//   total: 1234,
//   successful: 1180,
//   failed: 54,
//   avgExecutionTime: 0.45,
//   byTool: {
//     search_knowledge_base: { count: 500, successRate: 0.98, avgTime: 0.42 }
//   }
// }

// Get top tools
const topTools = await toolRepo.getTopTools(10);
```

#### Channel Config Repository

```typescript
import { RepositoryFactory } from '@cortex/database';

const channelRepo = RepositoryFactory.getChannelConfigRepository();

// Find by type
const whatsappConfig = await channelRepo.findByType('whatsapp');

// Find all enabled
const enabledChannels = await channelRepo.findEnabled();

// Toggle enabled status
await channelRepo.toggleEnabled('ch-123', true);

// Update configuration
await channelRepo.updateConfig('ch-123', {
  provider: 'ultramsg',
  token: 'new-token',
});
```

#### LLM Config Repository

```typescript
import { RepositoryFactory } from '@cortex/database';

const llmRepo = RepositoryFactory.getLLMConfigRepository();

// Find by provider
const openaiConfigs = await llmRepo.findByProvider('openai');

// Find all enabled
const enabledLLMs = await llmRepo.findEnabled();

// Update priority
await llmRepo.updatePriority('llm-123', 1);

// Update configuration
await llmRepo.updateConfig('llm-123', {
  apiKey: 'new-key',
  temperature: 0.8,
});
```

### Transactions

```typescript
import { getDatabase } from '@cortex/database';

const db = getDatabase();

await db.transaction(async (client) => {
  // All queries in this block are part of the same transaction
  await client.query('INSERT INTO conversations ...');
  await client.query('INSERT INTO messages ...');
  // Automatically commits if successful, rolls back on error
});
```

### Migrations

Run database migrations:

```bash
# Run all pending migrations
pnpm migrate

# Check migration status
pnpm migrate status

# Rollback last migration (not implemented yet)
pnpm migrate rollback
```

Programmatic usage:

```typescript
import { MigrationRunner } from '@cortex/database';

const runner = new MigrationRunner();
await runner.run();
```

### Seeding

Seed initial data:

```bash
# Run all seeds
pnpm seed

# Clear seeded data
pnpm seed clear
```

Programmatic usage:

```typescript
import { SeedRunner } from '@cortex/database';

const runner = new SeedRunner();
await runner.run();
```

## Environment Variables

```bash
# Database connection
DATABASE_URL=postgresql://user:password@localhost:5432/cortex_mcp

# Connection pool settings
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=10000
```

## Repository Pattern

All repositories extend `BaseRepository<T>` which provides:

### Standard Methods

- `findById(id: string): Promise<T | null>`
- `findAll(filters?: Partial<T>, limit?: number, offset?: number): Promise<T[]>`
- `create(data: Partial<T>): Promise<T>`
- `update(id: string, data: Partial<T>): Promise<T | null>`
- `delete(id: string): Promise<boolean>`
- `count(filters?: Partial<T>): Promise<number>`
- `exists(id: string): Promise<boolean>`

### Custom Methods

Each repository can add custom methods specific to its domain. For example:

- `ConversationRepository.findActive(hours: number)`
- `MessageRepository.search(query: string)`
- `ToolExecutionRepository.getTopTools(limit: number)`

## Database Schema

The package works with the following tables:

- `conversations` - User conversations across channels
- `messages` - Individual messages with LLM metadata
- `tool_executions` - MCP tool execution logs
- `context_store` - Conversation context (TTL managed)
- `channel_configs` - Channel configurations
- `llm_configs` - LLM provider configurations
- `routing_rules` - Message routing rules
- `analytics_events` - Analytics event stream

## Health Checks

```typescript
import { getDatabase } from '@cortex/database';

const db = getDatabase();

// Check database health
const isHealthy = await db.healthCheck();

// Get connection pool statistics
const stats = db.getStats();
// { total: 20, idle: 15, waiting: 0 }
```

## Testing

```typescript
import { initializeDatabase } from '@cortex/database';

describe('Database Tests', () => {
  let db;
  let repositories;

  beforeAll(async () => {
    const init = await initializeDatabase(process.env.TEST_DATABASE_URL);
    db = init.db;
    repositories = init.repositories;
  });

  afterAll(async () => {
    await db.close();
  });

  it('should find conversations', async () => {
    const convs = await repositories.conversations.findAll();
    expect(convs).toBeDefined();
  });
});
```

## Architecture

```
@cortex/database
├── connection.ts           # Database connection manager
├── repositories/
│   ├── BaseRepository.ts   # Abstract base repository
│   ├── ConversationRepository.ts
│   ├── MessageRepository.ts
│   ├── ToolExecutionRepository.ts
│   ├── ChannelConfigRepository.ts
│   ├── LLMConfigRepository.ts
│   └── index.ts            # Repository factory
├── migrations/
│   └── runner.ts           # Migration runner
├── seeds/
│   └── runner.ts           # Seed runner
└── index.ts                # Main exports
```

## Best Practices

1. **Use Repositories**: Always use repositories instead of raw queries
2. **Transactions**: Use transactions for multi-step operations
3. **Connection Pooling**: The connection pool is managed automatically
4. **Error Handling**: All repository methods throw errors - catch them appropriately
5. **Logging**: Query logging is automatic - check logs for performance issues
6. **Type Safety**: All repositories are fully typed with TypeScript

## Performance Considerations

- Connection pooling is configured for optimal performance (max 20 connections)
- Queries are automatically logged with execution time
- Indexes are created on frequently queried columns
- Use `limit` and `offset` for pagination
- Use `count()` before fetching large result sets

## License

MIT
