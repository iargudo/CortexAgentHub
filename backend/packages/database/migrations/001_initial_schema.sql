-- ================================================================
-- Initial Schema Migration - Complete Baseline
-- ================================================================
-- This migration contains the complete database schema as of December 2025
-- All previous migrations have been consolidated into this single baseline migration
-- ================================================================

-- ================================================================
-- EXTENSIONS
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';

-- ================================================================
-- FUNCTIONS
-- ================================================================

-- Update triggers functions
CREATE OR REPLACE FUNCTION public.update_embeddings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_flow_channels_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$;

CREATE OR REPLACE FUNCTION public.update_knowledge_base_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ================================================================
-- TABLES
-- ================================================================

-- Admin Users
CREATE TABLE IF NOT EXISTS public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100) NOT NULL,
    password_hash text NOT NULL,
    email character varying(255),
    full_name character varying(255),
    is_active boolean DEFAULT true,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT admin_users_pkey PRIMARY KEY (id),
    CONSTRAINT admin_users_username_key UNIQUE (username)
);

COMMENT ON TABLE public.admin_users IS 'Administrator users for the admin panel';
COMMENT ON COLUMN public.admin_users.username IS 'Unique username for login';
COMMENT ON COLUMN public.admin_users.password_hash IS 'Bcrypt hashed password';
COMMENT ON COLUMN public.admin_users.is_active IS 'Whether the user account is active';
COMMENT ON COLUMN public.admin_users.last_login IS 'Timestamp of last successful login';

-- Analytics Events
CREATE TABLE IF NOT EXISTS public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(50) NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now(),
    channel character varying(50),
    llm_provider character varying(50),
    latency_ms integer,
    tokens jsonb DEFAULT '{}'::jsonb,
    cost numeric(10,6),
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT analytics_events_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.analytics_events IS 'Event stream for analytics and monitoring';

-- Channel Configs
CREATE TABLE IF NOT EXISTS public.channel_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_type character varying(50) NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    name character varying(100) NOT NULL,
    active boolean DEFAULT true,
    CONSTRAINT channel_configs_pkey PRIMARY KEY (id),
    CONSTRAINT unique_channel_type_name UNIQUE (channel_type, name)
);

COMMENT ON TABLE public.channel_configs IS 'Configuration for each communication channel (supports multiple instances per type)';
COMMENT ON COLUMN public.channel_configs.id IS 'UUID único (clave primaria) usado para identificar el canal en todo el sistema. Es el único identificador necesario.';
COMMENT ON COLUMN public.channel_configs.config IS 'Configuración JSON del canal. Para WhatsApp puede incluir: {"instanceId": "132581", "phoneNumber": "593997369006", "provider": "ultramsg"}';
COMMENT ON COLUMN public.channel_configs.name IS 'Nombre del canal usado para identificación en la UI y asignación a flows. Debe ser único por channel_type.';

-- Context Store
CREATE TABLE IF NOT EXISTS public.context_store (
    session_id character varying(255) NOT NULL,
    context jsonb NOT NULL,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT context_store_pkey PRIMARY KEY (session_id)
);

-- Conversations
CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_user_id character varying(255) NOT NULL,
    channel character varying(50) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp without time zone DEFAULT now(),
    last_activity timestamp without time zone DEFAULT now(),
    status character varying(20) DEFAULT 'active'::character varying,
    flow_id uuid,
    CONSTRAINT conversations_pkey PRIMARY KEY (id),
    CONSTRAINT unique_channel_user UNIQUE (channel, channel_user_id)
);

COMMENT ON TABLE public.conversations IS 'User conversations across all channels';
COMMENT ON COLUMN public.conversations.flow_id IS 'Reference to the orchestration flow (agent) that processed this conversation';

-- Embedding Models
CREATE TABLE IF NOT EXISTS public.embedding_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    provider character varying(50) NOT NULL,
    model_name character varying(100) NOT NULL,
    dimensions integer NOT NULL,
    api_key_encrypted text,
    config jsonb DEFAULT '{}'::jsonb,
    active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT embedding_models_pkey PRIMARY KEY (id),
    CONSTRAINT unique_embedding_model_name UNIQUE (name)
);

