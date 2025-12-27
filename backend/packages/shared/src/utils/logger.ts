/**
 * Structured logging utility
 * Logs to console and automatically saves error/warn logs to database
 */

// Define a minimal interface for database connection to avoid circular dependencies
export interface DatabaseConnection {
  query(sql: string, params?: any[]): Promise<any>;
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

export interface LogMetadata {
  [key: string]: any;
}

export class Logger {
  private context: string;
  private logLevel: LogLevel;
  private static db: DatabaseConnection | null = null;
  private static dbEnabled = true; // Flag to disable DB logging if it fails repeatedly

  constructor(context: string, logLevel: LogLevel = LogLevel.INFO) {
    this.context = context;
    this.logLevel = logLevel;
  }

  /**
   * Set database connection for automatic logging to system_logs table
   * Should be called once during application initialization
   */
  static setDatabase(db: DatabaseConnection | null): void {
    Logger.db = db;
    Logger.dbEnabled = db !== null;
  }

  /**
   * Get current database connection status
   */
  static isDatabaseEnabled(): boolean {
    return Logger.db !== null && Logger.dbEnabled;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    return levels.indexOf(level) <= levels.indexOf(this.logLevel);
  }

  private formatMessage(level: LogLevel, message: string, metadata?: LogMetadata): string {
    const timestamp = new Date().toISOString();
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${metaStr}`;
  }

  /**
   * Save log to database (system_logs table)
   * Only saves error and warn levels to avoid filling the database
   */
  private async saveToDatabase(
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): Promise<void> {
    // Only save error and warn to database
    if (!Logger.db || !Logger.dbEnabled || (level !== LogLevel.ERROR && level !== LogLevel.WARN)) {
      return;
    }

    // Extract user_id (can be string/number, stored as varchar)
    const userId = metadata?.userId || metadata?.user_id || null;
    
    // Extract conversation_id (must be valid UUID or null)
    // Validate UUID format to avoid database errors
    let conversationId: string | null = metadata?.conversationId || metadata?.conversation_id || null;
    if (conversationId) {
      // UUID format: 8-4-4-4-12 hexadecimal characters
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(String(conversationId))) {
        // If conversationId is not a valid UUID, set to null to avoid database error
        // The userId will still be stored, which is more important for tracking
        conversationId = null;
      }
    }

    try {
      await Logger.db.query(
        `INSERT INTO system_logs (level, message, service, metadata, stack_trace, user_id, conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          level,
          message,
          this.context,
          JSON.stringify(metadata || {}),
          metadata?.stack || metadata?.stackTrace || null,
          userId,
          conversationId,
        ]
      );
    } catch (error: any) {
      // Fail silently to avoid recursive errors and prevent infinite loops
      // Only log to console once
      if (Logger.dbEnabled) {
        console.error(`[Logger] Failed to save log to database: ${error.message}`);
        // Disable database logging temporarily if it keeps failing
        Logger.dbEnabled = false;
        setTimeout(() => {
          Logger.dbEnabled = true; // Re-enable after 1 minute
        }, 60000);
      }
    }
  }

  error(message: string, metadata?: LogMetadata): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, metadata));
      // Save to database asynchronously (don't await to avoid blocking)
      this.saveToDatabase(LogLevel.ERROR, message, metadata).catch(() => {
        // Already handled in saveToDatabase
      });
    }
  }

  warn(message: string, metadata?: LogMetadata): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, metadata));
      // Save to database asynchronously (don't await to avoid blocking)
      this.saveToDatabase(LogLevel.WARN, message, metadata).catch(() => {
        // Already handled in saveToDatabase
      });
    }
  }

  info(message: string, metadata?: LogMetadata): void {
    if (this.shouldLog(LogLevel.INFO)) {
      // Using console.error for info as well to ensure it shows up in Claude Code
      console.error(this.formatMessage(LogLevel.INFO, message, metadata));
    }
  }

  debug(message: string, metadata?: LogMetadata): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.error(this.formatMessage(LogLevel.DEBUG, message, metadata));
    }
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

/**
 * Create a logger instance for a specific context
 */
export function createLogger(context: string, level?: LogLevel): Logger {
  const logLevel = level || (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO;
  return new Logger(context, logLevel);
}
