import { createLogger } from '@cortex/shared';
import type { IEmailPipelineDeps } from './webhook-pipeline-types';

const logger = createLogger('EmailWebhookPipeline');

/**
 * Process Email webhook: normalize, route, enhance RAG, process, save, send.
 */
export async function run(deps: IEmailPipelineDeps, body: any): Promise<void> {
  logger.info('Email webhook received', { body });

  const normalizedMessage = deps.emailAdapter.receiveMessage(body);

  let routingResult = await deps.flowRouter.route(normalizedMessage);
  if (routingResult) {
    routingResult = await deps.enhanceWithRAGContext(routingResult, normalizedMessage.content);
  }

  if (!routingResult) {
    logger.warn('No flow matched for Email message', {
      channelType: normalizedMessage.channelType,
      userId: normalizedMessage.channelUserId,
    });
    const result = await deps.orchestrator.processMessage(normalizedMessage);
    await deps.saveConversationAndMessages(normalizedMessage, result, null);
    await deps.emailAdapter.sendMessage(normalizedMessage.channelUserId, {
      channelUserId: normalizedMessage.channelUserId,
      content: result.outgoingMessage.content,
      metadata: result.metadata,
    });
    return;
  }

  logger.info('Flow matched for Email message', {
    flowName: routingResult.flow.name,
    llmProvider: routingResult.llmProvider,
    enabledTools: routingResult.enabledTools,
  });
  const result = await deps.orchestrator.processMessage(normalizedMessage, routingResult);
  await deps.saveConversationAndMessages(normalizedMessage, result, routingResult);
  await deps.emailAdapter.sendMessage(normalizedMessage.channelUserId, {
    channelUserId: normalizedMessage.channelUserId,
    content: result.outgoingMessage.content,
    metadata: result.metadata,
  });
}
