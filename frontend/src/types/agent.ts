export interface Agent {
  id: string;
  name: string;
  description?: string;
  channels: Array<{
    id: string;
    channel_name: string;
    channel_type: string;
    channel_priority: number;
  }>;
  channel_count: number;
  llm_id: string;
  llm_provider: string;
  llm_model: string;
  enabled_tools: string[];
  routing_conditions: {
    messagePattern?: string;
    pattern?: string;
    description?: string;
    phone_numbers?: string[];
    bot_username?: string;
    email_address?: string;
    user_roles?: string[];
    time_ranges?: Array<{
      start: string;
      end: string;
      days?: string[];
      timezone?: string;
    }>;
    metadata?: Record<string, any>;
  };
  flow_config: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    agentMetadata?: any;
    nodes?: any[];
    edges?: any[];
  };
  priority: number;
  active: boolean;
  greeting_message?: string;
  created_at: string;
  updated_at: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  active?: boolean; // Legacy field, may not be present
  enabled?: boolean; // Backend returns this field (maps from active in DB)
  parameters?: any;
  implementation?: string;
  permissions?: any;
  toolType?: string;
  config?: any;
  createdAt?: string;
  updatedAt?: string;
  stats?: {
    executionsLast24h?: number;
    avgExecutionTime?: number;
    successRate?: number;
  };
}

export interface LLM {
  id: string;
  provider: string;
  model: string;
  active: boolean;
  name?: string;
  instance_identifier?: string;
}

export interface Channel {
  id: string;
  channel_type: string;
  name: string;
  active: boolean;
}

