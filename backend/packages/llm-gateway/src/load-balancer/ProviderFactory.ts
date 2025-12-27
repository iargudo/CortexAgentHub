import { ILLMProvider, LLMProvider } from '@cortex/shared';
import { OpenAIProvider } from '../providers/openai/OpenAIProvider';
import { AnthropicProvider } from '../providers/anthropic/AnthropicProvider';
import { OllamaProvider } from '../providers/ollama/OllamaProvider';
import { GoogleProvider } from '../providers/google/GoogleProvider';
import { HuggingFaceProvider } from '../providers/huggingface/HuggingFaceProvider';
import { LMStudioProvider } from '../providers/lmstudio/LMStudioProvider';

/**
 * Factory for creating LLM provider instances
 */
export class ProviderFactory {
  /**
   * Create a provider instance based on the provider type
   */
  static createProvider(providerType: LLMProvider | string): ILLMProvider {
    const normalized = String(providerType).toLowerCase().trim();
    
    switch (normalized) {
      case 'openai':
        return new OpenAIProvider();
      case 'anthropic':
        return new AnthropicProvider();
      case 'ollama':
        return new OllamaProvider();
      case 'google':
        return new GoogleProvider();
      case 'huggingface':
        return new HuggingFaceProvider();
      case 'lmstudio':
        return new LMStudioProvider();
      default:
        throw new Error(`Unknown provider type: ${providerType}`);
    }
  }

  /**
   * Get all available provider types
   */
  static getAvailableProviders(): LLMProvider[] {
    return [
      LLMProvider.OPENAI,
      LLMProvider.ANTHROPIC,
      LLMProvider.OLLAMA,
      LLMProvider.GOOGLE,
      LLMProvider.HUGGINGFACE,
      LLMProvider.LMSTUDIO,
    ];
  }
}
