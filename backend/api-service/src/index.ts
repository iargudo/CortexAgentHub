import dotenv from 'dotenv';
import path from 'path';
import { APIServer } from './server';
import { createLogger } from '@cortex/shared';

const logger = createLogger('Main');

// Load environment variables from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info('Starting CortexAgentHub API Service...');

  const server = new APIServer();

  try {
    // Initialize server and all components (MCP tools load from database automatically)
    await server.initialize();
    
    // Get MCP Server stats
    const mcpServer = server.getMCPServer();
    const stats = mcpServer.getStats();
    logger.info('MCP Tools loaded from database', {
      toolCount: stats.toolCount,
      databaseToolsEnabled: stats.databaseToolsEnabled,
    });

    // Start listening
    await server.start();

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await server.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to start API Service', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { APIServer };
