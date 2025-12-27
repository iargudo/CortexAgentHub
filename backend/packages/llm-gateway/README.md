# @cortex/llm-gateway

Unified gateway for multiple LLM providers with automatic load balancing, failover, and circuit breaker patterns.

## Features

- ✅ **Multiple Providers**: OpenAI, Anthropic, Google, Ollama, HuggingFace
- ✅ **Load Balancing**: Round-robin, least-latency, least-cost, priority strategies
- ✅ **Automatic Failover**: Seamless fallback to healthy providers
- ✅ **Circuit Breaker**: Prevents cascading failures
- ✅ **Retry Logic**: Exponential backoff for transient errors
- ✅ **Streaming Support**: Real-time token streaming
- ✅ **Tool/Function Calling**: Native support for OpenAI and Anthropic
- ✅ **Embeddings**: Vector embeddings for RAG applications
- ✅ **Health Monitoring**: Automatic provider health checks
- ✅ **Cost Tracking**: Token usage and cost calculation

## Installation

```bash
pnpm add @cortex/llm-gateway
```

## Quick Start

### Basic Usage

```typescript
import { OpenAIProvider } from '@cortex/llm-gateway';

// Initialize provider
const provider = new OpenAIProvider();
await provider.initialize({
  provider: 'openai',
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0.7,
  maxTokens: 2000,
});

// Complete a prompt
const response = await provider.complete('What is the capital of France?', {
  temperature: 0.7,
  maxTokens: 100,
});

console.log(response.content); // "The capital of France is Paris."
console.log(response.tokensUsed); // { input: 8, output: 7, total: 15 }
console.log(response.cost); // { totalCost: 0.00045, currency: 'USD' }
```

### Streaming

```typescript
for await (const token of provider.stream('Tell me a story', {
  maxTokens: 500,
  onToken: (text) => process.stdout.write(text),
})) {
  if (!token.isComplete) {
    // Process token
  }
}
```

### Tool/Function Calling

```typescript
const response = await provider.complete('What is the weather in Paris?', {
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location'],
      },
    },
  ],
});

if (response.toolCalls) {
  for (const toolCall of response.toolCalls) {
    console.log(`Tool: ${toolCall.name}`);
    console.log(`Parameters:`, toolCall.parameters);
  }
}
```

## Load Balancer

The load balancer distributes requests across multiple providers with automatic failover.

### Configuration

```typescript
import { LoadBalancer } from '@cortex/llm-gateway';

const loadBalancer = new LoadBalancer({
  strategy: 'least-latency', // 'round-robin' | 'least-latency' | 'least-cost' | 'priority'
  fallbackEnabled: true,
  retryAttempts: 3,
  retryDelay: 1000,
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
  },
  providers: [
    {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: process.env.OPENAI_API_KEY,
      temperature: 0.7,
    },
    {
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      apiKey: process.env.ANTHROPIC_API_KEY,
      temperature: 0.7,
    },
    {
      provider: 'ollama',
      model: 'llama2',
      baseURL: 'http://localhost:11434',
    },
  ],
});

await loadBalancer.initialize();
```

### Usage

```typescript
// The load balancer automatically selects the best provider
const response = await loadBalancer.complete('Explain quantum computing', {
  maxTokens: 500,
});

console.log(`Used provider: ${response.provider}`);
console.log(`Response: ${response.content}`);
```

### Health Monitoring

```typescript
// Check health of all providers
await loadBalancer.checkHealth();

// Get health status
const healthStatus = loadBalancer.getHealthStatus();
console.log(healthStatus);
/*
[
  {
    provider: 'openai',
    isHealthy: true,
    latency: 245,
    circuitBreakerOpen: false,
    lastChecked: 2025-10-11T10:30:00.000Z
  },
  ...
]
*/
```

## Provider-Specific Features

### OpenAI

```typescript
import { OpenAIProvider } from '@cortex/llm-gateway';

const openai = new OpenAIProvider();
await openai.initialize({
  provider: 'openai',
  model: 'gpt-4-turbo', // or 'gpt-3.5-turbo', 'gpt-4'
  apiKey: process.env.OPENAI_API_KEY,
});

// Embeddings
const embedding = await openai.embeddings('Search query text');
console.log(embedding.embedding); // number[]
```

