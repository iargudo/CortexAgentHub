import { v4 as uuidv4 } from 'uuid';
import { TokenUsage, CostInfo } from '../types';

/**
 * Utility helper functions
 */

/**
 * Generate a unique UUID
 */
export function generateUUID(): string {
  return uuidv4();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(s: unknown): boolean {
  return typeof s === 'string' && UUID_REGEX.test(s);
}

/**
 * Generate a session ID
 * Session ID must be stable across messages for the same user to maintain context.
 * When conversationId is a valid UUID, use it so each conversation has its own context
 * (avoids mixing history between different flows for the same user).
 */
export function generateSessionId(channelType: string, userId: string, conversationId?: string | null): string {
  if (conversationId && isValidUUID(conversationId)) {
    return `${channelType}:${userId}:${conversationId}`;
  }
  return `${channelType}:${userId}`;
}

/**
 * Calculate cost based on token usage and pricing
 */
export function calculateCost(
  tokens: TokenUsage,
  pricing: { input: number; output: number }
): CostInfo {
  const inputCost = tokens.input * pricing.input;
  const outputCost = tokens.output * pricing.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCost,
    outputCost,
    totalCost,
    currency: 'USD',
  };
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    delay: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: any) => void;
  }
): Promise<T> {
  const { maxAttempts, delay, backoffMultiplier = 2, onRetry } = options;
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      if (onRetry) {
        onRetry(attempt, error);
      }

      const waitTime = delay * Math.pow(backoffMultiplier, attempt - 1);
      await sleep(waitTime);
    }
  }

  throw lastError;
}

/**
 * Truncate string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if a value is empty
 */
export function isEmpty(value: any): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .trim();
}

/**
 * Format timestamp
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString();
}

/**
 * Parse timestamp
 */
export function parseTimestamp(timestamp: string | Date): Date {
  return typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
}

/**
 * Check if timestamp is expired
 */
export function isExpired(expiresAt: Date | string): boolean {
  const expiry = parseTimestamp(expiresAt);
  return expiry.getTime() < Date.now();
}

/**
 * Create expiry timestamp
 */
export function createExpiryTimestamp(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}
