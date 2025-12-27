import { FastifyInstance } from 'fastify';
import { KnowledgeBasesController } from '../controllers';
import { authenticateJWT, requireAdmin } from '../middleware';

/**
 * Knowledge Bases Routes
 */
export async function knowledgeBasesRoutes(
  fastify: FastifyInstance,
  controller: KnowledgeBasesController
): Promise<void> {
  // Apply JWT auth to all routes
  if (process.env.NODE_ENV === 'production') {
    fastify.addHook('preHandler', async (request, reply) => {
      await authenticateJWT(request, reply);
      await requireAdmin(request, reply);
    });
  }

  // Knowledge Bases CRUD
  fastify.get('/', async (request, reply) =>
    controller.listKnowledgeBases(request as any, reply)
  );

  fastify.get('/:id', async (request, reply) =>
    controller.getKnowledgeBase(request as any, reply)
  );

  fastify.post('/', async (request, reply) =>
    controller.createKnowledgeBase(request as any, reply)
  );

  fastify.put('/:id', async (request, reply) =>
    controller.updateKnowledgeBase(request as any, reply)
  );

  fastify.delete('/:id', async (request, reply) =>
    controller.deleteKnowledgeBase(request as any, reply)
  );

  // Documents
  fastify.get('/:id/documents', async (request, reply) =>
    controller.getDocuments(request as any, reply)
  );

  fastify.post('/:id/documents', async (request, reply) =>
    controller.addDocument(request as any, reply)
  );

  // Batch document upload
  fastify.post('/:id/documents/batch', async (request, reply) =>
    controller.addDocumentsBatch(request as any, reply)
  );

  fastify.delete('/:kbId/documents/:docId', async (request, reply) =>
    controller.deleteDocument(request as any, reply)
  );

  fastify.get('/:kbId/documents/:docId/status', async (request, reply) =>
    controller.getDocumentStatus(request as any, reply)
  );

  // Flow assignments
  fastify.post('/:id/flows/:flowId', async (request, reply) =>
    controller.assignToFlow(request as any, reply)
  );

  fastify.delete('/:id/flows/:flowId', async (request, reply) =>
    controller.unassignFromFlow(request as any, reply)
  );

  // RAG Search
  fastify.post('/search', async (request, reply) =>
    controller.search(request as any, reply)
  );
}

/**
 * Flow Knowledge Bases Routes
 */
export async function flowKnowledgeBasesRoutes(
  fastify: FastifyInstance,
  controller: KnowledgeBasesController
): Promise<void> {
  // Apply JWT auth to all routes
  if (process.env.NODE_ENV === 'production') {
    fastify.addHook('preHandler', async (request, reply) => {
      await authenticateJWT(request, reply);
      await requireAdmin(request, reply);
    });
  }

  fastify.get('/:flowId/knowledge-bases', async (request, reply) =>
    controller.getFlowKnowledgeBases(request as any, reply)
  );
}

/**
 * Embedding Models Routes
 */
export async function embeddingModelsRoutes(
  fastify: FastifyInstance,
  controller: KnowledgeBasesController
): Promise<void> {
  // Apply JWT auth to all routes
  if (process.env.NODE_ENV === 'production') {
    fastify.addHook('preHandler', async (request, reply) => {
      await authenticateJWT(request, reply);
      await requireAdmin(request, reply);
    });
  }

  fastify.get('/', async (request, reply) =>
    controller.listEmbeddingModels(request as any, reply)
  );

  fastify.post('/', async (request, reply) =>
    controller.createEmbeddingModel(request as any, reply)
  );

  fastify.put('/:id', async (request, reply) =>
    controller.updateEmbeddingModel(request as any, reply)
  );

  fastify.delete('/:id', async (request, reply) =>
    controller.deleteEmbeddingModel(request as any, reply)
  );
}

