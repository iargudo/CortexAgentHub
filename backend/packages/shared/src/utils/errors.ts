import { ERROR_CODES } from '../constants';

/**
 * Custom error classes for the application
 */

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public metadata?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      metadata: this.metadata,
    };
  }
}

export class MCPError extends AppError {
  constructor(code: string, message: string, metadata?: any) {
    super(code, message, 500, metadata);
  }
}

export class LLMError extends AppError {
  constructor(code: string, message: string, metadata?: any) {
    super(code, message, 500, metadata);
  }
}

export class ChannelError extends AppError {
  constructor(code: string, message: string, metadata?: any) {
    super(code, message, 500, metadata);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, metadata?: any) {
    super(ERROR_CODES.VALIDATION_ERROR, message, 400, metadata);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', metadata?: any) {
    super(ERROR_CODES.UNAUTHORIZED, message, 401, metadata);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', metadata?: any) {
    super(ERROR_CODES.FORBIDDEN, message, 403, metadata);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Not Found', metadata?: any) {
    super(ERROR_CODES.NOT_FOUND, message, 404, metadata);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', metadata?: any) {
    super(ERROR_CODES.MCP_RATE_LIMIT_EXCEEDED, message, 429, metadata);
  }
}

/**
 * Error handler utility
 */
export function handleError(error: any): AppError {
  if (error instanceof AppError) {
    return error;
  }

  // Handle known error patterns
  if (error.code === 'ECONNREFUSED') {
    return new AppError(
      ERROR_CODES.DATABASE_CONNECTION_ERROR,
      'Database connection refused',
      503,
      { originalError: error.message }
    );
  }

  // Default to internal error
  return new AppError(
    ERROR_CODES.INTERNAL_ERROR,
    error.message || 'An unexpected error occurred',
    500,
    { originalError: error }
  );
}
