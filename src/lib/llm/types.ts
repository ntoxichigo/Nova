export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model?: string;
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
  testConnection(): Promise<boolean>;
}

export interface LLMConfig {
  provider: 'z-ai' | 'openai' | 'ollama' | 'lmstudio' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
