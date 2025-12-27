/**
 * Application-wide constants
 */

export const DEFAULT_VALUES = {
  MCP_CONTEXT_TTL: 3600, // 1 hour
  MAX_CONVERSATION_HISTORY: 50,
  MAX_TOOL_EXECUTIONS: 10,
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_MAX_TOKENS: 2000,
  RATE_LIMIT_REQUESTS: 100,
  RATE_LIMIT_WINDOW: 60000, // 1 minute
} as const;

export const LLM_COSTS = {
  openai: {
    'gpt-4': { input: 0.00003, output: 0.00006 },
    'gpt-4-turbo': { input: 0.00001, output: 0.00003 },
    'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },
  },
  anthropic: {
    'claude-3-opus': { input: 0.000015, output: 0.000075 },
    'claude-3-sonnet': { input: 0.000003, output: 0.000015 },
    'claude-3-haiku': { input: 0.00000025, output: 0.00000125 },
  },
  google: {
    'gemini-pro': { input: 0.00000025, output: 0.0000005 },
    'gemini-ultra': { input: 0.000001, output: 0.000002 },
  },
  ollama: {
    'llama2': { input: 0, output: 0 },
    'mistral': { input: 0, output: 0 },
    'codellama': { input: 0, output: 0 },
  },
  huggingface: {
    'default': { input: 0.000001, output: 0.000001 },
  },
} as const;

export const LLM_MAX_TOKENS = {
  openai: {
    'gpt-4': 8192,
    'gpt-4-turbo': 128000,
    'gpt-3.5-turbo': 16385,
  },
  anthropic: {
    'claude-3-opus': 200000,
    'claude-3-sonnet': 200000,
    'claude-3-haiku': 200000,
  },
  google: {
    'gemini-pro': 32000,
    'gemini-ultra': 32000,
  },
  ollama: {
    'llama2': 4096,
    'mistral': 8192,
    'codellama': 16384,
  },
  huggingface: {
    'default': 2048,
  },
} as const;

export const ERROR_CODES = {
  // MCP Errors
  MCP_TOOL_NOT_FOUND: 'MCP_TOOL_NOT_FOUND',
  MCP_TOOL_EXECUTION_FAILED: 'MCP_TOOL_EXECUTION_FAILED',
  MCP_CONTEXT_NOT_FOUND: 'MCP_CONTEXT_NOT_FOUND',
  MCP_PERMISSION_DENIED: 'MCP_PERMISSION_DENIED',
  MCP_RATE_LIMIT_EXCEEDED: 'MCP_RATE_LIMIT_EXCEEDED',

  // LLM Errors
  LLM_PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  LLM_API_ERROR: 'LLM_API_ERROR',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  LLM_INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',
  LLM_TOKEN_LIMIT_EXCEEDED: 'LLM_TOKEN_LIMIT_EXCEEDED',

  // Channel Errors
  CHANNEL_NOT_CONFIGURED: 'CHANNEL_NOT_CONFIGURED',
  CHANNEL_SEND_FAILED: 'CHANNEL_SEND_FAILED',
  CHANNEL_WEBHOOK_INVALID: 'CHANNEL_WEBHOOK_INVALID',
  CHANNEL_AUTH_FAILED: 'CHANNEL_AUTH_FAILED',

  // Orchestrator Errors
  ORCHESTRATOR_ROUTING_FAILED: 'ORCHESTRATOR_ROUTING_FAILED',
  ORCHESTRATOR_CONTEXT_ERROR: 'ORCHESTRATOR_CONTEXT_ERROR',
  ORCHESTRATOR_PROCESSING_ERROR: 'ORCHESTRATOR_PROCESSING_ERROR',

  // Database Errors
  DATABASE_CONNECTION_ERROR: 'DATABASE_CONNECTION_ERROR',
  DATABASE_QUERY_ERROR: 'DATABASE_QUERY_ERROR',
  DATABASE_TRANSACTION_ERROR: 'DATABASE_TRANSACTION_ERROR',

  // General Errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const EVENT_TYPES = {
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',
  TOOL_EXECUTED: 'tool.executed',
  CONTEXT_UPDATED: 'context.updated',
  CONVERSATION_STARTED: 'conversation.started',
  CONVERSATION_ENDED: 'conversation.ended',
  LLM_REQUEST: 'llm.request',
  LLM_RESPONSE: 'llm.response',
  ERROR_OCCURRED: 'error.occurred',
} as const;