COMMENT ON TABLE public.embedding_models IS 'Configuration for embedding models (OpenAI, Cohere, HuggingFace, etc.)';

-- Embeddings
CREATE TABLE IF NOT EXISTS public.embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    embedding public.vector(1536),
    CONSTRAINT embeddings_pkey PRIMARY KEY (id)
);

-- Flow Channels (M:M relationship between flows and channels)
CREATE TABLE IF NOT EXISTS public.flow_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    active boolean DEFAULT true,
    priority integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT flow_channels_pkey PRIMARY KEY (id),
    CONSTRAINT unique_flow_channel UNIQUE (flow_id, channel_id)
);

COMMENT ON TABLE public.flow_channels IS 'Many-to-many relationship between flows and channels - allows one agent to work with multiple channels';
COMMENT ON COLUMN public.flow_channels.flow_id IS 'Orchestration flow (agent) ID';
COMMENT ON COLUMN public.flow_channels.channel_id IS 'Channel configuration ID';
COMMENT ON COLUMN public.flow_channels.priority IS 'Priority for this channel within the flow (lower = higher priority)';

-- Flow Knowledge Bases
CREATE TABLE IF NOT EXISTS public.flow_knowledge_bases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid,
    knowledge_base_id uuid,
    priority integer DEFAULT 0,
    similarity_threshold numeric(5,4) DEFAULT 0.70,
    max_results integer DEFAULT 5,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT flow_knowledge_bases_pkey PRIMARY KEY (id),
    CONSTRAINT unique_flow_kb_assignment UNIQUE (flow_id, knowledge_base_id)
);

COMMENT ON TABLE public.flow_knowledge_bases IS 'Many-to-many relationship between orchestration flows (agents) and knowledge bases';
COMMENT ON COLUMN public.flow_knowledge_bases.similarity_threshold IS 'Minimum cosine similarity (0-1) for retrieved chunks';
COMMENT ON COLUMN public.flow_knowledge_bases.max_results IS 'Maximum number of chunks to retrieve per query';

-- Knowledge Base Documents
CREATE TABLE IF NOT EXISTS public.knowledge_base_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    knowledge_base_id uuid,
    title character varying(500),
    content text NOT NULL,
    source_type character varying(50) DEFAULT 'manual'::character varying,
    source_url text,
    file_name character varying(500),
    file_type character varying(50),
    file_size integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    status character varying(50) DEFAULT 'pending'::character varying,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT knowledge_base_documents_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.knowledge_base_documents IS 'Documents within a knowledge base (can be uploaded, imported from URL, or manually entered)';

-- Knowledge Base Embeddings
CREATE TABLE IF NOT EXISTS public.knowledge_base_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid,
    knowledge_base_id uuid,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    token_count integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    embedding public.vector,
    CONSTRAINT knowledge_base_embeddings_pkey PRIMARY KEY (id),
    CONSTRAINT unique_document_chunk UNIQUE (document_id, chunk_index)
);

COMMENT ON TABLE public.knowledge_base_embeddings IS 'Vector embeddings for document chunks with pgvector for similarity search';
COMMENT ON COLUMN public.knowledge_base_embeddings.embedding IS 'Vector embedding. Dimension varies by model (typically 1536 for OpenAI, 384-768 for others)';

-- Knowledge Bases
CREATE TABLE IF NOT EXISTS public.knowledge_bases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    embedding_model_id uuid,
    chunk_size integer DEFAULT 1000,
    chunk_overlap integer DEFAULT 200,
    chunking_strategy character varying(50) DEFAULT 'recursive'::character varying,
    active boolean DEFAULT true,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT knowledge_bases_pkey PRIMARY KEY (id),
    CONSTRAINT unique_knowledge_base_name UNIQUE (name)
);

COMMENT ON TABLE public.knowledge_bases IS 'Knowledge bases that can be assigned to multiple orchestration flows';
COMMENT ON COLUMN public.knowledge_bases.chunk_size IS 'Characters per chunk when splitting documents';
COMMENT ON COLUMN public.knowledge_bases.chunk_overlap IS 'Character overlap between adjacent chunks';
COMMENT ON COLUMN public.knowledge_bases.chunking_strategy IS 'Chunking strategy: recursive (smart), fixed (by size), semantic (by meaning)';

