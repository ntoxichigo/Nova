import type { LLMMessage, LLMResponse, LLMProvider, LLMConfig } from './types';
import ZAI from 'z-ai-web-dev-sdk';

const DEFAULT_TIMEOUT = 30000;

export class ZAIProvider implements LLMProvider {
  name = 'Z-AI (Built-in)';

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return {
      content: completion.choices[0]?.message?.content || 'No response generated.',
      model: completion.model,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const zai = await ZAI.create();
      await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

export class OpenAIProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens?: number;

  constructor(config: LLMConfig) {
    this.name = 'OpenAI-Compatible';
    this.apiKey = config.apiKey || '';
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'gpt-4';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: this.temperature,
      };
      if (this.maxTokens) {
        body.max_tokens = this.maxTokens;
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenAI API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      return {
        content: data.choices?.[0]?.message?.content || 'No response generated.',
        model: data.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      // If models endpoint fails, try a simple chat
      try {
        await this.chat([{ role: 'user', content: 'Hi' }]);
        return true;
      } catch {
        return false;
      }
    }
  }
}

export class OllamaProvider implements LLMProvider {
  name = 'Ollama (Local)';
  private baseUrl: string;
  private model: string;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || 'llama3';
    this.temperature = config.temperature ?? 0.7;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          options: {
            temperature: this.temperature,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Ollama API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      return {
        content: data.message?.content || 'No response generated.',
        model: data.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class LMStudioProvider implements LLMProvider {
  name = 'LM Studio (Local)';
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens?: number;

  constructor(config: LLMConfig) {
    this.baseUrl = (config.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '');
    this.model = config.model || 'default';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: this.temperature,
      };
      if (this.maxTokens) {
        body.max_tokens = this.maxTokens;
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`LM Studio API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      return {
        content: data.choices?.[0]?.message?.content || 'No response generated.',
        model: data.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class CustomProvider implements LLMProvider {
  name = 'Custom Provider';
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens?: number;

  constructor(config: LLMConfig) {
    this.baseUrl = (config.baseUrl || 'http://localhost:8080').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'default';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: this.temperature,
      };
      if (this.maxTokens) {
        body.max_tokens = this.maxTokens;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Custom API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      return {
        content: data.choices?.[0]?.message?.content || 'No response generated.',
        model: data.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
