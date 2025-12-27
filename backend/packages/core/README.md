# @cortex/core

Core orchestration engine for CortexMCP that coordinates message processing between channels, MCP server, and LLM providers.

## Features

- ✅ **AI Orchestrator**: Main processing pipeline coordinator
- ✅ **Message Router**: Intelligent LLM selection based on rules
- ✅ **Context Manager**: Conversation history and state management
- ✅ **Tool Execution**: Automatic MCP tool handling
- ✅ **Multi-turn Conversations**: Maintains context across messages
- ✅ **Priority-based Routing**: Route messages based on channel, user, time, etc.
- ✅ **History Trimming**: Automatic conversation history management
- ✅ **Error Handling**: Graceful error recovery

## Installation

```bash
pnpm add @cortex/core
```

## Quick Start

### Basic Setup

```typescript
import { AIOrchestrator, MessageRouter, ContextManager } from '@cortex/core';
import { MCPServer } from '@cortex/mcp-server';
import { LoadBalancer } from '@cortex/llm-gateway';

// Initialize MCP Server
const mcpServer = new MCPServer({
  port: 8080,
  tools: [],
  resources: [],
  contextStore: {
    provider: 'redis',
    ttl: 3600,
    config: { url: process.env.REDIS_URL },
  },
  security: {
    enablePermissions: true,
    enableRateLimiting: true,
  },
});

await mcpServer.start();

// Initialize LLM Gateway
const llmGateway = new LoadBalancer({
  strategy: 'least-cost',
  fallbackEnabled: true,
  retryAttempts: 3,
  retryDelay: 1000,
  providers: [
    {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      apiKey: process.env.OPENAI_API_KEY,
    },
  ],
});

await llmGateway.initialize();

// Initialize Message Router
const messageRouter = new MessageRouter({
  rules: [
    {
      id: 'premium-users',
      name: 'Premium Users',
      priority: 100,
      active: true,
      condition: {
        userSegment: 'premium',
      },
      action: {
        llmProvider: 'openai',
        llmModel: 'gpt-4',
        temperature: 0.7,
      },
    },
  ],
  defaultProvider: 'openai',
  defaultModel: 'gpt-3.5-turbo',
});

// Initialize Context Manager
const contextManager = new ContextManager(mcpServer, {
  provider: 'redis',
  ttl: 3600,
  maxHistoryLength: 50,
  compressionEnabled: false,
});

// Initialize AI Orchestrator
const orchestrator = new AIOrchestrator(
  mcpServer,
  llmGateway,
  messageRouter,
  contextManager,
  {
    defaultLLMProvider: 'openai',
    defaultLLMModel: 'gpt-3.5-turbo',
    routingRules: [],
    contextTTL: 3600,
    enableToolExecution: true,
    maxToolExecutions: 5,
  }
);

// Process a message
const result = await orchestrator.processMessage({
  channelType: 'webchat',
  channelUserId: 'user123',
  content: 'Hello, how are you?',
});

console.log(result.outgoingMessage.content);
```

## AI Orchestrator

The orchestrator coordinates the entire message processing pipeline:

### Message Flow

1. **Get/Create Context**: Retrieve or create conversation context from MCP
2. **Route Message**: Determine which LLM to use based on routing rules
3. **Add to History**: Store user message in conversation history
4. **Get Tools**: Retrieve available MCP tools for the channel
5. **Build Prompt**: Construct prompt with conversation history
6. **Call LLM**: Execute LLM completion with tools
7. **Execute Tools**: Run any tool calls returned by LLM
8. **Process Results**: Incorporate tool results into final response
9. **Update Context**: Save assistant message and tool executions
10. **Return Result**: Send formatted response back to channel

### Processing a Message

