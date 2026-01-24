import {
  IncomingMessage,
  OutgoingMessage,
  ProcessingContext,
  ProcessingResult,
  OrchestratorConfig,
  ChannelType,
  generateUUID,
  createLogger,
  MCPError,
  LLMError,
  ERROR_CODES,
  LLMProvider,
} from '@cortex/shared';
import { MCPServer } from '@cortex/mcp-server';
import { LoadBalancer } from '@cortex/llm-gateway';
import { MessageRouter } from '../router/MessageRouter';
import { ContextManager } from '../context/ContextManager';

const logger = createLogger('AIOrchestrator');

/**
 * AI Orchestrator - Main orchestration engine
 * Coordinates between channels, MCP, LLM gateway, and context management
 */
export class AIOrchestrator {
  private mcpServer: MCPServer;
  private llmGateway: LoadBalancer;
  private messageRouter: MessageRouter;
  private contextManager: ContextManager;
  private config: OrchestratorConfig;

  constructor(
    mcpServer: MCPServer,
    llmGateway: LoadBalancer,
    messageRouter: MessageRouter,
    contextManager: ContextManager,
    config: OrchestratorConfig
  ) {
    this.mcpServer = mcpServer;
    this.llmGateway = llmGateway;
    this.messageRouter = messageRouter;
    this.contextManager = contextManager;
    this.config = config;

    logger.info('AIOrchestrator initialized', {
      enableToolExecution: config.enableToolExecution,
      maxToolExecutions: config.maxToolExecutions,
    });
  }

