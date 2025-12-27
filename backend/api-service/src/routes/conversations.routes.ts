import { FastifyInstance } from 'fastify';
import { MessagesController } from '../controllers';
import { authenticateAPIKey } from '../middleware';

/**
 * Conversations Routes
 */
export async function conversationsRoutes(
  fastify: FastifyInstance,
  controller: MessagesController
): Promise<void> {
  // Get conversation by ID
  fastify.get(
    '/:conversationId',
    {
      preHandler: [authenticateAPIKey],
      schema: {
        params: {
          type: 'object',
          required: ['conversationId'],
          properties: {
            conversationId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => controller.getConversation(request as any, reply)
  );

  // Get user conversations
  fastify.get(
    '/user/:userId',
    {
      preHandler: [authenticateAPIKey],
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            channelType: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => controller.getUserConversations(request as any, reply)
  );

  // Delete conversation
  fastify.delete(
    '/:conversationId',
    {
      preHandler: [authenticateAPIKey],
      schema: {
        params: {
          type: 'object',
          required: ['conversationId'],
          properties: {
            conversationId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => controller.deleteConversation(request as any, reply)
  );
}
