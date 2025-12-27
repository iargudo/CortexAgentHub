import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, createLogger } from '@cortex/shared';

const logger = createLogger('ErrorHandler');

/**
 * Global Error Handler
 */
export async function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Handle AppError (custom application errors)
  if (error instanceof AppError) {
    // Don't log 401 authentication errors as ERROR - they're expected during auto-login
    // Only log as debug to avoid noise in production logs
    if (error.statusCode === 401 && error.code === 'AUTH_FAILED') {
      logger.debug('Authentication required', {
        path: request.url,
        method: request.method,
      });
    } else {
      // Log other errors normally
      logger.error('API Error', {
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
        stack: error.stack,
        path: request.url,
        method: request.method,
      });
    }
    
    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        metadata: error.metadata,
      },
    });
  }

  // Log non-AppError errors with full details
  logger.error('API Error (non-AppError)', {
    error: error.message,
    errorName: error.name,
    errorStack: error.stack,
    path: request.url,
    method: request.method,
    headers: {
      'content-type': request.headers['content-type'],
      'authorization': request.headers.authorization ? 'present' : 'missing',
    },
    body: request.body ? (typeof request.body === 'string' ? request.body.substring(0, 200) : JSON.stringify(request.body).substring(0, 200)) : 'no body',
  });

  // Handle Fastify validation errors
  if ((error as FastifyError).validation) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (error as FastifyError).validation,
      },
    });
  }

  // Handle JWT errors
  if (error.message.includes('jwt') || error.message.includes('token')) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed',
      },
    });
  }

  // Default server error - include error message in development
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : error.message || 'An unexpected error occurred';
    
  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: errorMessage,
      ...(process.env.NODE_ENV !== 'production' && {
        details: {
          name: error.name,
          stack: error.stack,
        },
      }),
    },
  });
}