  /**
   * Process an incoming message through the entire pipeline
   */
  async processMessage(message: IncomingMessage, flowRoutingResult?: any): Promise<ProcessingResult> {
    const startTime = Date.now();
    const conversationId = message.metadata?.conversationId || message.channelUserId;

    logger.info('Processing message', {
      channelType: message.channelType,
      userId: message.channelUserId,
      conversationId,
      hasFlowRouting: !!flowRoutingResult,
    });

    try {
      // 1. Get or create context
      const mcpContext = await this.contextManager.getOrCreateContext(
        conversationId,
        message.channelType,
        message.channelUserId
      );

      // 2. Determine routing (which LLM to use)
      // Use flow-based routing if available, otherwise fall back to legacy routing
      
      // Log flowRoutingResult details for debugging
      if (flowRoutingResult) {
        logger.info('FlowRoutingResult DETAILED', {
          flowId: flowRoutingResult.flow?.id,
          flowName: flowRoutingResult.flow?.name,
          hasFlowConfig: !!flowRoutingResult.flow?.flow_config,
          flowConfigType: typeof flowRoutingResult.flow?.flow_config,
          flowConfigKeys: flowRoutingResult.flow?.flow_config ? Object.keys(flowRoutingResult.flow.flow_config) : [],
          hasSystemPrompt: !!flowRoutingResult.flow?.flow_config?.systemPrompt,
          systemPromptLength: flowRoutingResult.flow?.flow_config?.systemPrompt?.length || 0,
          systemPromptPreview: flowRoutingResult.flow?.flow_config?.systemPrompt?.substring(0, 200) || 'NOT FOUND',
          flowConfigFull: flowRoutingResult.flow?.flow_config ? JSON.stringify(flowRoutingResult.flow.flow_config).substring(0, 1000) : 'null',
        });
      }
      
      const routingAction = flowRoutingResult
        ? {
            llmProvider: this.convertProviderToEnum(flowRoutingResult.llmProvider),
            llmModel: flowRoutingResult.llmModel,
            temperature: flowRoutingResult.llmConfig?.temperature,
            maxTokens: flowRoutingResult.llmConfig?.maxTokens,
            systemPrompt: flowRoutingResult.flow.flow_config?.systemPrompt,
          }
        : this.messageRouter.route(message, message.channelUserId);

      logger.info('Message routed - DETAILED', {
        provider: routingAction.llmProvider,
        model: routingAction.llmModel,
        flowBased: !!flowRoutingResult,
        hasSystemPrompt: !!routingAction.systemPrompt,
        systemPromptLength: routingAction.systemPrompt?.length || 0,
        systemPromptPreview: routingAction.systemPrompt?.substring(0, 200) || 'None',
      });
      
      logger.debug('Message routed', {
        provider: routingAction.llmProvider,
        model: routingAction.llmModel,
        flowBased: !!flowRoutingResult,
        hasSystemPrompt: !!routingAction.systemPrompt,
        systemPromptLength: routingAction.systemPrompt?.length || 0,
        systemPromptPreview: routingAction.systemPrompt?.substring(0, 100) || 'None',
      });

      // 3. Add user message to context
      await this.contextManager.addMessage(
        mcpContext.sessionId,
        'user',
        message.content
      );

      // 4. Get available tools for this channel
      const allToolsForChannel = this.config.enableToolExecution
        ? this.mcpServer.getToolsForChannel(message.channelType)
        : [];
      let availableTools = [...allToolsForChannel];

      // Filter tools based on flow configuration if available
      // IMPORTANT:
      // - If enabledTools is present (even as an empty array), treat it as an explicit allow-list.
      //   Empty array => NO tools allowed for this flow.
      // - If enabledTools is missing/undefined, keep legacy behavior: tools are not restricted by flow.
      if (flowRoutingResult && Array.isArray(flowRoutingResult.enabledTools)) {
        const enabledToolNames = flowRoutingResult.enabledTools;
        availableTools = availableTools.filter((tool: any) =>
          enabledToolNames.includes(tool.name)
        );
        logger.info('Tools filtered by flow configuration', {
          totalTools: allToolsForChannel.length,
          enabledTools: availableTools.length,
          allowedToolNames: enabledToolNames,
          availableToolNames: availableTools.map((t: any) => t.name),
        });
      } else {
        logger.info('Available tools', { 
          count: availableTools.length,
          toolNames: availableTools.map((t: any) => t.name),
        });
      }

      // Log tool availability for debugging (INFO level - normal operation)
      if (availableTools.length === 0) {
        logger.info('NO TOOLS AVAILABLE for this message', {
          channelType: message.channelType,
          enableToolExecution: this.config.enableToolExecution,
          allToolsForChannelCount: allToolsForChannel.length,
          hasFlowRoutingResult: !!flowRoutingResult,
          enabledToolsFromFlow: flowRoutingResult?.enabledTools || [],
          conversationId,
        });
      } else {
        // Log as INFO - having tools available is normal operation, not a warning
        logger.debug('Tools available for LLM', {
          channelType: message.channelType,
          toolCount: availableTools.length,
          toolNames: availableTools.map((t: any) => t.name),
          flowName: flowRoutingResult?.flow?.name || 'none',
          conversationId,
        });
      }

      // 5. Build processing context
      const processingContext: ProcessingContext = {
        incomingMessage: message,
        conversationId,
        sessionId: mcpContext.sessionId,
        mcpContext,
        routingAction,
        startTime: new Date(),
      };

      // 6. Prepare prompt with context
      const prompt = await this.buildPrompt(processingContext);

      // Log what tools are being sent to LLM
      if (availableTools.length > 0) {
        logger.info('Sending tools to LLM', {
          toolCount: availableTools.length,
          toolNames: availableTools.map((t: any) => t.name),
          toolDescriptions: availableTools.map((t: any) => ({
            name: t.name,
            description: t.description?.substring(0, 100),
          })),
          hasSystemPrompt: !!routingAction.systemPrompt,
          systemPromptLength: routingAction.systemPrompt?.length || 0,
        });
      }

      // 7. Execute LLM call
      // If flow routing specifies a provider, use it directly. Otherwise use load balancer.
      let llmResponse;
      if (flowRoutingResult && routingAction.llmProvider) {
        // Ensure provider is enum
        const providerEnum = this.convertProviderToEnum(routingAction.llmProvider);
        logger.debug('Looking for provider', {
          originalProvider: routingAction.llmProvider,
          providerEnum,
          providerType: typeof providerEnum,
        });
        
        const specificProvider = this.llmGateway.getProvider(providerEnum);
        if (specificProvider) {
          logger.debug('Using specific provider from flow', {
            provider: providerEnum,
            providerName: specificProvider.name,
            model: routingAction.llmModel,
          });
          llmResponse = await specificProvider.complete(prompt, {
            model: routingAction.llmModel,
            temperature: routingAction.temperature || 0.7,
            maxTokens: routingAction.maxTokens,
            systemPrompt: routingAction.systemPrompt,
            tools: availableTools.length > 0 ? this.formatToolsForLLM(availableTools) : undefined,
          });
        } else {
          logger.warn('Specified provider not found, falling back to load balancer', {
            requestedProvider: routingAction.llmProvider,
            providerEnum,
            availableProviders: this.llmGateway.getHealthStatus().map(h => h.provider),
          });
          llmResponse = await this.llmGateway.complete(prompt, {
            model: routingAction.llmModel,
            temperature: routingAction.temperature || 0.7,
            maxTokens: routingAction.maxTokens,
            systemPrompt: routingAction.systemPrompt,
            tools: availableTools.length > 0 ? this.formatToolsForLLM(availableTools) : undefined,
          });
        }
      } else {
        llmResponse = await this.llmGateway.complete(prompt, {
          model: routingAction.llmModel,
          temperature: routingAction.temperature || this.config.defaultLLMModel ? 0.7 : undefined,
          maxTokens: routingAction.maxTokens,
          systemPrompt: routingAction.systemPrompt,
          tools: availableTools.length > 0 ? this.formatToolsForLLM(availableTools) : undefined,
        });
      }

      logger.info('LLM response received', {
        provider: llmResponse.provider,
        model: llmResponse.model,
        tokens: llmResponse.tokensUsed.total,
        cost: llmResponse.cost.totalCost,
        hasToolCalls: !!llmResponse.toolCalls,
        toolCallsCount: llmResponse.toolCalls?.length || 0,
        toolCallsNames: llmResponse.toolCalls?.map((tc: any) => tc.name) || [],
      });

      // Log LLM tool call response - this is normal behavior when tools are executed
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        logger.info('LLM_RETURNED_TOOL_CALLS', {
          conversationId,
          channelType: message.channelType,
          toolCallsCount: llmResponse.toolCalls.length,
          toolCallsNames: llmResponse.toolCalls.map((tc: any) => tc.name),
          provider: llmResponse.provider,
          model: llmResponse.model,
        });
      } else if (availableTools.length > 0) {
        // LLM had tools available but didn't call any - this is normal behavior
        // Changed to info level since it's not an error, just informational
        logger.info('LLM_DID_NOT_CALL_TOOLS', {
          conversationId,
          channelType: message.channelType,
          availableToolCount: availableTools.length,
          availableToolNames: availableTools.map((t: any) => t.name),
          contentPreview: llmResponse.content?.substring(0, 200) || '',
          provider: llmResponse.provider,
          model: llmResponse.model,
        });
      }

      // 8. Handle tool calls if present
      const toolExecutions: any[] = [];
      let finalContent = llmResponse.content;

      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0 && this.config.enableToolExecution) {
        logger.info('Processing tool calls from LLM', {
          toolCallCount: llmResponse.toolCalls.length,
          toolNames: llmResponse.toolCalls.map((tc: any) => tc.name),
          conversationId,
        });

        const toolResults = await this.executeTools(
          llmResponse.toolCalls,
          mcpContext
        );

        toolExecutions.push(...toolResults);

        logger.info('Tool executions completed', {
          totalExecutions: toolResults.length,
          successCount: toolResults.filter((t: any) => t.status === 'success').length,
          failedCount: toolResults.filter((t: any) => t.status === 'failed').length,
          toolNames: toolResults.map((t: any) => `${t.toolName}:${t.status}`),
          conversationId,
        });

        // If we have tool results, we might need to call LLM again with the results
        if (toolResults.length > 0) {
          try {
            finalContent = await this.processToolResults(
              processingContext,
              prompt,
              llmResponse.content,
              toolResults,
              routingAction,
              flowRoutingResult
            );
          } catch (processError: any) {
            // If processing tool results fails, log the error but keep the original response
            // This ensures tool executions are still recorded
            logger.error('Failed to process tool results, using original LLM response', {
              error: processError.message,
              conversationId,
              toolCount: toolResults.length,
            });
            // Keep finalContent as the original llmResponse.content (already set above)
          }
        }
      }

