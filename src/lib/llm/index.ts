import type { LLMConfig, LLMProvider } from './types';
import { ZAIProvider, OpenAIProvider, XiaomiProvider, OllamaProvider, LMStudioProvider, CustomProvider, OpenRouterProvider, classifyLLMError } from './providers';

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'z-ai':
      return new ZAIProvider();
    case 'openai':
      return new OpenAIProvider(config);
    case 'xiaomi':
      return new XiaomiProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'ollama-cloud':
      return new OllamaProvider({
        ...config,
        baseUrl: 'https://ollama.com',
      });
    case 'lmstudio':
      return new LMStudioProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
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

export { ZAIProvider, OpenAIProvider, XiaomiProvider, OllamaProvider, LMStudioProvider, CustomProvider, classifyLLMError };

export type { LLMMessage, LLMResponse, LLMProvider, LLMConfig } from './types';
