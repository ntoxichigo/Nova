import type { LLMConfig, LLMProvider } from './types';
import { ZAIProvider, OpenAIProvider, OllamaProvider, LMStudioProvider, CustomProvider } from './providers';

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'z-ai':
      return new ZAIProvider();
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'lmstudio':
      return new LMStudioProvider(config);
    case 'custom':
      return new CustomProvider(config);
    default:
      return new ZAIProvider();
  }
}

export function getDefaultConfig(): LLMConfig {
  return {
    provider: 'z-ai',
  };
}

export { ZAIProvider, OpenAIProvider, OllamaProvider, LMStudioProvider, CustomProvider };

export type { LLMMessage, LLMResponse, LLMProvider, LLMConfig };
