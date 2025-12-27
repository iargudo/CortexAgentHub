import { FastifyInstance } from 'fastify';
import { AdminController } from '../controllers';
import { authenticateJWT, requireAdmin } from '../middleware';

/**
 * Admin Routes
 */
export async function adminRoutes(
  fastify: FastifyInstance,
  controller: AdminController
): Promise<void> {
  // Login endpoint - MUST be before auth hooks (no auth required)
  // Pass fastify instance to login method for JWT access
  fastify.post('/login', async (request, reply) => {
    // Pass fastify instance to controller for JWT signing
    return controller.login(request as any, reply, fastify);
  });

  // Apply JWT auth to all admin routes except /login
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip authentication for login endpoint
    // The route is registered with prefix /api/admin, so full path would be /api/admin/login
    const url = request.url || '';
    const isLoginRoute = url.includes('/api/admin/login') || 
                        url.endsWith('/login') ||
                        (request.method === 'POST' && url.includes('login'));
    
    if (isLoginRoute) {
      return; // Skip authentication for login
    }
    
    await authenticateJWT(request, reply);
    await requireAdmin(request, reply);
  });

  // Dashboard statistics
  fastify.get('/dashboard/stats', async (request, reply) =>
    controller.getDashboardStats(request, reply)
  );

  // System health
  fastify.get('/health', async (request, reply) =>
    controller.getHealth(request, reply)
  );

  // Channels management
  fastify.get('/channels', async (request, reply) =>
    controller.listChannels(request, reply)
  );

  fastify.post('/channels', async (request, reply) =>
    controller.createChannel(request as any, reply)
  );

  fastify.put('/channels/:id', async (request, reply) =>
    controller.updateChannel(request as any, reply)
  );

  fastify.delete('/channels/:id', async (request, reply) =>
    controller.deleteChannel(request as any, reply)
  );

  fastify.post('/channels/:channelId/test', async (request, reply) =>
    controller.testChannel(request as any, reply)
  );

  // LLMs management
  fastify.get('/llms', async (request, reply) =>
    controller.listLLMs(request, reply)
  );

  fastify.post('/llms', async (request, reply) =>
    controller.createLLM(request as any, reply)
  );

  fastify.put('/llms/:id', async (request, reply) =>
    controller.updateLLM(request as any, reply)
  );

  fastify.delete('/llms/:id', async (request, reply) =>
    controller.deleteLLM(request as any, reply)
  );

  // Tools management
  fastify.get('/tools', async (request, reply) =>
    controller.listTools(request, reply)
  );

  fastify.post('/tools', async (request, reply) =>
    controller.createTool(request as any, reply)
  );

  fastify.put('/tools/:id', async (request, reply) =>
    controller.updateTool(request as any, reply)
  );

  fastify.delete('/tools/:id', async (request, reply) =>
    controller.deleteTool(request as any, reply)
  );

  fastify.post('/tools/:id/test', async (request, reply) =>
    controller.testTool(request as any, reply)
  );

  // Conversations management
  fastify.get('/conversations', async (request, reply) =>
    controller.listConversations(request as any, reply)
  );

  fastify.get('/conversations/export', async (request, reply) =>
    controller.exportConversations(request as any, reply)
  );

  fastify.get('/conversations/:id', async (request, reply) =>
    controller.getConversationDetail(request as any, reply)
  );

  fastify.post('/conversations/:id/send-message', async (request, reply) =>
    controller.sendProactiveMessage(request as any, reply)
  );

  // WhatsApp direct messaging
  fastify.get('/whatsapp/channels', async (request, reply) =>
    controller.getWhatsAppChannels(request, reply)
  );

  fastify.post('/whatsapp/send', async (request, reply) =>
    controller.sendWhatsAppToNumber(request as any, reply)
  );

  // Analytics
  fastify.get('/analytics', async (request, reply) =>
    controller.getAnalytics(request as any, reply)
  );

  // Logs
  fastify.get('/logs', async (request, reply) =>
    controller.getLogs(request as any, reply)
  );

  fastify.delete('/logs', async (request, reply) =>
    controller.deleteLogs(request as any, reply)
  );

  // Orchestration Flows management
  fastify.get('/flows', async (request, reply) =>
    controller.listFlows(request, reply)
  );

  fastify.post('/flows', async (request, reply) =>
    controller.createFlow(request as any, reply)
  );

  fastify.put('/flows/:id', async (request, reply) =>
    controller.updateFlow(request as any, reply)
  );

  fastify.delete('/flows/:id', async (request, reply) =>
    controller.deleteFlow(request as any, reply)
  );

  // Queue monitoring
  fastify.get('/queues/stats', async (request, reply) =>
    controller.getQueueStats(request, reply)
  );

  fastify.post('/queues/reset-statistics', async (request, reply) =>
    controller.resetQueueStatistics(request, reply)
  );

  fastify.get('/queues/:queueName/jobs', async (request, reply) =>
    controller.getQueueJobs(request as any, reply)
  );

  // Widgets management
  fastify.get('/widgets', async (request, reply) =>
    controller.listWidgets(request, reply)
  );

  fastify.get('/widgets/:id', async (request, reply) =>
    controller.getWidget(request as any, reply)
  );

  fastify.post('/widgets', async (request, reply) =>
    controller.createWidget(request as any, reply)
  );

  fastify.put('/widgets/:id', async (request, reply) =>
    controller.updateWidget(request as any, reply)
  );

  fastify.delete('/widgets/:id', async (request, reply) =>
    controller.deleteWidget(request as any, reply)
  );

  // Admin Users management
  fastify.get('/users/me', async (request, reply) =>
    controller.getCurrentUser(request, reply)
  );

  fastify.post('/users/me/change-password', async (request, reply) =>
    controller.changePassword(request as any, reply)
  );

  fastify.get('/users', async (request, reply) =>
    controller.listUsers(request, reply)
  );

  fastify.post('/users', async (request, reply) =>
    controller.createUser(request as any, reply)
  );

  fastify.put('/users/:id', async (request, reply) =>
    controller.updateUser(request as any, reply)
  );

  fastify.delete('/users/:id', async (request, reply) =>
    controller.deleteUser(request as any, reply)
  );
}