### Anthropic (Claude)

```typescript
import { AnthropicProvider } from '@cortex/llm-gateway';

const anthropic = new AnthropicProvider();
await anthropic.initialize({
  provider: 'anthropic',
  model: 'claude-3-opus', // or 'claude-3-sonnet', 'claude-3-haiku'
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude has 200K context window
const response = await anthropic.complete(longDocument, {
  maxTokens: 4096,
});
```

### Ollama (Local Models)

```typescript
import { OllamaProvider } from '@cortex/llm-gateway';

const ollama = new OllamaProvider();
await ollama.initialize({
  provider: 'ollama',
  model: 'llama2', // or 'mistral', 'codellama', etc.
  baseURL: 'http://localhost:11434',
});

// Pull model if not available
await ollama.pullModel('llama2');

// List available models
const models = await ollama.listModels();
console.log(models); // ['llama2', 'mistral', ...]

// Zero cost for local models!
const response = await ollama.complete('Hello!', {});
console.log(response.cost.totalCost); // 0
```

### Google (Gemini)

```typescript
import { GoogleProvider } from '@cortex/llm-gateway';

const google = new GoogleProvider();
await google.initialize({
  provider: 'google',
  model: 'gemini-pro', // or 'gemini-ultra'
  apiKey: process.env.GOOGLE_API_KEY,
});

// Gemini Pro is very cost-effective
const response = await google.complete('Summarize this text', {
  maxTokens: 1000,
});
```

### HuggingFace

```typescript
import { HuggingFaceProvider } from '@cortex/llm-gateway';

const hf = new HuggingFaceProvider();
await hf.initialize({
  provider: 'huggingface',
  model: 'mistralai/Mistral-7B-Instruct-v0.2',
  apiKey: process.env.HUGGINGFACE_API_KEY,
  metadata: {
    embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
  },
});

// Use any HF model via Inference API
const response = await hf.complete('Translate to French: Hello', {});
```

## Load Balancing Strategies

### Round-Robin
Distributes requests evenly across all providers.
```typescript
strategy: 'round-robin'
```

### Least-Latency
Routes to the provider with the lowest average latency.
```typescript
strategy: 'least-latency'
```

### Least-Cost
Routes to the most cost-effective provider.
```typescript
strategy: 'least-cost'
```

### Priority
Uses providers in the order specified in configuration.
```typescript
strategy: 'priority'
```

## Error Handling

All providers throw standardized `LLMError`:

```typescript
import { LLMError, ERROR_CODES } from '@cortex/shared';

try {
  const response = await provider.complete('Hello', {});
} catch (error) {
  if (error instanceof LLMError) {
    console.error(`Error code: ${error.code}`);
    console.error(`Provider: ${error.metadata.provider}`);
    console.error(`Model: ${error.metadata.model}`);
  }
}
```

## Performance Considerations

- **Caching**: Consider implementing response caching for common queries
- **Connection Pooling**: Reuse provider instances
- **Parallel Requests**: Use load balancer for concurrent requests
- **Cost Optimization**: Use `least-cost` strategy for non-critical requests
- **Local First**: Use Ollama for development to avoid API costs

## Cost Comparison

Approximate costs per 1M tokens (as of 2025):

| Provider | Model | Input | Output |
|----------|-------|-------|--------|
| OpenAI | GPT-4 | $30 | $60 |
| OpenAI | GPT-4 Turbo | $10 | $30 |
| OpenAI | GPT-3.5 Turbo | $0.50 | $1.50 |
| Anthropic | Claude 3 Opus | $15 | $75 |
| Anthropic | Claude 3 Sonnet | $3 | $15 |
| Anthropic | Claude 3 Haiku | $0.25 | $1.25 |
| Google | Gemini Pro | $0.25 | $0.50 |
| Ollama | All Models | $0 | $0 |

## Testing

```typescript
// Check if provider is healthy
const isHealthy = await provider.isHealthy();

// Get provider capabilities
console.log(provider.supportsMCP); // true/false
console.log(provider.supportsTools); // true/false
console.log(provider.maxTokens); // e.g., 8192
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  ILLMProvider,
  CompletionOptions,
  CompletionResponse,
  StreamOptions,
  Token,
} from '@cortex/llm-gateway';
```

## License

MIT