-- LLM Configs
CREATE TABLE IF NOT EXISTS public.llm_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider character varying(50) NOT NULL,
    model character varying(100) NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    priority integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    api_key_encrypted text,
    instance_identifier character varying(255) NOT NULL,
    name character varying(100),
    CONSTRAINT llm_configs_pkey PRIMARY KEY (id),
    CONSTRAINT unique_provider_model_instance UNIQUE (provider, model, instance_identifier)
);

COMMENT ON TABLE public.llm_configs IS 'LLM provider configurations with fallback priorities';
COMMENT ON COLUMN public.llm_configs.instance_identifier IS 'Unique identifier for multiple instances of the same provider+model (e.g., "server1", "server2", "default")';
COMMENT ON COLUMN public.llm_configs.name IS 'Display name for the LLM configuration (e.g., "Ollama Server 1 - llama2")';

-- Messages
CREATE TABLE IF NOT EXISTS public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    llm_provider character varying(50),
    llm_model character varying(100),
    tokens_used jsonb,
    cost numeric(10,6),
    "timestamp" timestamp without time zone DEFAULT now(),
    CONSTRAINT messages_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.messages IS 'Individual messages within conversations';

-- Orchestration Flows
CREATE TABLE IF NOT EXISTS public.orchestration_flows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    llm_id uuid,
    enabled_tools text[],
    flow_config jsonb DEFAULT '{}'::jsonb,
    routing_conditions jsonb DEFAULT '{}'::jsonb,
    priority integer DEFAULT 10,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    greeting_message text,
    CONSTRAINT orchestration_flows_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.orchestration_flows IS 'Visual orchestration flows (agents). Channels are managed via flow_channels table (M:M relationship).';
COMMENT ON COLUMN public.orchestration_flows.enabled_tools IS 'Array of MCP tool names permitted in this flow';
COMMENT ON COLUMN public.orchestration_flows.flow_config IS 'Visual graph layout data for frontend drag-drop UI';
COMMENT ON COLUMN public.orchestration_flows.routing_conditions IS 'Conditions for routing: phone numbers, bot usernames, user roles, time ranges, etc.';
COMMENT ON COLUMN public.orchestration_flows.greeting_message IS 'Initial greeting message sent when a user connects via webchat. Leave empty to disable.';

-- RAG Queries
CREATE TABLE IF NOT EXISTS public.rag_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid,
    knowledge_base_id uuid,
    query_text text NOT NULL,
    query_embedding public.vector(1536),
    results_count integer DEFAULT 0,
    results jsonb DEFAULT '[]'::jsonb,
    processing_time_ms integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rag_queries_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.rag_queries IS 'Log of RAG queries for analytics and debugging';

-- Routing Rules
CREATE TABLE IF NOT EXISTS public.routing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    condition jsonb NOT NULL,
    action jsonb NOT NULL,
    priority integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT routing_rules_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.routing_rules IS 'Message routing rules based on patterns';

-- System Logs
CREATE TABLE IF NOT EXISTS public.system_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    level character varying(20) NOT NULL,
    message text NOT NULL,
    service character varying(100),
    metadata jsonb DEFAULT '{}'::jsonb,
    stack_trace text,
    user_id character varying(255),
    conversation_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_logs_pkey PRIMARY KEY (id),
    CONSTRAINT system_logs_level_check CHECK (((level)::text = ANY (ARRAY[('error'::character varying)::text, ('warn'::character varying)::text, ('info'::character varying)::text, ('debug'::character varying)::text])))
);

COMMENT ON TABLE public.system_logs IS 'System logs for monitoring, debugging, and auditing';
COMMENT ON COLUMN public.system_logs.level IS 'Log level: error, warn, info, debug';
COMMENT ON COLUMN public.system_logs.service IS 'Service that generated the log (e.g., api-service, mcp-server)';
COMMENT ON COLUMN public.system_logs.metadata IS 'Additional contextual information as JSON';

-- Tool Definitions
CREATE TABLE IF NOT EXISTS public.tool_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    implementation text,
    permissions jsonb DEFAULT '{}'::jsonb,
    active boolean DEFAULT true,
    tool_type character varying(50) DEFAULT 'javascript'::character varying,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT tool_definitions_pkey PRIMARY KEY (id),
    CONSTRAINT tool_definitions_name_key UNIQUE (name)
);

