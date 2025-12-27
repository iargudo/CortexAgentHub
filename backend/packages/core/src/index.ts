/**
 * @cortex/core - AI Orchestration Core
 * Main entry point for the Core package
 */

export * from './orchestrator';
export * from './router';
export * from './context';

// Re-export important types from shared
export type {
  IncomingMessage,
  OutgoingMessage,
  ProcessingContext,
  ProcessingResult,
  OrchestratorConfig,
  RoutingRule,
  RoutingAction,
  RoutingCondition,
  MessageRouterConfig,
  ContextManagerConfig,
} from '@cortex/shared';
