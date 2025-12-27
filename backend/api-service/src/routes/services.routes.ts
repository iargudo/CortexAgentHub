import { FastifyInstance } from 'fastify';
import { ServicesController } from '../controllers/services.controller';

/**
 * Services routes
 */
export async function servicesRoutes(
  fastify: FastifyInstance,
  controller: ServicesController
): Promise<void> {
  // Email service routes
  fastify.post('/email/send', async (request, reply) => {
    await controller.sendEmail(request as any, reply);
  });

  fastify.post('/email/validate', async (request, reply) => {
    await controller.validateEmailConfig(request as any, reply);
  });

  // SQL service routes
  fastify.post('/sql/execute', async (request, reply) => {
    await controller.executeSQL(request as any, reply);
  });

  fastify.post('/sql/validate', async (request, reply) => {
    await controller.validateSQLConfig(request as any, reply);
  });

  // REST service routes
  fastify.post('/rest/call', async (request, reply) => {
    await controller.callREST(request as any, reply);
  });

  fastify.post('/rest/validate', async (request, reply) => {
    await controller.validateRESTConfig(request as any, reply);
  });
}

