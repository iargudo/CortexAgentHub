import { FastifyInstance } from 'fastify';
import { MessagesController } from '../controllers';
import { authenticateJWTOrAPIKey } from '../middleware';

/**
 * Messages Routes
 */
export async function messagesRoutes(
  fastify: FastifyInstance,
  controller: MessagesController
): Promise<void> {
  // Send message
  fastify.post(
    '/send',
    {
      preHandler: [authenticateJWTOrAPIKey],
      schema: {
        body: {
          type: 'object',
          required: ['channelType', 'userId', 'content'],
          properties: {
            channelType: { type: 'string' },
            userId: { type: 'string' },
            content: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => controller.sendMessage(request as any, reply)
  );
}
