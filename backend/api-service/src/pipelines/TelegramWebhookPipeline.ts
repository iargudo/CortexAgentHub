import { createLogger } from '@cortex/shared';
import type { ITelegramPipelineDeps } from './webhook-pipeline-types';

const logger = createLogger('TelegramWebhookPipeline');

/**
 * Process Telegram webhook: normalize, route, enhance RAG, process, save, send.
 */
export async function run(deps: ITelegramPipelineDeps, body: any): Promise<void> {
  logger.info('Telegram webhook received', { body });

  const normalizedMessage = deps.telegramAdapter.receiveMessage(body);

  let routingResult = await deps.flowRouter.route(normalizedMessage);
  if (routingResult) {
    routingResult = await deps.enhanceWithRAGContext(routingResult, normalizedMessage.content);
  }

  if (!routingResult) {
    logger.warn('No flow matched for Telegram message', {
      channelType: normalizedMessage.channelType,
      userId: normalizedMessage.channelUserId,
    });
    const result = await deps.orchestrator.processMessage(normalizedMessage);
    await deps.saveConversationAndMessages(normalizedMessage, result, null);
    await deps.telegramAdapter.sendMessage(normalizedMessage.channelUserId, {
      channelUserId: normalizedMessage.channelUserId,
      content: result.outgoingMessage.content,
      metadata: result.metadata,
    });
    return;
  }

  logger.info('Flow matched for Telegram message', {
    flowName: routingResult.flow.name,
    llmProvider: routingResult.llmProvider,
    enabledTools: routingResult.enabledTools,
  });
  const result = await deps.orchestrator.processMessage(normalizedMessage, routingResult);
  await deps.saveConversationAndMessages(normalizedMessage, result, routingResult);
  await deps.telegramAdapter.sendMessage(normalizedMessage.channelUserId, {
    channelUserId: normalizedMessage.channelUserId,
    content: result.outgoingMessage.content,
    metadata: result.metadata,
  });
}