```typescript
const result = await orchestrator.processMessage({
  channelType: 'whatsapp',
  channelUserId: '+1234567890',
  content: 'What is the weather in New York?',
  metadata: {
    conversationId: 'conv-123',
    userSegment: 'premium',
  },
});

console.log('Response:', result.outgoingMessage.content);
console.log('Provider:', result.llmProvider);
console.log('Tokens:', result.tokensUsed);
console.log('Cost:', result.cost);
console.log('Processing time:', result.processingTimeMs, 'ms');
console.log('Tools executed:', result.toolExecutions.length);
```

### Health Check

```typescript
const isHealthy = await orchestrator.isHealthy();
console.log('Orchestrator healthy:', isHealthy);

const stats = await orchestrator.getStats();
console.log('MCP Server stats:', stats.mcpServerStats);
console.log('LLM health:', stats.llmHealthStatus);
```

## Message Router

Routes messages to appropriate LLM providers based on configurable rules.

### Routing Rules

```typescript
import { MessageRouter } from '@cortex/core';

const router = new MessageRouter({
  rules: [
    // Priority 100: Route urgent messages to GPT-4
    {
      id: 'urgent',
      name: 'Urgent Messages',
      priority: 100,
      active: true,
      condition: {
        messagePattern: '(urgent|emergency|asap)',
      },
      action: {
        llmProvider: 'openai',
        llmModel: 'gpt-4',
        temperature: 0.5,
      },
    },

    // Priority 90: Premium users get Claude 3 Opus
    {
      id: 'premium',
      name: 'Premium Users',
      priority: 90,
      active: true,
      condition: {
        userSegment: 'premium',
      },
      action: {
        llmProvider: 'anthropic',
        llmModel: 'claude-3-opus',
        temperature: 0.7,
      },
    },

    // Priority 50: Use local models during business hours
    {
      id: 'business-hours',
      name: 'Business Hours',
      priority: 50,
      active: true,
      condition: {
        timeRange: {
          start: '09:00',
          end: '17:00',
        },
      },
      action: {
        llmProvider: 'ollama',
        llmModel: 'llama2',
        temperature: 0.7,
      },
    },

    // Priority 10: WhatsApp users get cost-effective model
    {
      id: 'whatsapp',
      name: 'WhatsApp Users',
      priority: 10,
      active: true,
      condition: {
        channelType: 'whatsapp',
      },
      action: {
        llmProvider: 'openai',
        llmModel: 'gpt-3.5-turbo',
        temperature: 0.7,
      },
    },
  ],
  defaultProvider: 'openai',
  defaultModel: 'gpt-3.5-turbo',
});
```

### Route a Message

```typescript
const action = router.route({
  channelType: 'whatsapp',
  channelUserId: '+1234567890',
  content: 'Hello!',
  metadata: { userSegment: 'premium' },
});

console.log('Selected provider:', action.llmProvider);
console.log('Selected model:', action.llmModel);
```

### Test Routing

```typescript
const testResult = router.testRoute({
  channelType: 'telegram',
  channelUserId: '123456',
  content: 'This is urgent!',
});

console.log('Matched:', testResult.matched);
console.log('Rule:', testResult.rule?.name);
console.log('Action:', testResult.action);
```

### Dynamic Rule Management

```typescript
// Add rule
router.addRule({
  id: 'new-rule',
  name: 'New Rule',
  priority: 80,
  active: true,
  condition: { channelType: 'email' },
  action: { llmProvider: 'google', llmModel: 'gemini-pro' },
});

// Update rule
router.updateRule('new-rule', { priority: 85 });

// Remove rule
router.removeRule('new-rule');

// Get all rules
const rules = router.getRules();
console.log('Total rules:', rules.length);

// Get active rules only
const activeRules = router.getActiveRules();
console.log('Active rules:', activeRules.length);
```

## Context Manager

Manages conversation history and context persistence.

### Get or Create Context

```typescript
const context = await contextManager.getOrCreateContext(
  'conversation-123',
  'webchat',
  'user-456'
);

console.log('Session ID:', context.sessionId);
console.log('Created at:', context.createdAt);
```

