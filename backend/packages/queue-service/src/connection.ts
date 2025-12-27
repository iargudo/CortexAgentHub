import Redis from 'ioredis';
import { createLogger } from '@cortex/shared';

const logger = createLogger('QueueConnection');

/**
 * Redis Connection for BullMQ
 */
export class QueueConnection {
  private static connection: Redis;

  /**
   * Get or create Redis connection for BullMQ
   */
  static getConnection(): Redis {
    if (!this.connection) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      // Detect if SSL is required (rediss:// protocol)
      const isSSL = redisUrl.startsWith('rediss://');
      
      // Base configuration
      const redisConfig: any = {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          // Limitar reintentos para evitar loops infinitos
          if (times > 10) {
            logger.error('BullMQ: Redis connection failed after 10 retry attempts');
            return null; // Detener reintentos
          }
          if (times <= 3) {
            logger.debug(`BullMQ: Redis retry attempt ${times}, delay: ${delay}ms`);
          } else {
            logger.warn(`BullMQ: Redis retry attempt ${times}, delay: ${delay}ms`);
          }
          return delay;
        },
        // Configuración para Azure Redis (SSL/TLS)
        connectTimeout: 30000, // 30 segundos timeout (Azure puede ser lento)
        keepAlive: 30000, // Keep-alive cada 30 segundos
        enableOfflineQueue: true, // Encolar comandos si está offline
        lazyConnect: true, // No conectar inmediatamente
        reconnectOnError: (err: Error) => {
          // Reconectar automáticamente en errores específicos
          const targetError = 'READONLY';
          return err.message.includes(targetError);
        },
      };

      // Configurar TLS para Azure Redis (rediss://)
      if (isSSL) {
        redisConfig.tls = {
          // Azure Redis requiere verificación de certificado
          rejectUnauthorized: true,
        };
        logger.info('BullMQ: Configuring Redis connection with SSL/TLS for Azure');
      }

      this.connection = new Redis(redisUrl, redisConfig);

      this.connection.on('connect', () => {
        logger.info('BullMQ: Redis connection established');
      });

      this.connection.on('error', (error) => {
        // Solo loguear errores críticos, ignorar errores de conexión temporales
        if (!error.message.includes('ECONNREFUSED') && 
            !error.message.includes('ETIMEDOUT') &&
            !error.message.includes('Connection is closed')) {
          logger.error('BullMQ: Redis connection error', { error: error.message });
        } else {
          logger.debug('BullMQ: Redis connection error (will retry)', { error: error.message });
        }
      });

      this.connection.on('ready', () => {
        logger.info('BullMQ: Redis connection ready');
      });

      this.connection.on('close', () => {
        logger.debug('BullMQ: Redis connection closed (will reconnect automatically)');
      });

      this.connection.on('reconnecting', (delay: number) => {
        logger.debug(`BullMQ: Redis reconnecting in ${delay}ms`);
      });
    }

    return this.connection;
  }

  /**
   * Close Redis connection
   */
  static async close(): Promise<void> {
    if (this.connection) {
      await this.connection.quit();
      logger.info('BullMQ: Redis connection closed');
    }
  }

  /**
   * Check connection health
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const conn = this.getConnection();
      await conn.ping();
      return true;
    } catch (error: any) {
      logger.error('BullMQ: Health check failed', { 
        error: error.message,
        code: error.code 
      });
      return false;
    }
  }
}
