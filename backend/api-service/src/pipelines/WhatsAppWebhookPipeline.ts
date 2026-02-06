import { IncomingMessage } from '@cortex/shared';
import { createLogger } from '@cortex/shared';
import type { IWhatsAppPipelineDeps } from './webhook-pipeline-types';

const logger = createLogger('WhatsAppWebhookPipeline');

/**
 * Process WhatsApp webhook payload: normalize, identify channel, dedup, then process message.
 * Used by WebhooksController.processWhatsAppWebhookPayload and the queue worker.
 */
export async function run(deps: IWhatsAppPipelineDeps, webhookBody: any): Promise<void> {
  const actualPayload = webhookBody?.body || webhookBody;
  const is360Dialog =
    actualPayload?.object === 'whatsapp_business_account' ||
    webhookBody?.body?.object === 'whatsapp_business_account';
  const isUltraMsg = !!actualPayload?.instanceId || !!actualPayload?.event_type;
  const isTwilio = !!actualPayload?.MessageSid;
  let instanceId = 'unknown';
  let messageText = '';
  if (is360Dialog) {
    const entry = actualPayload?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    instanceId = value?.metadata?.phone_number_id || entry?.id || 'unknown';
    const firstMessage = value?.messages?.[0];
    messageText =
      firstMessage?.text?.body ||
      firstMessage?.image?.caption ||
      firstMessage?.video?.caption ||
      firstMessage?.document?.caption ||
      '';
  } else if (isUltraMsg) {
    instanceId = actualPayload?.instanceId || actualPayload?.data?.from || 'unknown';
    messageText = actualPayload?.data?.body || '';
  } else if (isTwilio) {
    instanceId = actualPayload?.AccountSid || 'unknown';
    messageText = actualPayload?.Body || '';
  }
  const provider = is360Dialog ? '360dialog' : isUltraMsg ? 'ultramsg' : isTwilio ? 'twilio' : 'unknown';

  await deps.logSystemEvent('info', `WhatsApp webhook processing (${provider})`, {
    service: 'webhooks',
    metadata: {
      channel: 'whatsapp',
      provider,
      fullPayload: webhookBody,
      extractedPayload: actualPayload,
      instanceId,
      hasMessage: is360Dialog
        ? !!actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
        : !!actualPayload?.data?.body,
      messageLength: messageText?.length || 0,
      ...(isUltraMsg && { eventType: actualPayload?.event_type, instanceId: actualPayload?.instanceId }),
    },
    userId: is360Dialog
      ? actualPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
      : actualPayload?.data?.from || actualPayload?.From,
  });

  const identifiedChannelId = await deps.identifyWhatsAppChannelFromWebhook(actualPayload);
  if (identifiedChannelId) {
    logger.info('WhatsApp channel identified from webhook', {
      channelId: identifiedChannelId,
      instanceId,
    });
  } else {
    logger.warn('Could not identify specific WhatsApp channel from webhook, will use routing by type', {
      instanceId,
    });
  }

  const normalizedMessage = await deps.whatsappAdapter.handleWebhook(webhookBody);
  if (!normalizedMessage) {
    logger.debug('Webhook event processed, no message to handle', {
      channel: 'whatsapp',
      instanceId,
      channelId: identifiedChannelId,
    });
    return;
  }

  const messageId = normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id;
  if (messageId) {
    const isDuplicate = await deps.executeDedupCheck(messageId);
    if (isDuplicate) {
      logger.info('Duplicate WhatsApp message detected, skipping processing', {
        messageId,
        userId: normalizedMessage.channelUserId,
        channelId: identifiedChannelId,
      });
      return;
    }
  }

  await processMessage(deps, normalizedMessage, identifiedChannelId);
}

/**
 * Process a single WhatsApp message: routing, RAG, context, orchestrator, save, send.
 * Called by run() after payload normalization and dedup.
 */
