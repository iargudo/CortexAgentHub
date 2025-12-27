import { Pool } from 'pg';
import { ToolDefinition, MCPContext } from '@cortex/shared';
import { createLogger } from '@cortex/shared';
import { ExecutionEngine } from './ExecutionEngine';

const logger = createLogger('DynamicToolLoader');

/**
 * DynamicToolLoader - Loads tools from database and executes implementations dynamically
 */
export class DynamicToolLoader {
  private db: Pool;
  private executionEngine: ExecutionEngine;

  constructor(databaseUrl: string) {
    this.db = new Pool({ connectionString: databaseUrl });
    this.executionEngine = new ExecutionEngine(databaseUrl);
    logger.info('DynamicToolLoader initialized');
  }

  /**
   * Load all tools from database
   */
  async loadTools(): Promise<ToolDefinition[]> {
    try {
      const result = await this.db.query(`
        SELECT
          id,
          name,
          description,
          parameters,
          permissions,
          implementation,
          tool_type,
          config,
          active,
          created_at,
          updated_at
        FROM tool_definitions
        WHERE active = true
        ORDER BY created_at DESC
      `);

      logger.info(`Loaded ${result.rows.length} tools from database`);

      const tools: ToolDefinition[] = result.rows.map((row) => {
        const toolType = row.tool_type || 'javascript';
        const config = row.config || {};
        const implementation = row.implementation;

        // Create handler function based on tool type
        const handler = async (parameters: any, context: MCPContext): Promise<any> => {
          // Email type tools use the email service
          if (toolType === 'email') {
            return await this.handleEmailTool(parameters, config);
          }

          // SQL type tools use the SQL service
          if (toolType === 'sql') {
            return await this.handleSQLTool(parameters, config);
          }

          // REST type tools use the REST service
          if (toolType === 'rest') {
            return await this.handleRESTTool(parameters, config);
          }

          // JavaScript type tools (default) use ExecutionEngine
          if (toolType === 'javascript' || !toolType) {
            if (!implementation || implementation.trim() === '') {
              logger.warn(`Tool ${row.name} has no implementation`, {
                sessionId: context.sessionId,
              });
              return {
                success: false,
                message: `Tool '${row.name}' has no implementation yet. Please add implementation code in the Admin UI.`,
              };
            }

            // Execute the implementation using ExecutionEngine
            return await this.executionEngine.execute(implementation, parameters, context);
          }

          // Unknown tool type
          return {
            success: false,
            message: `Unknown tool type: ${toolType}`,
          };
        };

        logger.info(`Loaded tool from database: ${row.name}`, {
          toolType,
          hasImplementation: toolType !== 'email' && toolType !== 'sql' && toolType !== 'rest' && !!implementation && implementation.trim() !== '',
        });

        return {
          name: row.name,
          description: row.description,
          parameters: row.parameters || { type: 'object', properties: {}, required: [] },
          permissions: row.permissions || {
            channels: ['whatsapp', 'telegram', 'webchat', 'email'],
            rateLimit: {
              requests: 10,
              window: 60,
            },
          },
          handler,
        };
      });

      return tools;
    } catch (error: any) {
      logger.error('Failed to load tools from database', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle email tool execution
   */
  private async handleEmailTool(parameters: any, config: any): Promise<any> {
    try {
      // Validate required parameters
      if (!parameters.to || !parameters.subject) {
        throw new Error('Email to and subject are required');
      }

      if (!parameters.text && !parameters.html) {
        throw new Error('Email text or html content is required');
      }

      // Validate SMTP config
      if (!config.smtp || !config.smtp.host || !config.smtp.user || !config.smtp.password) {
        throw new Error('SMTP configuration is incomplete. Please configure SMTP settings in the tool config.');
      }

      // Try multiple URL options for internal service calls
      // Azure App Service uses PORT (default 8080), local development uses 3000
      const defaultPort = process.env.PORT || process.env.API_PORT || '8080';
      const apiUrls = [
        process.env.API_URL,
        process.env.API_BASE_URL,
        `http://localhost:${defaultPort}`,
        `http://127.0.0.1:${defaultPort}`,
        'http://localhost:3000', // Fallback for local development
        'http://127.0.0.1:3000', // Fallback for local development
      ].filter(Boolean) as string[];

      logger.info('Email tool: Attempting to send email via internal API', { 
        urlsCount: apiUrls.length,
        urls: apiUrls,
        defaultPort: process.env.PORT || process.env.API_PORT || '8080',
      });

      let lastError: Error | null = null;

      for (const apiBaseUrl of apiUrls) {
        try {
          logger.info('Email tool: Attempting to send email via API', { url: `${apiBaseUrl}/api/services/email/send` });
          
          const response = await fetch(`${apiBaseUrl}/api/services/email/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              config: {
                host: config.smtp.host,
                port: config.smtp.port || 587,
                secure: config.smtp.secure || false,
                user: config.smtp.user,
                password: config.smtp.password,
                fromAddress: config.smtp.fromAddress || config.smtp.user,
                fromName: config.smtp.fromName,
              },
              params: {
                to: parameters.to,
                subject: parameters.subject,
                text: parameters.text,
                html: parameters.html,
                cc: parameters.cc,
                bcc: parameters.bcc,
                replyTo: parameters.replyTo,
              },
            }),
            // Add timeout to prevent hanging
            signal: AbortSignal.timeout(30000), // 30 seconds
          });

          if (!response.ok) {
            const error = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
            throw new Error(error.error || `HTTP ${response.status}`);
          }

          const result = (await response.json()) as { data?: { messageId?: string } };

          logger.info('Email sent successfully', {
            to: parameters.to,
            subject: parameters.subject,
            messageId: result.data?.messageId,
            url: apiBaseUrl,
          });

          return {
            success: true,
            messageId: result.data?.messageId,
            to: parameters.to,
            subject: parameters.subject,
            timestamp: new Date().toISOString(),
          };
        } catch (error: any) {
          lastError = error;
          logger.warn('Email tool: API call failed, trying next URL', {
            url: apiBaseUrl,
            error: error.message,
            errorCode: error.code,
          });
          // Continue to next URL
        }
      }

      // All URLs failed
      logger.error('Email tool: All email API URLs failed', {
        attemptedUrls: apiUrls,
        lastError: lastError?.message,
        defaultPort: process.env.PORT || process.env.API_PORT || '8080',
      });
      throw lastError || new Error('All email API URLs failed. Please configure API_URL environment variable or ensure the API service is running on port 8080.');
    } catch (error: any) {
      logger.error('Email tool execution failed', { 
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Handle SQL tool execution
   */
  private async handleSQLTool(parameters: any, config: any): Promise<any> {
    try {
      // Validate required parameters
      if (!parameters.query) {
        throw new Error('SQL query parameter is required');
      }

      // Validate database config
      if (!config.database || !config.database.type || !config.database.host || !config.database.user || !config.database.password) {
        throw new Error('Database configuration is incomplete. Please configure database connection settings in the tool config.');
      }

      // Call SQL service via API
      const apiBaseUrl = process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:3000';
      const response = await fetch(`${apiBaseUrl}/api/services/sql/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            type: config.database.type,
            host: config.database.host,
            port: config.database.port || this.getDefaultPort(config.database.type),
            database: config.database.database || config.database.databaseName,
            user: config.database.user,
            password: config.database.password,
            ssl: config.database.ssl,
            encrypt: config.database.encrypt,
            trustServerCertificate: config.database.trustServerCertificate,
            connectString: config.database.connectString,
          },
          params: {
            query: parameters.query,
            parameters: parameters.parameters || [],
          },
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const result = (await response.json()) as { data?: { rows?: any[]; rowCount?: number; executionTime?: number } };

      return {
        success: true,
        rows: result.data?.rows || [],
        rowCount: result.data?.rowCount || 0,
        executionTime: result.data?.executionTime,
      };
    } catch (error: any) {
      logger.error('SQL tool execution failed', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Handle REST tool execution
   */
  private async handleRESTTool(parameters: any, config: any): Promise<any> {
    try {
      // Validate required parameters
      if (!parameters.method || !parameters.endpoint) {
        throw new Error('HTTP method and endpoint are required');
      }

      // Validate REST config
      if (!config.rest || !config.rest.baseUrl) {
        throw new Error('REST configuration is incomplete. Please configure base URL and authentication in the tool config.');
      }

      // Call REST service via API
      const apiBaseUrl = process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:3000';
      const response = await fetch(`${apiBaseUrl}/api/services/rest/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            baseUrl: config.rest.baseUrl,
            auth: config.rest.auth,
            defaultHeaders: config.rest.defaultHeaders || {},
            timeout: config.rest.timeout || 30,
          },
          params: {
            method: parameters.method,
            endpoint: parameters.endpoint,
            headers: parameters.headers,
            queryParams: parameters.queryParams,
            body: parameters.body,
            bodyType: parameters.bodyType || 'json',
          },
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const result = (await response.json()) as { data?: { status?: number; statusText?: string; headers?: any; data?: any; executionTime?: number } };

      return {
        success: true,
        status: result.data?.status,
        statusText: result.data?.statusText,
        headers: result.data?.headers,
        data: result.data?.data,
        executionTime: result.data?.executionTime,
      };
    } catch (error: any) {
      logger.error('REST tool execution failed', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get default port for database type
   */
  private getDefaultPort(dbType: string): number {
    switch (dbType.toLowerCase()) {
      case 'postgresql':
        return 5432;
      case 'mysql':
        return 3306;
      case 'mssql':
        return 1433;
      case 'oracle':
        return 1521;
      default:
        return 5432;
    }
  }

  /**
   * Load a single tool by name
   */
  async loadTool(toolName: string): Promise<ToolDefinition | null> {
    try {
      const result = await this.db.query(
        `
        SELECT
          id,
          name,
          description,
          parameters,
          permissions,
          implementation,
          tool_type,
          config,
          active
        FROM tool_definitions
        WHERE name = $1 AND active = true
        LIMIT 1
      `,
        [toolName]
      );

      if (result.rows.length === 0) {
        logger.warn(`Tool not found in database: ${toolName}`);
        return null;
      }

      const row = result.rows[0];
      const toolType = row.tool_type || 'javascript';
      const config = row.config || {};
      const implementation = row.implementation;

      // Create handler function based on tool type
      const handler = async (parameters: any, context: MCPContext): Promise<any> => {
        // Email type tools use the email service
        if (toolType === 'email') {
          return await this.handleEmailTool(parameters, config);
        }

        // SQL type tools use the SQL service
        if (toolType === 'sql') {
          return await this.handleSQLTool(parameters, config);
        }

        // REST type tools use the REST service
        if (toolType === 'rest') {
          return await this.handleRESTTool(parameters, config);
        }

        // JavaScript type tools (default) use ExecutionEngine
        if (toolType === 'javascript' || !toolType) {
          if (!implementation || implementation.trim() === '') {
            return {
              success: false,
              message: `Tool '${row.name}' has no implementation yet. Please add implementation code in the Admin UI.`,
            };
          }

          return await this.executionEngine.execute(implementation, parameters, context);
        }

      // Unknown tool type
      return {
        success: false,
        message: `Unknown tool type: ${toolType}`,
      };
    };

    logger.info(`Loaded tool from database: ${row.name}`, {
      toolType,
      hasImplementation: toolType !== 'email' && toolType !== 'sql' && toolType !== 'rest' && !!implementation && implementation.trim() !== '',
    });

    return {
      name: row.name,
      description: row.description,
      parameters: row.parameters || { type: 'object', properties: {}, required: [] },
      permissions: row.permissions || {
        channels: ['whatsapp', 'telegram', 'webchat', 'email'],
        rateLimit: {
          requests: 10,
          window: 60,
        },
      },
      handler,
    };
    } catch (error: any) {
      logger.error(`Failed to load tool ${toolName} from database`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Validate tool implementation code
   */
  validateImplementation(implementation: string): { valid: boolean; error?: string } {
    return this.executionEngine.validateImplementation(implementation);
  }

  /**
   * Shutdown database connection
   */
  async shutdown(): Promise<void> {
    await this.db.end();
    await this.executionEngine.shutdown();
    logger.info('DynamicToolLoader shutdown');
  }
}
