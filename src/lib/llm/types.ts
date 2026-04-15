export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64 data URLs for vision models (e.g. "data:image/jpeg;base64,...") */
  images?: string[];
}

export type LLMErrorType = 'token_limit' | 'connection' | 'crash' | 'timeout';

export interface LLMProviderCapabilities {
  provider: LLMConfig['provider'];
  isLocal: boolean;
  supportsImages: boolean;
  supportsStreaming: boolean;
  defaultContextWindow: number;
  maxContextWindow: number;
  recommendedHistoryMessages: number;
  recommendedCompressionThreshold: number;
  recommendedMaxTokens: number;
  recommendedRetryAttempts: number;
  qualityTier: 'local' | 'standard' | 'premium';
}

export interface LLMResponse {
  content: string;
  model?: string;
  finishReason?: string;
}

export interface LLMGenerationMeta {
  finishReason?: string;
  model?: string;
  usedFallback?: boolean;
  reasoningOnly?: boolean;
  yieldedAny?: boolean;
}

export interface LLMProviderError {
  type: LLMErrorType;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

export interface LLMTestResult {
  success: boolean;
  provider: string;
  model?: string;
  message: string;
  latencyMs?: number;
  capabilities: LLMProviderCapabilities;
}

export interface LLMProvider {
  name: string;
  getCapabilities(): LLMProviderCapabilities;
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
  stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown>;
  testConnection(): Promise<LLMTestResult>;
  getLastGenerationMeta?(): LLMGenerationMeta | null;
}

export interface LLMConfig {
  provider: 'z-ai' | 'openai' | 'ollama' | 'ollama-cloud' | 'lmstudio' | 'openrouter' | 'custom' | 'xiaomi';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  historyBudget?: number;
  compressionThreshold?: number;
  retryAttempts?: number;
  qualityMode?: 'balanced' | 'high-quality' | 'high-context' | 'local-safe';
}
