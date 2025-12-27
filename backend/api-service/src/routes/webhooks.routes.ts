import { FastifyInstance } from 'fastify';
import { WebhooksController } from '../controllers';
import { createLogger } from '@cortex/shared';

const logger = createLogger('WebhooksRoutes');

/**
 * Webhooks Routes
 */
export async function webhooksRoutes(
  fastify: FastifyInstance,
  controller: WebhooksController
): Promise<void> {
  // WhatsApp webhook - GET for verification (360dialog/WhatsApp Business API)
  // WhatsApp Business API sends a GET request to verify the webhook when configuring it
  fastify.get(
    '/whatsapp',
    async (request, reply) => {
      try {
        // Handle webhook verification for 360dialog/WhatsApp Business API
        const query = request.query as any;
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        logger.info('WhatsApp webhook verification request received', {
          mode,
          hasToken: !!token,
          hasChallenge: !!challenge,
        });

        // Get webhook secret from environment variable (fallback)
        // In a multi-instance setup, you might want to get this from database
        const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

        // Verify webhook according to WhatsApp Business API spec
        if (mode === 'subscribe' && token === webhookSecret) {
          // Webhook verification successful
          // Return the challenge string to complete verification
          logger.info('WhatsApp webhook verified successfully', {
            challenge,
            mode,
          });
          return reply.send(challenge);
        } else {
          // Verification failed
          logger.warn('WhatsApp webhook verification failed', {
            mode,
            hasToken: !!token,
            tokenMatches: token === webhookSecret,
            hasWebhookSecret: !!webhookSecret,
          });
          return reply.code(403).send('Forbidden');
        }
      } catch (error: any) {
        logger.error('Error handling WhatsApp webhook verification', {
          error: error.message,
        });
        return reply.code(500).send('Internal Server Error');
      }
    }
  );

  // WhatsApp webhook - POST for receiving messages
  fastify.post(
    '/whatsapp',
    async (request, reply) => controller.whatsapp(request, reply)
  );

  // Telegram webhook
  fastify.post(
    '/telegram',
    async (request, reply) => controller.telegram(request, reply)
  );

  // Email webhook
  fastify.post(
    '/email',
    async (request, reply) => controller.email(request, reply)
  );

  // Generic webhook handler
  fastify.post(
    '/:channel',
    async (request, reply) => controller.generic(request as any, reply)
  );
}
