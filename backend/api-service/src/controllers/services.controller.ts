import { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger, AppError } from '@cortex/shared';
import {
  EmailService,
  SMTPConfig,
  SendEmailParams,
  SQLService,
  DatabaseConfig,
  ExecuteSQLParams,
  RESTService,
  RESTConfig,
  RESTCallParams,
} from '../services';

const logger = createLogger('ServicesController');

/**
 * Services Controller
 * Provides service endpoints for tools (like email sending)
 */
export class ServicesController {
  /**
   * Send Email
   * POST /api/services/email/send
   */
  async sendEmail(
    request: FastifyRequest<{
      Body: {
        config: SMTPConfig;
        params: SendEmailParams;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { config, params } = request.body;

      // Validate request
      if (!config || !params) {
        throw new AppError(
          'VALIDATION_ERROR',
          'config and params are required',
          400
        );
      }

      // Send email
      const result = await EmailService.sendEmail(config, params);

      if (!result.success) {
        throw new AppError(
          'EMAIL_SEND_FAILED',
          result.error || 'Failed to send email',
          500
        );
      }

      reply.send({
        success: true,
        data: {
          messageId: result.messageId,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Send email error', { error: error.message });
      throw new AppError(
        'EMAIL_SEND_FAILED',
        `Failed to send email: ${error.message}`,
        500
      );
    }
  }

  /**
   * Validate SMTP Configuration
   * POST /api/services/email/validate
   */
  async validateEmailConfig(
    request: FastifyRequest<{
      Body: {
        config: SMTPConfig;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { config } = request.body;

      if (!config) {
        throw new AppError(
          'VALIDATION_ERROR',
          'config is required',
          400
        );
      }

      const result = await EmailService.validateConfig(config);

      reply.send({
        success: result.valid,
        data: {
          valid: result.valid,
          error: result.error,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Validate email config error', { error: error.message });
      throw new AppError(
        'VALIDATION_ERROR',
        `Failed to validate config: ${error.message}`,
        500
      );
    }
  }

  /**
   * Execute SQL Query
   * POST /api/services/sql/execute
   */
  async executeSQL(
    request: FastifyRequest<{
      Body: {
        config: DatabaseConfig;
        params: ExecuteSQLParams;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { config, params } = request.body;

      // Validate request
      if (!config || !params) {
        throw new AppError(
          'VALIDATION_ERROR',
          'config and params are required',
          400
        );
      }

      if (!params.query || params.query.trim() === '') {
        throw new AppError(
          'VALIDATION_ERROR',
          'SQL query is required',
          400
        );
      }

      // Execute SQL query
      const result = await SQLService.executeQuery(config, params);

      if (!result.success) {
        throw new AppError(
          'SQL_EXECUTION_FAILED',
          result.error || 'Failed to execute SQL query',
          500
        );
      }

      reply.send({
        success: true,
        data: {
          rows: result.rows,
          rowCount: result.rowCount,
          executionTime: result.executionTime,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Execute SQL error', { error: error.message });
      throw new AppError(
        'SQL_EXECUTION_FAILED',
        `Failed to execute SQL: ${error.message}`,
        500
      );
    }
  }

  /**
   * Validate Database Connection
   * POST /api/services/sql/validate
   */
  async validateSQLConfig(
    request: FastifyRequest<{
      Body: {
        config: DatabaseConfig;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { config } = request.body;

      if (!config) {
        throw new AppError(
          'VALIDATION_ERROR',
          'config is required',
          400
        );
      }

      const result = await SQLService.validateConnection(config);

      reply.send({
        success: result.valid,
        data: {
          valid: result.valid,
          error: result.error,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Validate SQL config error', { error: error.message });
      throw new AppError(
        'VALIDATION_ERROR',
        `Failed to validate config: ${error.message}`,
        500
      );
    }
  }

  /**
   * Call REST API
   * POST /api/services/rest/call
   */
  async callREST(
    request: FastifyRequest<{
      Body: {
        config: RESTConfig;
        params: RESTCallParams;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { config, params } = request.body;

      // Validate request
      if (!config || !params) {
        throw new AppError(
          'VALIDATION_ERROR',
          'config and params are required',
          400
        );
      }

      if (!params.method || !params.endpoint) {
        throw new AppError(
          'VALIDATION_ERROR',
          'HTTP method and endpoint are required',
          400
        );
      }

      // Call REST API
      const result = await RESTService.call(config, params);

      if (!result.success) {
        // Use upstream API error message when available so the UI shows the real cause
        const upstream = result.data;
        const upstreamMsg =
          typeof upstream?.message === 'string'
            ? upstream.message
            : typeof upstream?.error === 'string'
              ? upstream.error
              : Array.isArray(upstream?.errors) && upstream.errors[0]
                ? String(upstream.errors[0])
                : null;
        const message = upstreamMsg || result.error || 'Failed to call REST API';
        const metadata = upstream != null ? { upstreamStatus: result.status, upstreamResponse: upstream } : undefined;
        throw new AppError('REST_CALL_FAILED', message, 500, metadata);
      }

      reply.send({
        success: true,
        data: {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          data: result.data,
          executionTime: result.executionTime,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Call REST error', { error: error.message });
      throw new AppError(
        'REST_CALL_FAILED',
        `Failed to call REST API: ${error.message}`,
        500
      );
    }
  }

  /**
   * Validate REST Configuration
   * POST /api/services/rest/validate
   */
  async validateRESTConfig(
    request: FastifyRequest<{
      Body: {
        config: RESTConfig;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const { config } = request.body;

      if (!config) {
        throw new AppError(
          'VALIDATION_ERROR',
          'config is required',
          400
        );
      }

      const result = await RESTService.validateConfig(config);

      reply.send({
        success: result.valid,
        data: {
          valid: result.valid,
          error: result.error,
        },
      });
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error('Validate REST config error', { error: error.message });
      throw new AppError(
        'VALIDATION_ERROR',
        `Failed to validate config: ${error.message}`,
        500
      );
    }
  }
}

