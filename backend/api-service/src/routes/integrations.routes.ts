import { FastifyInstance } from 'fastify';
import { IntegrationsController } from '../controllers/integrations.controller';
import { authenticateAPIKey } from '../middleware';

/**
 * Integrations Routes (generic)
 */
export async function integrationsRoutes(
  fastify: FastifyInstance,
  controller: IntegrationsController
): Promise<void> {
  // List channels for integrations (discover channelConfigId)
  fastify.get(
    '/channels',
    {
      preHandler: [authenticateAPIKey],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            channelType: { type: 'string' },
            activeOnly: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => controller.listChannels(request as any, reply)
  );

  // Upsert external context into conversation metadata
  fastify.post(
    '/context/upsert',
    {
      preHandler: [authenticateAPIKey],
      schema: {
        body: {
          type: 'object',
          required: ['channelType', 'userId', 'envelope'],
          properties: {
            channelType: { type: 'string' },
            userId: { type: 'string' },
            envelope: {
              type: 'object',
              required: ['namespace', 'caseId'],
              properties: {
                namespace: { type: 'string' },
                caseId: { type: 'string' },
                refs: { type: 'object' },
                seed: { type: 'object' },
                routing: {
                  type: 'object',
                  properties: {
                    flowId: { type: 'string' },
                    channelConfigId: { type: 'string' },
                  },
                },
              },
            },
            conversationMetadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => controller.upsertExternalContext(request as any, reply)
  );

  // Upsert context + send outbound message (idempotent via Idempotency-Key header)
  fastify.post(
    '/outbound/send',
    {
      preHandler: [authenticateAPIKey],
      schema: {
        headers: {
          type: 'object',
          properties: {
            'idempotency-key': { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['channelType', 'userId', 'envelope'],
          properties: {
            channelType: { type: 'string' },
            userId: { type: 'string' },
            message: { type: 'string' },
            mediaUrl: { type: 'string' },
            mediaType: { type: 'string', enum: ['image', 'video', 'document'] },
            envelope: {
              type: 'object',
              required: ['namespace', 'caseId'],
              properties: {
                namespace: { type: 'string' },
                caseId: { type: 'string' },
                refs: { type: 'object' },
                seed: { type: 'object' },
                routing: {
                  type: 'object',
                  properties: {
                    flowId: { type: 'string' },
                    channelConfigId: { type: 'string' },
                  },
                },
              },
            },
            conversationMetadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => controller.sendOutbound(request as any, reply)
  );
}