COMMENT ON TABLE public.tool_definitions IS 'Dynamic MCP tool definitions with JavaScript implementations';
COMMENT ON COLUMN public.tool_definitions.tool_type IS 'Type of tool: javascript (default), email, sql, rest';
COMMENT ON COLUMN public.tool_definitions.config IS 'Tool-specific configuration (e.g., SMTP settings for email tools)';

-- Tool Executions
CREATE TABLE IF NOT EXISTS public.tool_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tool_name character varying(100) NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb,
    result jsonb,
    status character varying(20),
    error text,
    execution_time_ms integer,
    executed_at timestamp without time zone DEFAULT now(),
    message_id uuid,
    CONSTRAINT tool_executions_pkey PRIMARY KEY (id),
    CONSTRAINT tool_executions_status_check CHECK (((status)::text = ANY (ARRAY[('success'::character varying)::text, ('error'::character varying)::text, ('timeout'::character varying)::text])))
);

COMMENT ON TABLE public.tool_executions IS 'Audit log of all tool executions';

-- Widgets
CREATE TABLE IF NOT EXISTS public.widgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    widget_key character varying(100) NOT NULL,
    channel_id uuid,
    allowed_origins text[] DEFAULT ARRAY[]::text[],
    "position" character varying(20) DEFAULT 'bottom-right'::character varying,
    primary_color character varying(7) DEFAULT '#3B82F6'::character varying,
    button_color character varying(7) DEFAULT '#3B82F6'::character varying,
    button_text_color character varying(7) DEFAULT '#FFFFFF'::character varying,
    welcome_message text,
    placeholder_text character varying(255) DEFAULT 'Escribe tu mensaje...'::character varying,
    show_typing_indicator boolean DEFAULT true,
    enable_sound boolean DEFAULT false,
    button_size integer DEFAULT 56,
    chat_width integer DEFAULT 380,
    chat_height integer DEFAULT 500,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT widgets_pkey PRIMARY KEY (id),
    CONSTRAINT widgets_widget_key_key UNIQUE (widget_key)
);

COMMENT ON TABLE public.widgets IS 'Embeddable chat widgets configuration';
COMMENT ON COLUMN public.widgets.widget_key IS 'Unique key used in embedding script';
COMMENT ON COLUMN public.widgets.allowed_origins IS 'Array of allowed origins for CORS validation';

-- ================================================================
-- INDEXES
-- ================================================================