      // 9. Add assistant message to context
      await this.contextManager.addMessage(
        mcpContext.sessionId,
        'assistant',
        finalContent,
        llmResponse.toolCalls
      );

      // 10. Build result
      const processingTimeMs = Date.now() - startTime;

      const result: ProcessingResult = {
        outgoingMessage: {
          channelUserId: message.channelUserId,
          content: finalContent,
          metadata: {
            conversationId,
            provider: llmResponse.provider,
            model: llmResponse.model,
          },
        },
        conversationId,
        llmProvider: llmResponse.provider,
        llmModel: llmResponse.model,
        tokensUsed: llmResponse.tokensUsed,
        cost: llmResponse.cost.totalCost,
        processingTimeMs,
        toolExecutions,
      };

      logger.info('Message processed successfully', {
        conversationId,
        processingTimeMs,
        toolExecutions: toolExecutions.length,
      });

      return result;
    } catch (error: any) {
      const processingTimeMs = Date.now() - startTime;

      logger.error('Error processing message', {
        error: error.message,
        conversationId,
        processingTimeMs,
      });

      // Return error response
      return {
        outgoingMessage: {
          channelUserId: message.channelUserId,
          content: this.getErrorMessage(error),
        },
        conversationId,
        llmProvider: this.config.defaultLLMProvider,
        llmModel: this.config.defaultLLMModel,
        tokensUsed: { input: 0, output: 0, total: 0 },
        cost: 0,
        processingTimeMs,
        toolExecutions: [],
        metadata: {
          error: error.message,
          errorCode: error.code,
        },
      };
    }
  }

  /**
   * Build prompt with conversation history and context
   */
  private async buildPrompt(context: ProcessingContext): Promise<string> {
    const history = await this.contextManager.getHistory(context.sessionId);

    // Format conversation history
    const historyText = this.contextManager.formatHistoryForLLM(history);

    // Build prompt
    let prompt = '';

    if (historyText) {
      prompt += `Previous conversation:\n${historyText}\n\n`;
    }

    prompt += `Current message: ${context.incomingMessage.content}`;

    return prompt;
  }

  /**
   * Execute tool calls from LLM
   */
  private async executeTools(
    toolCalls: any[],
    mcpContext: any
  ): Promise<any[]> {
    const results: any[] = [];

    // Limit number of tool executions
    const maxExecutions = Math.min(toolCalls.length, this.config.maxToolExecutions);

    for (let i = 0; i < maxExecutions; i++) {
      const toolCall = toolCalls[i];

      try {
        logger.info('Executing tool', {
          toolName: toolCall.name,
          sessionId: mcpContext.sessionId,
        });

        const execution = await this.mcpServer.executeTool(
          toolCall.name,
          toolCall.parameters,
          mcpContext
        );

        results.push(execution);

        // Add tool execution to context
        await this.contextManager.addToolExecution(mcpContext.sessionId, execution);

        logger.info('Tool executed successfully', {
          toolName: toolCall.name,
          executionTimeMs: execution.executionTimeMs,
        });
      } catch (error: any) {
        logger.error('Tool execution failed', {
          toolName: toolCall.name,
          error: error.message,
        });

        // Add failed execution to context
        const failedExecution = {
          id: generateUUID(),
          toolName: toolCall.name,
          parameters: toolCall.parameters,
          status: 'failed' as const,
          error: error.message,
          executionTimeMs: 0,
          executedAt: new Date().toISOString(),
        };

        results.push(failedExecution);
        await this.contextManager.addToolExecution(mcpContext.sessionId, failedExecution);
      }
    }

    return results;
  }

  /**
   * Process tool results and generate final response
   */
  private async processToolResults(
    context: ProcessingContext,
    originalPrompt: string,
    llmResponse: string,
    toolResults: any[],
    routingAction: any,
    flowRoutingResult?: any
  ): Promise<string> {
    // Build a new prompt with tool results
    const toolResultsText = toolResults
      .map((result) => {
        if (result.status === 'success') {
          return `Tool ${result.toolName} result: ${JSON.stringify(result.result)}`;
        } else {
          return `Tool ${result.toolName} failed: ${result.error}`;
        }
      })
      .join('\n');

    const newPrompt = `${originalPrompt}\n\nAssistant's response: ${llmResponse}\n\nTool execution results:\n${toolResultsText}\n\nPlease provide a final response to the user incorporating the tool results:`;

    // Call LLM again with tool results, using specific provider if available
    let finalResponse;
    if (flowRoutingResult && routingAction.llmProvider) {
      const providerEnum = this.convertProviderToEnum(routingAction.llmProvider);
      const specificProvider = this.llmGateway.getProvider(providerEnum);
      if (specificProvider) {
        finalResponse = await specificProvider.complete(newPrompt, {
          model: routingAction.llmModel,
          temperature: routingAction.temperature || 0.7,
          maxTokens: routingAction.maxTokens,
        });
      } else {
        finalResponse = await this.llmGateway.complete(newPrompt, {
          model: routingAction.llmModel,
          temperature: routingAction.temperature || 0.7,
          maxTokens: routingAction.maxTokens,
        });
      }
    } else {
      finalResponse = await this.llmGateway.complete(newPrompt, {
        model: routingAction.llmModel,
        temperature: routingAction.temperature || 0.7,
        maxTokens: routingAction.maxTokens,
      });
    }

    return finalResponse.content;
  }

  /**
   * Format tools for LLM
   */
  private formatToolsForLLM(tools: any[]): any[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: any): string {
    if (error instanceof MCPError) {
      return 'I encountered an issue while processing your request. Please try again.';
    }

    if (error instanceof LLMError) {
      return 'I am temporarily unable to respond. Please try again in a moment.';
    }

    return 'I apologize, but I encountered an unexpected error. Please try again.';
  }

  /**
   * Get orchestrator statistics
   */
  async getStats(): Promise<{
    mcpServerStats: any;
    llmHealthStatus: any;
  }> {
    return {
      mcpServerStats: this.mcpServer.getStats(),
      llmHealthStatus: this.llmGateway.getHealthStatus(),
    };
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      const mcpHealthy = await this.mcpServer.isHealthy();
      const llmHealthy = this.llmGateway.getHealthStatus().some((h) => h.isHealthy);

      return mcpHealthy && llmHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Convert provider string to enum if needed
   */
  private convertProviderToEnum(provider: string | LLMProvider): LLMProvider {
    if (typeof provider === 'string') {
      const normalized = provider.toLowerCase();
      switch (normalized) {
        case 'openai':
          return LLMProvider.OPENAI;
        case 'anthropic':
          return LLMProvider.ANTHROPIC;
        case 'google':
          return LLMProvider.GOOGLE;
        case 'ollama':
          return LLMProvider.OLLAMA;
        case 'huggingface':
          return LLMProvider.HUGGINGFACE;
        case 'lmstudio':
          return LLMProvider.LMSTUDIO;
        default:
          return provider as LLMProvider;
      }
    }
    return provider;
  }
}
