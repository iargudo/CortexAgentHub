// Export connection
export * from './connection';

// Export repositories
export * from './repositories';

// Export utilities
export { MigrationRunner } from './migrations/runner';
export { SeedRunner } from './seeds/runner';

import { DatabaseConnection } from './connection';
import { RepositoryFactory } from './repositories';

/**
 * Initialize database connection and return repositories
 */
export async function initializeDatabase(connectionString?: string) {
  const db = DatabaseConnection.getInstance(
    connectionString ? { connectionString } : undefined
  );

  // Test connection
  const isHealthy = await db.healthCheck();
  if (!isHealthy) {
    throw new Error('Database connection failed health check');
  }

  return {
    db,
    repositories: {
      conversations: RepositoryFactory.getConversationRepository(),
      messages: RepositoryFactory.getMessageRepository(),
      toolExecutions: RepositoryFactory.getToolExecutionRepository(),
      channelConfigs: RepositoryFactory.getChannelConfigRepository(),
      llmConfigs: RepositoryFactory.getLLMConfigRepository(),
    },
  };
}