-- Embeddings indexes
CREATE INDEX IF NOT EXISTS embeddings_created_at_idx ON public.embeddings USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS embeddings_embedding_idx ON public.embeddings USING hnsw (embedding public.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS embeddings_metadata_idx ON public.embeddings USING gin (metadata);

-- Admin Users indexes
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON public.admin_users USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users USING btree (email);
CREATE INDEX IF NOT EXISTS idx_admin_users_last_login ON public.admin_users USING btree (last_login DESC);
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users USING btree (username);

-- Analytics Events indexes
CREATE INDEX IF NOT EXISTS idx_analytics_channel ON public.analytics_events USING btree (channel);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON public.analytics_events USING btree (event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_llm_provider ON public.analytics_events USING btree (llm_provider);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON public.analytics_events USING btree ("timestamp" DESC);

-- Channel Configs indexes
CREATE INDEX IF NOT EXISTS idx_channel_configs_active ON public.channel_configs USING btree (active);
CREATE INDEX IF NOT EXISTS idx_channel_configs_type ON public.channel_configs USING btree (channel_type);

-- Context Store indexes
CREATE INDEX IF NOT EXISTS idx_context_store_expires_at ON public.context_store USING btree (expires_at);

-- Conversations indexes
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON public.conversations USING btree (channel);
CREATE INDEX IF NOT EXISTS idx_conversations_flow_id ON public.conversations USING btree (flow_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON public.conversations USING btree (last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations USING btree (status);

-- Embedding Models indexes
CREATE INDEX IF NOT EXISTS idx_embedding_models_active ON public.embedding_models USING btree (active);
CREATE INDEX IF NOT EXISTS idx_embedding_models_default ON public.embedding_models USING btree (is_default) WHERE (is_default = true);
CREATE INDEX IF NOT EXISTS idx_embedding_models_provider ON public.embedding_models USING btree (provider);

-- Flow Channels indexes
CREATE INDEX IF NOT EXISTS idx_flow_channels_active ON public.flow_channels USING btree (active);
CREATE INDEX IF NOT EXISTS idx_flow_channels_channel_id ON public.flow_channels USING btree (channel_id);
CREATE INDEX IF NOT EXISTS idx_flow_channels_flow_id ON public.flow_channels USING btree (flow_id);

-- Flow Knowledge Bases indexes
CREATE INDEX IF NOT EXISTS idx_flow_kb_active ON public.flow_knowledge_bases USING btree (active);
CREATE INDEX IF NOT EXISTS idx_flow_kb_flow_id ON public.flow_knowledge_bases USING btree (flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_kb_kb_id ON public.flow_knowledge_bases USING btree (knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_flow_kb_priority ON public.flow_knowledge_bases USING btree (flow_id, priority);

-- Knowledge Base Documents indexes
CREATE INDEX IF NOT EXISTS idx_kb_documents_created_at ON public.knowledge_base_documents USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_documents_kb_id ON public.knowledge_base_documents USING btree (knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_source_type ON public.knowledge_base_documents USING btree (source_type);
CREATE INDEX IF NOT EXISTS idx_kb_documents_status ON public.knowledge_base_documents USING btree (status);

-- Knowledge Base Embeddings indexes
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_chunk_index ON public.knowledge_base_embeddings USING btree (document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_document_id ON public.knowledge_base_embeddings USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_kb_id ON public.knowledge_base_embeddings USING btree (knowledge_base_id);

-- Knowledge Bases indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_active ON public.knowledge_bases USING btree (active);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created_at ON public.knowledge_bases USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_embedding_model ON public.knowledge_bases USING btree (embedding_model_id);

-- LLM Configs indexes
CREATE INDEX IF NOT EXISTS idx_llm_configs_active ON public.llm_configs USING btree (active);
CREATE INDEX IF NOT EXISTS idx_llm_configs_instance_identifier ON public.llm_configs USING btree (instance_identifier);
CREATE INDEX IF NOT EXISTS idx_llm_configs_priority ON public.llm_configs USING btree (priority DESC);
CREATE INDEX IF NOT EXISTS idx_llm_configs_provider ON public.llm_configs USING btree (provider);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_llm_provider ON public.messages USING btree (llm_provider);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages USING btree ("timestamp" DESC);

-- Orchestration Flows indexes
CREATE INDEX IF NOT EXISTS idx_orchestration_flows_active ON public.orchestration_flows USING btree (active);
CREATE INDEX IF NOT EXISTS idx_orchestration_flows_llm ON public.orchestration_flows USING btree (llm_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_flows_routing_conditions ON public.orchestration_flows USING gin (routing_conditions);

-- RAG Queries indexes
CREATE INDEX IF NOT EXISTS idx_rag_queries_created_at ON public.rag_queries USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_queries_flow_id ON public.rag_queries USING btree (flow_id);
CREATE INDEX IF NOT EXISTS idx_rag_queries_kb_id ON public.rag_queries USING btree (knowledge_base_id);

-- Routing Rules indexes
CREATE INDEX IF NOT EXISTS idx_routing_rules_active ON public.routing_rules USING btree (active);
CREATE INDEX IF NOT EXISTS idx_routing_rules_priority ON public.routing_rules USING btree (priority DESC);

-- System Logs indexes
CREATE INDEX IF NOT EXISTS idx_system_logs_conversation_id ON public.system_logs USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON public.system_logs USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON public.system_logs USING btree (level);
CREATE INDEX IF NOT EXISTS idx_system_logs_service ON public.system_logs USING btree (service);

-- Tool Definitions indexes
CREATE INDEX IF NOT EXISTS idx_tool_definitions_active ON public.tool_definitions USING btree (active);
CREATE INDEX IF NOT EXISTS idx_tool_definitions_name ON public.tool_definitions USING btree (name);
CREATE INDEX IF NOT EXISTS idx_tool_definitions_tool_type ON public.tool_definitions USING btree (tool_type);

-- Tool Executions indexes
CREATE INDEX IF NOT EXISTS idx_tool_executions_executed_at ON public.tool_executions USING btree (executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_message ON public.tool_executions USING btree (message_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON public.tool_executions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_name ON public.tool_executions USING btree (tool_name);

-- Widgets indexes
CREATE INDEX IF NOT EXISTS idx_widgets_active ON public.widgets USING btree (active);
CREATE INDEX IF NOT EXISTS idx_widgets_channel_id ON public.widgets USING btree (channel_id);
CREATE INDEX IF NOT EXISTS idx_widgets_widget_key ON public.widgets USING btree (widget_key);

-- Knowledge Base Embeddings vector index (HNSW for fast similarity search)
CREATE INDEX IF NOT EXISTS kb_embeddings_vector_idx 
    ON public.knowledge_base_embeddings 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ================================================================
-- FOREIGN KEYS
-- ================================================================

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.orchestration_flows(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.flow_channels
    ADD CONSTRAINT flow_channels_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channel_configs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flow_channels
    ADD CONSTRAINT flow_channels_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.orchestration_flows(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flow_knowledge_bases
    ADD CONSTRAINT flow_knowledge_bases_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.orchestration_flows(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flow_knowledge_bases
    ADD CONSTRAINT flow_knowledge_bases_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_base_documents
    ADD CONSTRAINT knowledge_base_documents_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_base_embeddings
    ADD CONSTRAINT knowledge_base_embeddings_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_base_documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_base_embeddings
    ADD CONSTRAINT knowledge_base_embeddings_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_bases
    ADD CONSTRAINT knowledge_bases_embedding_model_id_fkey FOREIGN KEY (embedding_model_id) REFERENCES public.embedding_models(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.orchestration_flows
    ADD CONSTRAINT orchestration_flows_llm_id_fkey FOREIGN KEY (llm_id) REFERENCES public.llm_configs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rag_queries
    ADD CONSTRAINT rag_queries_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.orchestration_flows(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rag_queries
    ADD CONSTRAINT rag_queries_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.knowledge_bases(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.tool_executions
    ADD CONSTRAINT tool_executions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.widgets
    ADD CONSTRAINT widgets_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channel_configs(id) ON DELETE CASCADE;

-- ================================================================
-- TRIGGERS
-- ================================================================

CREATE TRIGGER embeddings_updated_at_trigger 
    BEFORE UPDATE ON public.embeddings 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_embeddings_updated_at();

CREATE TRIGGER flow_channels_updated_at_trigger 
    BEFORE UPDATE ON public.flow_channels 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_flow_channels_updated_at();

CREATE TRIGGER flow_knowledge_bases_updated_at_trigger 
    BEFORE UPDATE ON public.flow_knowledge_bases 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_knowledge_base_updated_at();

CREATE TRIGGER knowledge_base_documents_updated_at_trigger 
    BEFORE UPDATE ON public.knowledge_base_documents 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_knowledge_base_updated_at();

CREATE TRIGGER knowledge_base_embeddings_updated_at_trigger 
    BEFORE UPDATE ON public.knowledge_base_embeddings 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_knowledge_base_updated_at();

CREATE TRIGGER knowledge_bases_updated_at_trigger 
    BEFORE UPDATE ON public.knowledge_bases 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_knowledge_base_updated_at();

CREATE TRIGGER update_channel_configs_updated_at 
    BEFORE UPDATE ON public.channel_configs 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_routing_rules_updated_at 
    BEFORE UPDATE ON public.routing_rules 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

-- ================================================================
-- INITIAL DATA (Optional - Embedding Models)
-- ================================================================

DO $$
BEGIN
    -- Insert default embedding models (if not exists)
    INSERT INTO embedding_models (name, provider, model_name, dimensions, is_default, active)
    VALUES 
        ('OpenAI text-embedding-3-small', 'openai', 'text-embedding-3-small', 1536, true, true),
        ('OpenAI text-embedding-3-large', 'openai', 'text-embedding-3-large', 3072, false, true),
        ('OpenAI text-embedding-ada-002', 'openai', 'text-embedding-ada-002', 1536, false, true)
    ON CONFLICT (name) DO NOTHING;
END $$;
