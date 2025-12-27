import { Ollama } from 'ollama';
import {
  CompletionOptions,
  CompletionResponse,
  StreamOptions,
  Token,
  EmbeddingResponse,
  LLMProvider,
  LLM_COSTS,
  LLM_MAX_TOKENS,
  LLMError,
  ERROR_CODES,
} from '@cortex/shared';
import { BaseLLMProvider } from '../../interfaces/BaseLLMProvider';

/**
 * Ollama provider implementation
 * Supports local models like Llama 2, Mistral, CodeLlama, etc.
 */
export class OllamaProvider extends BaseLLMProvider {
  name = LLMProvider.OLLAMA;
  supportsMCP = false; // Local models don't typically support structured MCP
  supportsTools = true; // Supports tools via manual prompt-based tool calling
  maxTokens: number;
  costPerToken: { input: number; output: number };

  private client!: Ollama;

  constructor() {
    super();
    // Ollama is free (local), default to Llama 2 limits
    this.maxTokens = 4096;
    this.costPerToken = { input: 0, output: 0 };
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    const baseUrl = config.baseURL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

    this.client = new Ollama({ host: baseUrl });

    // Update max tokens based on model if known
    const modelKey = config.model as keyof typeof LLM_MAX_TOKENS.ollama;
    if (LLM_MAX_TOKENS.ollama[modelKey]) {
      this.maxTokens = LLM_MAX_TOKENS.ollama[modelKey];
    }

    this.logger.info('Ollama provider initialized', {
      model: config.model,
      baseUrl,
      maxTokens: this.maxTokens,
    });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    this.ensureInitialized();

    // Use model from options if provided, otherwise use config model
    const modelToUse = options.model || this.config.model;

    try {
      let systemPrompt = options.systemPrompt || '';
      
      // If tools are provided, add them to the system prompt for manual tool calling
      if (options.tools && options.tools.length > 0) {
        const toolsDescription = this.formatToolsForPrompt(options.tools);
        systemPrompt = systemPrompt 
          ? `${systemPrompt}\n\n${toolsDescription}` 
          : toolsDescription;
      }

      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

      this.logger.debug('Sending completion request to Ollama', {
        model: modelToUse,
        promptLength: fullPrompt.length,
      });

      const startTime = Date.now();

      const response = await this.client.generate({
        model: modelToUse,
        prompt: fullPrompt,
        options: {
          temperature: options.temperature ?? this.config.temperature ?? 0.7,
          top_p: options.topP ?? this.config.topP,
          stop: options.stopSequences ?? this.config.stopSequences,
          num_predict: options.maxTokens ?? this.config.maxTokens,
        },
      });

      const executionTime = Date.now() - startTime;

      // Ollama provides token counts
      const tokensUsed = {
        input: response.prompt_eval_count || this.estimateTokens(fullPrompt),
        output: response.eval_count || this.estimateTokens(response.response),
        total: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      };

      const cost = this.calculateCost(tokensUsed); // Will be 0 for local models

      // Parse response for tool calls (manual tool calling)
      const { content, toolCalls } = this.parseToolCalls(response.response, options.tools || []);

      const result: CompletionResponse = {
        content,
        provider: this.name,
        model: modelToUse, // Use the actual model that was used
        tokensUsed,
        cost,
        finishReason: response.done ? (toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop') : 'length',
        toolCalls,
        metadata: {
          executionTimeMs: executionTime,
          totalDuration: response.total_duration,
          loadDuration: response.load_duration,
          evalDuration: response.eval_duration,
        },
      };

      this.logger.info('Completion successful', {
        tokens: tokensUsed.total,
        executionTime: `${executionTime}ms`,
      });

      return result;
    } catch (error: any) {
      this.logger.error('Ollama completion failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Ollama API error: ${error.message}`,
        { provider: this.name, model: modelToUse, originalError: error }
      );
    }
  }

  async *stream(prompt: string, options: StreamOptions): AsyncGenerator<Token> {
    this.ensureInitialized();

    try {
      const systemPrompt = options.systemPrompt || '';
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

      const response = await this.client.generate({
        model: this.config.model,
        prompt: fullPrompt,
        stream: true,
        options: {
          temperature: options.temperature ?? this.config.temperature ?? 0.7,
          num_predict: options.maxTokens ?? this.config.maxTokens,
        },
      });

      let index = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      for await (const chunk of response) {
        const content = chunk.response;

        if (content) {
          const token: Token = {
            content,
            index: index++,
            isComplete: false,
          };

          if (options.onToken) {
            options.onToken(content);
          }

          yield token;
        }

        // Update token counts
        if (chunk.prompt_eval_count) {
          totalInputTokens = chunk.prompt_eval_count;
        }
        if (chunk.eval_count) {
          totalOutputTokens += chunk.eval_count;
        }
      }

      // Final token to indicate completion
      yield {
        content: '',
        index,
        isComplete: true,
      };

      if (options.onComplete) {
        const tokensUsed = {
          input: totalInputTokens || this.estimateTokens(fullPrompt),
          output: totalOutputTokens,
          total: totalInputTokens + totalOutputTokens,
        };

        options.onComplete({
          content: '',
          provider: this.name,
          model: this.config.model,
          tokensUsed,
          cost: this.calculateCost(tokensUsed),
          finishReason: 'stop',
        });
      }
    } catch (error: any) {
      this.logger.error('Ollama streaming failed', { error: error.message });

      if (options.onError) {
        options.onError(error);
      }

      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Ollama streaming error: ${error.message}`,
        { provider: this.name, model: this.config.model }
      );
    }
  }

  async embeddings(text: string): Promise<EmbeddingResponse> {
    this.ensureInitialized();

    try {
      // Ollama supports embeddings with specific models
      const response = await this.client.embeddings({
        model: this.config.model,
        prompt: text,
      });

      const tokensUsed = this.estimateTokens(text);

      return {
        embedding: response.embedding,
        provider: this.name,
        model: this.config.model,
        tokensUsed,
        cost: {
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          currency: 'USD',
        },
      };
    } catch (error: any) {
      this.logger.error('Ollama embeddings failed', { error: error.message });
      throw new LLMError(
        ERROR_CODES.LLM_API_ERROR,
        `Ollama embeddings error: ${error.message}. Make sure you're using an embedding model.`
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Check if Ollama is running and model is available
      const models = await this.client.list();
      const modelExists = models.models.some((m) => m.name.includes(this.config.model));
      return modelExists;
    } catch {
      return false;
    }
  }

  /**
   * Pull a model if it doesn't exist (Ollama-specific)
   */
  async pullModel(modelName: string): Promise<void> {
    try {
      this.logger.info(`Pulling model: ${modelName}`);
      await this.client.pull({ model: modelName });
      this.logger.info(`Model pulled successfully: ${modelName}`);
    } catch (error: any) {
      this.logger.error(`Failed to pull model ${modelName}`, { error: error.message });
      throw new LLMError(ERROR_CODES.LLM_API_ERROR, `Failed to pull model: ${error.message}`);
    }
  }

  /**
   * List available models (Ollama-specific)
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.list();
      return response.models.map((m) => m.name);
    } catch (error: any) {
      this.logger.error('Failed to list models', { error: error.message });
      return [];
    }
  }

  /**
   * Format tools for inclusion in the prompt (manual tool calling)
   */
  private formatToolsForPrompt(tools: any[]): string {
    const toolDescriptions = tools.map((tool) => {
      const params = tool.parameters?.properties 
        ? Object.entries(tool.parameters.properties)
            .map(([key, value]: [string, any]) => `  - ${key} (${value.type}): ${value.description || ''}`)
            .join('\n')
        : '  No parameters';
      
      return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
    }).join('\n\n');

    return `# Available Tools

You have access to the following tools that you can use to help the user:

${toolDescriptions}

## How to Use Tools

When you need to use a tool to answer the user's question, respond with ONLY a JSON object (no other text) in this EXACT format:

\`\`\`json
{
  "tool": "tool_name",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

CRITICAL RULES:
1. Analyze the user's request and determine if any available tool can help answer it
2. If a tool is needed, respond with ONLY the JSON object - no explanations, no conversational text
3. The JSON must be valid and match the format exactly
4. Use the exact tool name as listed above
5. Provide all required parameters for the tool
6. After the tool executes, you will receive the results and can then provide a natural, conversational response to the user

If no tool is needed, respond normally with conversational text.`;
  }

  /**
   * Parse the model's response to detect tool calls (manual tool calling)
   */
  private parseToolCalls(response: string, tools: any[]): { content: string; toolCalls?: any[] } {
    // Log the response for debugging
    this.logger.debug('Parsing response for tool calls', { 
      responsePreview: response.substring(0, 200),
      toolsAvailable: tools.map(t => t.name)
    });

    // Try to extract JSON from markdown code blocks or plain JSON
    const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/) || 
                     response.match(/```\s*\n([\s\S]*?)\n```/) || 
                     response.match(/(\{[\s\S]*?\})/);
    
    if (!jsonMatch) {
      this.logger.debug('No JSON found in response');
      return { content: response };
    }

    try {
      const jsonStr = jsonMatch[1].trim();
      const parsed = JSON.parse(jsonStr);

      this.logger.debug('Parsed JSON from response', { parsed });

      // Check if it's a tool call
      if (parsed.tool && parsed.parameters) {
        const toolName = parsed.tool;
        const toolExists = tools.some((t) => t.name === toolName);

        if (toolExists) {
          this.logger.info('Tool call detected successfully', { 
            tool: toolName, 
            parameters: parsed.parameters 
          });
          
          return {
            content: response, // Keep original response
            toolCalls: [{
              id: `call_${Date.now()}`,
              name: toolName,
              parameters: parsed.parameters,
              timestamp: new Date().toISOString(),
            }],
          };
        } else {
          this.logger.warn('Tool not found in available tools', { 
            requestedTool: toolName,
            availableTools: tools.map(t => t.name)
          });
        }
      } else {
        this.logger.debug('JSON found but not a tool call format', { 
          hasToolField: !!parsed.tool,
          hasParametersField: !!parsed.parameters 
        });
      }
    } catch (error) {
      // Not valid JSON or not a tool call, return as regular content
      this.logger.debug('Failed to parse potential tool call', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        jsonStr: jsonMatch ? jsonMatch[1].substring(0, 100) : 'none'
      });
    }

    return { content: response };
  }
}