### Manage Conversation History

```typescript
// Add user message
await contextManager.addMessage(sessionId, 'user', 'What is AI?');

// Add assistant message
await contextManager.addMessage(sessionId, 'assistant', 'AI is artificial intelligence...');

// Add system message
await contextManager.addMessage(sessionId, 'system', 'Context updated');

// Get history
const history = await contextManager.getHistory(sessionId);
console.log('Messages:', history.length);

// Format for LLM
const formatted = contextManager.formatHistoryForLLM(history);
console.log(formatted);

// Clear history
await contextManager.clearHistory(sessionId);
```

### Tool Execution Tracking

```typescript
// Add tool execution
await contextManager.addToolExecution(sessionId, {
  id: 'exec-123',
  toolName: 'search_web',
  parameters: { query: 'AI news' },
  result: { results: [...] },
  status: 'success',
  executionTimeMs: 250,
  executedAt: new Date().toISOString(),
});

// Get all tool executions
const executions = await contextManager.getToolExecutions(sessionId);
console.log('Tools executed:', executions.length);
```

### Context Statistics

```typescript
// Get summary
const summary = await contextManager.getContextSummary(sessionId);
console.log('Message count:', summary.messageCount);
console.log('Tool executions:', summary.toolExecutionCount);
console.log('Last activity:', summary.lastActivity);

// Get detailed stats
const stats = await contextManager.getStats(sessionId);
console.log('User messages:', stats.userMessages);
console.log('Assistant messages:', stats.assistantMessages);
console.log('Successful tools:', stats.successfulTools);
console.log('Failed tools:', stats.failedTools);
```

### TTL Management

```typescript
// Extend TTL
await contextManager.extendTTL(sessionId, 7200); // 2 hours

// Delete context
await contextManager.deleteContext(sessionId);
```

## Routing Conditions

Available condition types:

- **channelType**: Match specific channel(s)
- **userId**: Match specific user ID(s)
- **userSegment**: Match user segment ('premium', 'free', etc.)
- **messagePattern**: Regex pattern matching
- **timeRange**: Match time of day (HH:mm format)
- **custom**: Custom conditions (extensible)

## Configuration

### Orchestrator Config

```typescript
interface OrchestratorConfig {
  defaultLLMProvider: LLMProvider;
  defaultLLMModel: string;
  routingRules: RoutingRule[];
  contextTTL: number; // seconds
  enableToolExecution: boolean;
  maxToolExecutions: number;
}
```

### Router Config

```typescript
interface MessageRouterConfig {
  rules: RoutingRule[];
  defaultProvider: LLMProvider;
  defaultModel: string;
}
```

### Context Manager Config

```typescript
interface ContextManagerConfig {
  provider: 'redis' | 'memory';
  ttl: number; // seconds
  maxHistoryLength: number;
  compressionEnabled: boolean;
}
```

## Error Handling

The orchestrator provides graceful error handling:

```typescript
try {
  const result = await orchestrator.processMessage(message);
} catch (error) {
  console.error('Processing failed:', error);
}

// Errors are also caught internally and returned as results
const result = await orchestrator.processMessage(message);
if (result.metadata?.error) {
  console.error('Error:', result.metadata.error);
}
```

## Performance

- **Async Processing**: All operations are asynchronous
- **Context Caching**: Redis-based caching for fast context retrieval
- **History Trimming**: Automatic pruning of old messages
- **Tool Limits**: Configurable max tool executions per message
- **Parallel Operations**: LLM and MCP operations can run in parallel

## Best Practices

1. **Set appropriate history length**: Balance context quality vs token cost
2. **Use routing rules**: Route expensive models only when needed
3. **Enable compression**: For long conversations (future feature)
4. **Monitor tool executions**: Set reasonable limits to prevent abuse
5. **Configure TTLs**: Match your use case (short vs long conversations)

## TypeScript Support

Full TypeScript support with comprehensive type definitions.

## License

MIT
