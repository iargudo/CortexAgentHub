import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@cortex/shared';

/**
 * JWT Authentication Middleware
 */
export async function authenticateJWT(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new AppError('AUTH_FAILED', 'Missing authorization header', 401);
    }
    await request.jwtVerify();
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    // Only log JWT verification errors if there was an authorization header
    // Missing headers are expected and don't need to be logged
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const { createLogger } = require('@cortex/shared');
      const logger = createLogger('AuthMiddleware');
      // Only log as debug for invalid tokens (common case)
      logger.debug('JWT verification failed', {
        path: request.url,
        method: request.method,
        errorMessage: error.message,
        errorName: error.name,
      });
    }
    throw new AppError('AUTH_FAILED', 'Invalid or missing authentication token', 401);
  }
}

/**
 * Admin Role Middleware
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = request.user as any;

  if (!user || user.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Admin access required', 403);
  }
}

/**
 * API Key Authentication Middleware
 */
export async function authenticateAPIKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // In development mode, bypass API key validation
  if (process.env.NODE_ENV === 'development') {
    (request as any).apiKey = 'dev-mode';
    return;
  }

  const apiKey = request.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError('AUTH_FAILED', 'API key required', 401);
  }

  // In production, validate against database
  const validApiKeys = (process.env.VALID_API_KEYS || '').split(',');

  if (!validApiKeys.includes(apiKey)) {
    throw new AppError('AUTH_FAILED', 'Invalid API key', 401);
  }

  // Attach API key info to request
  (request as any).apiKey = apiKey;
}

/**
 * Flexible Authentication: Accepts JWT or API Key
 * For playground/UI access, JWT is preferred
 * For external API access, API Key is used
 */
export async function authenticateJWTOrAPIKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Try JWT first (for admin UI/playground)
  try {
    await request.jwtVerify();
    return; // JWT valid, proceed
  } catch (jwtError) {
    // JWT failed, try API Key
  }

  // Fall back to API Key authentication
  try {
    await authenticateAPIKey(request, reply);
  } catch (apiKeyError) {
    throw new AppError('AUTH_FAILED', 'Valid JWT token or API key required', 401);
  }
}
