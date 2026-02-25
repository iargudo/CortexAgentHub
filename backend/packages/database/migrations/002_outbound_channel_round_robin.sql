-- ================================================================
-- Outbound channel round-robin counter for load balancing
-- ================================================================
-- Used when a flow has multiple WhatsApp channels: pick next channel
-- by incrementing a per-flow counter (round-robin).
-- ================================================================

CREATE TABLE IF NOT EXISTS public.outbound_channel_round_robin (
  flow_id uuid NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT outbound_channel_round_robin_pkey PRIMARY KEY (flow_id),
  CONSTRAINT outbound_channel_round_robin_flow_id_fkey
    FOREIGN KEY (flow_id) REFERENCES public.orchestration_flows(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.outbound_channel_round_robin IS 'Per-flow counter for round-robin selection when sending outbound to one of multiple WhatsApp channels';

CREATE INDEX IF NOT EXISTS idx_outbound_channel_round_robin_flow_id
  ON public.outbound_channel_round_robin(flow_id);