export async function processMessage(
  deps: IWhatsAppPipelineDeps,
  normalizedMessage: IncomingMessage,
  identifiedChannelId?: string
): Promise<void> {
  if (identifiedChannelId) {
    if (!normalizedMessage.metadata) normalizedMessage.metadata = {};
    normalizedMessage.metadata.channelId = identifiedChannelId;
    normalizedMessage.metadata.channel_config_id = identifiedChannelId;
    logger.info('Added channelId to normalized message metadata for explicit routing', {
      channelId: identifiedChannelId,
      messageId: normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id,
      userId: normalizedMessage.channelUserId,
    });
  } else {
    logger.debug('No channelId identified, routing will use channel type matching', {
      messageId: normalizedMessage.metadata?.messageId || normalizedMessage.metadata?.id,
      userId: normalizedMessage.channelUserId,
    });
  }

  const requestedChannelId =
    (normalizedMessage.metadata?.channelId as string) ||
    (normalizedMessage.metadata?.channel_config_id as string) ||
    identifiedChannelId;

  const optionA = await deps.tryLoadFlowFromConversation(
    normalizedMessage.channelType,
    normalizedMessage.channelUserId,
    typeof requestedChannelId === 'string' ? requestedChannelId : undefined
  );

  if (optionA && 'flowInactive' in optionA && optionA.flowInactive) {
    logger.info('WhatsApp message ignored: flow is inactive (no response)', {
      conversationId: optionA.conversationId,
      channelType: normalizedMessage.channelType,
      userId: normalizedMessage.channelUserId,
    });
    return;
  }

  let routingResult: any = null;
  let resolvedConversationId: string | undefined;

  if (optionA && 'routingResult' in optionA) {
    routingResult = optionA.routingResult;
    resolvedConversationId = optionA.conversationId;
    if (!normalizedMessage.metadata) normalizedMessage.metadata = {};
    normalizedMessage.metadata.conversationId = resolvedConversationId;
    logger.info('Using flow_id from conversation (Option A)', {
      flowId: routingResult?.flow?.id,
      flowName: routingResult?.flow?.name,
      conversationId: resolvedConversationId,
      channelType: normalizedMessage.channelType,
      userId: normalizedMessage.channelUserId,
    });
  } else {
    logger.debug('No flow_id in conversation or flow not active, using router', {
      channelType: normalizedMessage.channelType,
      userId: normalizedMessage.channelUserId,
    });
    routingResult = await deps.flowRouter.route(normalizedMessage);
  }

  if (routingResult) {
    routingResult = await deps.enhanceWithRAGContext(routingResult, normalizedMessage.content);
  }

  const attachedExternal = await deps.attachExternalContextToProcessing(
    normalizedMessage,
    routingResult,
    resolvedConversationId ?? undefined
  );
  routingResult = attachedExternal.routingResult;
  const attachedConversationMetadata = attachedExternal.conversationMetadata;
  const effectiveConversationId = resolvedConversationId ?? attachedExternal.conversationId;

  if (!routingResult) {
    const explicitFlowId = deps.extractExplicitFlowIdFromConversationMetadata(attachedConversationMetadata);
    if (explicitFlowId) {
      const explicitRoutingActive = await deps.tryLoadExplicitFlowRouting(
        explicitFlowId,
        normalizedMessage.channelType,
        typeof requestedChannelId === 'string' ? requestedChannelId : undefined,
        false
      );
      if (explicitRoutingActive) {
        routingResult = await deps.enhanceWithRAGContext(explicitRoutingActive, normalizedMessage.content);
        const reattached = await deps.attachExternalContextToProcessing(
          normalizedMessage,
          routingResult,
          effectiveConversationId ?? undefined
        );
        routingResult = reattached.routingResult;
      } else {
        const explicitRoutingInactive = await deps.tryLoadExplicitFlowRouting(
          explicitFlowId,
          normalizedMessage.channelType,
          typeof requestedChannelId === 'string' ? requestedChannelId : undefined,
          true
        );
        if (explicitRoutingInactive) {
          logger.info('WhatsApp message ignored: explicit flow is inactive (no response)', {
            flowId: explicitFlowId,
            channelType: normalizedMessage.channelType,
            userId: normalizedMessage.channelUserId,
          });
          return;
        }
      }
    }
  }

  if (!routingResult) {
    logger.warn('No flow matched for WhatsApp message', {
      channelType: normalizedMessage.channelType,
      phoneNumber: (normalizedMessage as any).phoneNumber,
    });
    await deps.logSystemEvent('warn', 'No flow matched for WhatsApp message', {
      service: 'webhooks',
      metadata: {
        channel: 'whatsapp',
        channelType: normalizedMessage.channelType,
        phoneNumber: (normalizedMessage as any).phoneNumber,
        userId: normalizedMessage.channelUserId,
      },
      userId: normalizedMessage.channelUserId,
    });

    const convIdForHistory = effectiveConversationId ?? attachedExternal?.conversationId;
    if (convIdForHistory) {
      await deps.loadAndRestoreHistoryForConversation(
        convIdForHistory,
        normalizedMessage.channelType,
        normalizedMessage.channelUserId
      );
    }

    const result = await deps.orchestrator.processMessage(normalizedMessage);
    await deps.saveConversationAndMessages(normalizedMessage, result, null);

    if (result.metadata?.error) {
      await deps.logSystemEvent('error', `Orchestrator error: ${result.metadata.error}`, {
        service: 'orchestrator',
        metadata: {
          errorMessage: result.metadata.error,
          errorCode: result.metadata.errorCode,
          conversationId: result.conversationId,
          channel: 'whatsapp',
          userId: normalizedMessage.channelUserId,
          processingTimeMs: result.processingTimeMs,
        },
        stackTrace: result.metadata.error,
        userId: normalizedMessage.channelUserId,
        conversationId: result.conversationId || undefined,
      });
    }
    if (result.toolExecutions && result.toolExecutions.length > 0) {
      for (const toolExec of result.toolExecutions) {
        if (toolExec.status === 'failed') {
          await deps.logSystemEvent('error', `Tool execution failed: ${toolExec.toolName}`, {
            service: 'tools',
            metadata: {
              toolName: toolExec.toolName,
              parameters: toolExec.parameters,
              error: toolExec.error,
              executionTimeMs: toolExec.executionTimeMs,
              channel: 'whatsapp',
              userId: normalizedMessage.channelUserId,
            },
            stackTrace: toolExec.error,
            userId: normalizedMessage.channelUserId,
            conversationId: result.conversationId || undefined,
          });
        } else if (toolExec.status === 'success') {
          await deps.logSystemEvent('info', `Tool executed successfully: ${toolExec.toolName}`, {
            service: 'tools',
            metadata: {
              toolName: toolExec.toolName,
              executionTimeMs: toolExec.executionTimeMs,
              channel: 'whatsapp',
              userId: normalizedMessage.channelUserId,
            },
            userId: normalizedMessage.channelUserId,
            conversationId: result.conversationId || undefined,
          });
        }
      }
    }

    const channelId =
      normalizedMessage.metadata?.channelId || normalizedMessage.metadata?.channel_config_id;
    const channelConfig = channelId ? await deps.getChannelConfigById(channelId) : undefined;
    logger.info('Using channel configuration for sending (no flow)', {
      hasChannelConfig: !!channelConfig,
      channelId: channelId || '(not specified)',
    });

    try {
      await deps.sendWhatsAppMessage(
        normalizedMessage.channelUserId,
        {
          channelUserId: normalizedMessage.channelUserId,
          content: result.outgoingMessage.content,
          metadata: { ...result.metadata, conversationId: result.conversationId },
        },
        channelConfig
      );
    } catch (sendError: any) {
      logger.error('CRITICAL: Failed to queue WhatsApp message response', {
        error: sendError.message,
        userId: normalizedMessage.channelUserId,
        conversationId: result.conversationId,
      });
      await deps.logSystemEvent('error', `CRITICAL: Failed to queue WhatsApp message: ${sendError.message}`, {
        service: 'webhooks',
        metadata: {
          channel: 'whatsapp',
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId,
          errorMessage: sendError.message,
        },
        stackTrace: sendError.stack,
        userId: normalizedMessage.channelUserId,
        conversationId: result.conversationId || undefined,
      });
    }
    return;
  }

  logger.info('Flow matched for WhatsApp message', {
    flowName: routingResult.flow.name,
    llmProvider: routingResult.llmProvider,
    enabledTools: routingResult.enabledTools,
  });
  await deps.logSystemEvent('info', 'Flow matched for WhatsApp message', {
    service: 'webhooks',
    metadata: {
      channel: 'whatsapp',
      flowName: routingResult.flow.name,
      llmProvider: routingResult.llmProvider,
      enabledTools: routingResult.enabledTools,
      userId: normalizedMessage.channelUserId,
    },
    userId: normalizedMessage.channelUserId,
  });

  const convIdForHistory = effectiveConversationId ?? attachedExternal?.conversationId;
  if (convIdForHistory) {
    await deps.loadAndRestoreHistoryForConversation(
      convIdForHistory,
      normalizedMessage.channelType,
      normalizedMessage.channelUserId
    );
  }

  const result = await deps.orchestrator.processMessage(normalizedMessage, routingResult);
  await deps.saveConversationAndMessages(normalizedMessage, result, routingResult);

  if (result.metadata?.error) {
    await deps.logSystemEvent('error', `Orchestrator error: ${result.metadata.error}`, {
      service: 'orchestrator',
      metadata: {
        errorMessage: result.metadata.error,
        errorCode: result.metadata.errorCode,
        conversationId: result.conversationId,
        channel: 'whatsapp',
        userId: normalizedMessage.channelUserId,
        processingTimeMs: result.processingTimeMs,
      },
      stackTrace: result.metadata.error,
      userId: normalizedMessage.channelUserId,
      conversationId: result.conversationId || undefined,
    });
  }
  if (result.toolExecutions && result.toolExecutions.length > 0) {
    for (const toolExec of result.toolExecutions) {
      if (toolExec.status === 'failed') {
        await deps.logSystemEvent('error', `Tool execution failed: ${toolExec.toolName}`, {
          service: 'tools',
          metadata: {
            toolName: toolExec.toolName,
            parameters: toolExec.parameters,
            error: toolExec.error,
            executionTimeMs: toolExec.executionTimeMs,
            channel: 'whatsapp',
            userId: normalizedMessage.channelUserId,
          },
          stackTrace: toolExec.error,
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId || undefined,
        });
      } else if (toolExec.status === 'success') {
        await deps.logSystemEvent('info', `Tool executed successfully: ${toolExec.toolName}`, {
          service: 'tools',
          metadata: {
            toolName: toolExec.toolName,
            executionTimeMs: toolExec.executionTimeMs,
            channel: 'whatsapp',
            userId: normalizedMessage.channelUserId,
          },
          userId: normalizedMessage.channelUserId,
          conversationId: result.conversationId || undefined,
        });
      }
    }
  }

  const channelConfig = await deps.getChannelConfigFromRoutingResult(routingResult);
  logger.info('Using channel configuration for sending', {
    hasChannelConfig: !!channelConfig,
    instanceId: channelConfig?.instanceId || 'using default',
  });

  try {
    await deps.sendWhatsAppMessage(
      normalizedMessage.channelUserId,
      {
        channelUserId: normalizedMessage.channelUserId,
        content: result.outgoingMessage.content,
        metadata: { ...result.metadata, conversationId: result.conversationId },
      },
      channelConfig
    );
  } catch (sendError: any) {
    logger.error('CRITICAL: Failed to queue WhatsApp message response', {
      error: sendError.message,
      userId: normalizedMessage.channelUserId,
      conversationId: result.conversationId,
    });
    await deps.logSystemEvent('error', `CRITICAL: Failed to queue WhatsApp message: ${sendError.message}`, {
      service: 'webhooks',
      metadata: {
        channel: 'whatsapp',
        userId: normalizedMessage.channelUserId,
        conversationId: result.conversationId,
        errorMessage: sendError.message,
      },
      stackTrace: sendError.stack,
      userId: normalizedMessage.channelUserId,
      conversationId: result.conversationId || undefined,
    });
  }
}
