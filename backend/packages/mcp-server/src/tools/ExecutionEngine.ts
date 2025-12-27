import { MCPContext } from '@cortex/shared';
import { createLogger } from '@cortex/shared';
import { Pool } from 'pg';

const logger = createLogger('ExecutionEngine');

/**
 * ExecutionEngine - Executes tool implementations stored in database
 * 
 * This engine runs JavaScript code from the database in a controlled environment.
 * It provides access to common utilities and context.
 */
export class ExecutionEngine {
  private db: Pool;

  constructor(databaseUrl: string) {
    this.db = new Pool({ connectionString: databaseUrl });
    logger.info('ExecutionEngine initialized');
  }

  /**
   * Execute tool implementation code
   * 
   * @param implementation - JavaScript code as string
   * @param parameters - Tool parameters
   * @param context - MCP context
   * @returns Tool execution result
   */
  async execute(
    implementation: string,
    parameters: any,
    context: MCPContext
  ): Promise<any> {
    try {
      logger.info('Executing tool implementation', {
        sessionId: context.sessionId,
        parametersCount: Object.keys(parameters || {}).length,
      });

      // Create a safe execution context with utilities
      const executionContext = {
        // Parameters passed to the tool
        parameters,
        
        // MCP Context
        context,
        
        // Utilities available to tool implementations
        logger: {
          info: (message: string, meta?: any) => logger.info(message, meta),
          warn: (message: string, meta?: any) => logger.warn(message, meta),
          error: (message: string, meta?: any) => logger.error(message, meta),
        },
        
        // Database access (read-only queries)
        db: {
          query: async (sql: string, values?: any[]) => {
            // Only allow SELECT queries for safety
            if (!sql.trim().toUpperCase().startsWith('SELECT')) {
              throw new Error('Only SELECT queries are allowed in tool implementations');
            }
            return await this.db.query(sql, values);
          },
        },
        
        // HTTP utilities (using native fetch from Node.js 18+)
        fetch: async (url: string, options?: any) => {
          return fetch(url, options);
        },
        
        // Common utilities
        utils: {
          sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
          formatDate: (date: Date) => date.toISOString(),
          parseJSON: (str: string) => JSON.parse(str),
          stringifyJSON: (obj: any) => JSON.stringify(obj),
        },
      };

      // Create the function from the implementation code
      // The implementation should be a function that returns a Promise
      // Example: async function handler() { return { success: true, data: "result" }; }
      
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const toolFunction = new AsyncFunction(
        'parameters',
        'context', 
        'logger',
        'db',
        'fetch',
        'utils',
        `
        // Tool implementation code
        ${implementation}
        
        // If implementation defines a handler function, call it
        if (typeof handler === 'function') {
          return await handler(parameters, context);
        }
        
        // Otherwise, the implementation should return a value directly
        throw new Error('Tool implementation must define a handler function');
        `
      );

      // Execute the tool function
      const result = await toolFunction(
        executionContext.parameters,
        executionContext.context,
        executionContext.logger,
        executionContext.db,
        executionContext.fetch,
        executionContext.utils
      );

      logger.info('Tool execution completed successfully', {
        sessionId: context.sessionId,
      });

      return result;
    } catch (error: any) {
      logger.error('Tool execution failed', {
        error: error.message,
        stack: error.stack,
        sessionId: context.sessionId,
      });

      return {
        success: false,
        error: error.message,
        message: 'Tool execution failed. Please check the implementation.',
      };
    }
  }

  /**
   * Validate implementation code syntax without executing it
   */
  validateImplementation(implementation: string): { valid: boolean; error?: string } {
    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      new AsyncFunction(
        'parameters',
        'context',
        'logger',
        'db',
        'fetch',
        'utils',
        implementation
      );
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Shutdown database connection
   */
  async shutdown(): Promise<void> {
    await this.db.end();
    logger.info('ExecutionEngine shutdown');
  }
}
