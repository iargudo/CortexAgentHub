/**
 * Main entry point for running the MCP Server standalone
 */
import 'dotenv/config';
import { MCPServer } from './server/MCPServer';
import { createLogger, MCPServerConfig } from '@cortex/shared';

const logger = createLogger('MCPServerMain');

async function startServer() {
  try {
    logger.info('Starting MCP Server...');

    // Prepare MCP Server Configuration
    const config: MCPServerConfig = {
      port: parseInt(process.env.MCP_SERVER_PORT || '8099'),
      tools: [], // Tools will be loaded from database on start()
      resources: [],
      contextStore: {
        provider: 'redis',
        ttl: parseInt(process.env.MCP_CONTEXT_TTL || '3600'),
        config: {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
        },
      },
      security: {
        enablePermissions: true,
        enableRateLimiting: false,
      },
    };

    // Initialize MCP Server
    const mcpServer = new MCPServer(config);

    // Start server (tools will be loaded from database automatically)
    const port = parseInt(process.env.MCP_SERVER_PORT || '8099');
    await mcpServer.start();
    
    const stats = mcpServer.getStats();
    logger.info(`Tools loaded from database: ${stats.toolCount}`);

    logger.info(`MCP Server started successfully on port ${port}`);
    logger.info('Available endpoints:');
    logger.info(`  - Health: http://localhost:${port}/health`);
    logger.info(`  - Tools: http://localhost:${port}/api/v1/tools`);
    logger.info(`  - Execute: http://localhost:${port}/api/v1/execute`);
    logger.info(`  - Context: http://localhost:${port}/api/v1/context`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down MCP Server...');
      await mcpServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error: any) {
    logger.error('Failed to start MCP Server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the server
startServer();
