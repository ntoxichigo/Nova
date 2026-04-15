import ZAI from 'z-ai-web-dev-sdk';
import type {
  LLMConfig,
  LLMGenerationMeta,
  LLMMessage,
  LLMProvider,
  LLMProviderCapabilities,
  LLMProviderError,
  LLMResponse,
  LLMTestResult,
} from './types';
import { XIAOMI_MODELS, findXiaomiModel, isXiaomiMimoModelId, normalizeXiaomiBaseUrl, normalizeXiaomiModelId } from './xiaomi-models';

const DEFAULT_TIMEOUT = 600_000;
const CLOUD_TIMEOUT = 600_000;
const LOCAL_TIMEOUT = 600_000;
const STREAM_FIRST_CHUNK_IDLE_MS = 45_000;
const STREAM_CHUNK_IDLE_MS = 16_000;

const DEFAULT_CAPABILITIES: Record<LLMConfig['provider'], LLMProviderCapabilities> = {
  'z-ai': {
    provider: 'z-ai',
    isLocal: false,
    supportsImages: false,
    supportsStreaming: false,
    defaultContextWindow: 128_000,
    maxContextWindow: 128_000,
    recommendedHistoryMessages: 28,
    recommendedCompressionThreshold: 32,
    recommendedMaxTokens: 8_192,
    recommendedRetryAttempts: 1,
    qualityTier: 'premium',
  },
  'openai': {
    provider: 'openai',
    isLocal: false,
    supportsImages: true,
    supportsStreaming: true,
    defaultContextWindow: 128_000,
    maxContextWindow: 200_000,
    recommendedHistoryMessages: 28,
    recommendedCompressionThreshold: 32,
    recommendedMaxTokens: 8_192,
    recommendedRetryAttempts: 1,
    qualityTier: 'premium',
  },
  'ollama': {
    provider: 'ollama',
    isLocal: true,
    supportsImages: true,
    supportsStreaming: true,
    defaultContextWindow: 32_768,
    maxContextWindow: 131_072,
    recommendedHistoryMessages: 16,
    recommendedCompressionThreshold: 18,
    recommendedMaxTokens: 4_096,
    recommendedRetryAttempts: 0,
    qualityTier: 'local',
  },
  'ollama-cloud': {
    provider: 'ollama-cloud',
    isLocal: false,
    supportsImages: true,
    supportsStreaming: true,
    defaultContextWindow: 65_536,
    maxContextWindow: 131_072,
    recommendedHistoryMessages: 20,
    recommendedCompressionThreshold: 24,
    recommendedMaxTokens: 8_192,
    recommendedRetryAttempts: 1,
    qualityTier: 'standard',
  },
  'lmstudio': {
    provider: 'lmstudio',
    isLocal: true,
    supportsImages: false,
    supportsStreaming: true,
    defaultContextWindow: 32_768,
    maxContextWindow: 131_072,
    recommendedHistoryMessages: 14,
    recommendedCompressionThreshold: 18,
    recommendedMaxTokens: 4_096,
    recommendedRetryAttempts: 0,
    qualityTier: 'local',
  },
  'custom': {
    provider: 'custom',
    isLocal: false,
    supportsImages: false,
    supportsStreaming: true,
    defaultContextWindow: 65_536,
    maxContextWindow: 131_072,
    recommendedHistoryMessages: 18,
    recommendedCompressionThreshold: 22,
    recommendedMaxTokens: 4_096,
    recommendedRetryAttempts: 1,
    qualityTier: 'standard',
  },
  'openrouter': {
    provider: 'openrouter',
    isLocal: false,
    supportsImages: true,
    supportsStreaming: true,
    defaultContextWindow: 128_000,
    maxContextWindow: 200_000,
    recommendedHistoryMessages: 28,
    recommendedCompressionThreshold: 32,
    recommendedMaxTokens: 16_384,
    recommendedRetryAttempts: 1,
    qualityTier: 'premium',
  },
  'xiaomi': {
    provider: 'xiaomi',
    isLocal: false,
    supportsImages: true,
    supportsStreaming: true,
    defaultContextWindow: 262_144,
    maxContextWindow: 1_000_000,
    recommendedHistoryMessages: 28,
    recommendedCompressionThreshold: 32,
    recommendedMaxTokens: 16_384,
    recommendedRetryAttempts: 1,
    qualityTier: 'premium',
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function withConfigOverrides(
  capabilities: LLMProviderCapabilities,
  config: LLMConfig,
): LLMProviderCapabilities {
  return {
    ...capabilities,
    defaultContextWindow: clamp(
      config.contextWindow ?? capabilities.defaultContextWindow,
      2_048,
      capabilities.maxContextWindow,
    ),
    recommendedHistoryMessages: clamp(
      config.historyBudget ?? capabilities.recommendedHistoryMessages,
      4,
      48,
    ),
    recommendedCompressionThreshold: clamp(
      config.compressionThreshold ?? capabilities.recommendedCompressionThreshold,
      6,
      96,
    ),
    recommendedMaxTokens: clamp(
      config.maxTokens ?? capabilities.recommendedMaxTokens,
      256,
      32_768,
    ),
    recommendedRetryAttempts: clamp(
      config.retryAttempts ?? capabilities.recommendedRetryAttempts,
      0,
      3,
    ),
  };
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') {
          const item = entry as Record<string, unknown>;
          if (typeof item.text === 'string') return item.text;
          if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
          if (item.type === 'text' && typeof item.text === 'string') return item.text;
          if (typeof item.content === 'string') return item.content;
        }
        return '';
      })
      .join('');
  }
  return '';
}

function hasReasoningContent(content: unknown): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }

  if (Array.isArray(content)) {
    return content.some((entry) => {
      if (typeof entry === 'string') {
        return entry.trim().length > 0;
      }
      if (entry && typeof entry === 'object') {
        const item = entry as Record<string, unknown>;
        return (
          item.type === 'reasoning' ||
          item.type === 'thinking' ||
          typeof item.reasoning === 'string' ||
          typeof item.reasoning_text === 'string' ||
          typeof item.reasoning_content === 'string'
        );
      }
      return false;
    });
  }

  if (content && typeof content === 'object') {
    const item = content as Record<string, unknown>;
    return (
      typeof item.reasoning === 'string' ||
      typeof item.reasoning_text === 'string' ||
      typeof item.reasoning_content === 'string'
    );
  }

  return false;
}

function buildOpenAICompatibleMessages(messages: LLMMessage[], supportsImages: boolean) {
  return messages.map((message) => {
    if (supportsImages && message.images?.length) {
      return {
        role: message.role,
        content: [
          { type: 'text', text: message.content },
          ...message.images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
        ],
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

function extractChunkText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload as Record<string, unknown>;

  const choice = Array.isArray(data.choices) ? data.choices[0] as Record<string, unknown> : null;
  const delta = choice?.delta as Record<string, unknown> | undefined;
  const message = choice?.message as Record<string, unknown> | undefined;

  return (
    normalizeTextContent(delta?.content) ||
    normalizeTextContent(message?.content) ||
    normalizeTextContent(data.response) ||
    normalizeTextContent(data.output_text) ||
    normalizeTextContent(data.message ? (data.message as Record<string, unknown>).content : undefined)
  );
}

function extractChunkFinishReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const data = payload as Record<string, unknown>;
  const choice = Array.isArray(data.choices) ? data.choices[0] as Record<string, unknown> : null;
  const finishReason = choice?.finish_reason;
  return typeof finishReason === 'string' ? finishReason : undefined;
}

function extractReasoningOnlySignal(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Record<string, unknown>;
  const choice = Array.isArray(data.choices) ? data.choices[0] as Record<string, unknown> : null;
  const delta = choice?.delta as Record<string, unknown> | undefined;
  const message = choice?.message as Record<string, unknown> | undefined;

  return Boolean(
    hasReasoningContent(delta?.reasoning_content) ||
    hasReasoningContent(delta?.reasoning) ||
    hasReasoningContent(message?.reasoning_content) ||
    hasReasoningContent(message?.reasoning) ||
    hasReasoningContent(data.reasoning_content) ||
    hasReasoningContent(data.reasoning)
  );
}

function buildOpenAIStyleResponse(data: Record<string, unknown>, fallbackModel: string): LLMResponse & { reasoningOnly: boolean } {
  const choice = Array.isArray(data.choices) ? data.choices[0] as Record<string, unknown> : null;
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = normalizeTextContent(message?.content);
  const reasoningOnly = !content && extractReasoningOnlySignal(data);

  return {
    content,
    model: (typeof data.model === 'string' ? data.model : fallbackModel) || fallbackModel,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    reasoningOnly,
  };
}

function createAbortController(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timeout) };
}

function parseStatusCode(message: string): number | undefined {
  const match = message.match(/\((\d{3})\)/);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

function isLikelyRetryableStatus(statusCode?: number): boolean {
  return statusCode === 408 || statusCode === 409 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
}

function isLikelySpeechOnlyModelId(modelId: string): boolean {
  return /\b(tts|speech|voice|audio[-_]?out)\b/i.test(modelId);
}

export function classifyLLMError(error: unknown): LLMProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const statusCode = parseStatusCode(message);
  const providerExcerpt = (() => {
    const idx = message.indexOf(':');
    if (idx === -1) return '';
    const tail = message.slice(idx + 1).trim();
    return tail ? tail.slice(0, 280) : '';
  })();

  if (lowered.includes('abort') || lowered.includes('timed out') || lowered.includes('timeout')) {
    return {
      type: 'timeout',
      message: 'The model took too long to finish. Try a shorter reply budget or a smaller context window.',
      retryable: true,
      statusCode,
    };
  }

  if (
    lowered.includes('maximum context length') ||
    lowered.includes('context length') ||
    lowered.includes('too many tokens') ||
    lowered.includes('token limit') ||
    lowered.includes('prompt is too long') ||
    lowered.includes('context window')
  ) {
    return {
      type: 'token_limit',
      message: 'This request exceeded the model context or token budget. Retry with a smaller response or shorter history.',
      retryable: true,
      statusCode,
    };
  }

  if (
    lowered.includes('fetch failed') ||
    lowered.includes('econnrefused') ||
    lowered.includes('enotfound') ||
    lowered.includes('network') ||
    lowered.includes('connection') ||
    lowered.includes('service unavailable')
  ) {
    return {
      type: 'connection',
      message: 'The model endpoint could not be reached. Check that the provider is running and reachable from Nova.',
      retryable: true,
      statusCode,
    };
  }

  if (statusCode === 401 || lowered.includes('unauthorized') || lowered.includes('invalid api key') || lowered.includes('invalid_api_key')) {
    return {
      type: 'crash',
      message: 'API key is invalid or missing. Check your API key in Settings.',
      retryable: false,
      statusCode,
    };
  }

  if (statusCode === 403 || lowered.includes('forbidden') || lowered.includes('permission denied') || lowered.includes('insufficient_quota') || lowered.includes('no credits')) {
    return {
      type: 'crash',
      message: providerExcerpt
        ? `Access denied. Provider response: ${providerExcerpt}`
        : 'Access denied. Your API key may lack credits or permission for this model. Check your account balance and model access.',
      retryable: false,
      statusCode,
    };
  }

  if (
    statusCode === 402 ||
    lowered.includes('insufficient_balance') ||
    lowered.includes('insufficient account balance') ||
    lowered.includes('payment required')
  ) {
    return {
      type: 'crash',
      message: providerExcerpt
        ? `Billing denied request. Provider response: ${providerExcerpt}`
        : 'Billing denied request. Your provider account or plan does not have enough balance for this model.',
      retryable: false,
      statusCode,
    };
  }

  if (statusCode === 404 || lowered.includes('model not found') || lowered.includes('no such model') || lowered.includes('does not exist')) {
    return {
      type: 'crash',
      message: 'Model not found. Check the model ID in Settings - it may be misspelled or unavailable on this provider.',
      retryable: false,
      statusCode,
    };
  }

  return {
    type: 'crash',
    message: isLikelyRetryableStatus(statusCode)
      ? 'The model endpoint returned a transient failure. Retrying usually helps.'
      : 'The model failed while generating a response. Try a different model or a safer runtime profile.',
    retryable: isLikelyRetryableStatus(statusCode),
    statusCode,
  };
}

async function* streamOpenAICompatible(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutMs: number,
  retryAttempts: number,
  metaTarget?: LLMGenerationMeta,
): AsyncGenerator<string, void, unknown> {
  let attempt = 0;

  while (attempt <= retryAttempts) {
    const { controller, clear } = createAbortController(timeoutMs);
    let yieldedAny = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => controller.abort(),
        yieldedAny ? STREAM_CHUNK_IDLE_MS : STREAM_FIRST_CHUNK_IDLE_MS,
      );
    };

    try {
      resetIdleTimer();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ...body, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`API error (${response.status}): ${text}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdleTimer();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;

          const payload = line.replace(/^data:\s*/, '').trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            if (metaTarget && !metaTarget.finishReason) {
              metaTarget.finishReason = 'stop';
            }
            return;
          }

          try {
            const parsed = JSON.parse(payload);
            if (metaTarget) {
              metaTarget.finishReason = extractChunkFinishReason(parsed) || metaTarget.finishReason;
              const parsedModel = parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).model === 'string'
                ? String((parsed as Record<string, unknown>).model)
                : undefined;
              metaTarget.model = parsedModel || metaTarget.model;
              metaTarget.reasoningOnly = (metaTarget.reasoningOnly || false) || extractReasoningOnlySignal(parsed);
            }
            const delta = extractChunkText(parsed);
            if (delta) {
              yieldedAny = true;
              resetIdleTimer();
              if (metaTarget) metaTarget.yieldedAny = true;
              yield delta;
            }
          } catch {
            continue;
          }
        }
      }

      const tail = buffer.trim();
      if (tail.startsWith('data:')) {
        const payload = tail.replace(/^data:\s*/, '').trim();
        if (payload === '[DONE]') {
          if (metaTarget && !metaTarget.finishReason) {
            metaTarget.finishReason = 'stop';
          }
          return;
        }
        if (payload) {
          try {
            const parsed = JSON.parse(payload);
            if (metaTarget) {
              metaTarget.finishReason = extractChunkFinishReason(parsed) || metaTarget.finishReason;
              const parsedModel = parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).model === 'string'
                ? String((parsed as Record<string, unknown>).model)
                : undefined;
              metaTarget.model = parsedModel || metaTarget.model;
              metaTarget.reasoningOnly = (metaTarget.reasoningOnly || false) || extractReasoningOnlySignal(parsed);
            }
            const delta = extractChunkText(parsed);
            if (delta) {
              if (metaTarget) metaTarget.yieldedAny = true;
              yield delta;
            }
          } catch {
            // Ignore incomplete trailing payloads.
          }
        }
      }

      return;
    } catch (error) {
      const classified = classifyLLMError(error);
      if (classified.type === 'timeout' && yieldedAny) {
        if (metaTarget && !metaTarget.finishReason) {
          metaTarget.finishReason = 'stop';
        }
        return;
      }
      if (attempt >= retryAttempts || yieldedAny || !classified.retryable) {
        throw error;
      }
      attempt += 1;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      clear();
    }
  }
}

abstract class BaseProvider implements LLMProvider {
  name: string;
  protected config: LLMConfig;
  private capabilities: LLMProviderCapabilities;
  private lastGenerationMeta: LLMGenerationMeta | null = null;

  constructor(name: string, config: LLMConfig, defaults: LLMProviderCapabilities) {
    this.name = name;
    this.config = config;
    this.capabilities = withConfigOverrides(defaults, config);
  }

  getCapabilities(): LLMProviderCapabilities {
    return this.capabilities;
  }

  protected setLastGenerationMeta(meta: LLMGenerationMeta | null): void {
    this.lastGenerationMeta = meta ? { ...meta } : null;
  }

  getLastGenerationMeta(): LLMGenerationMeta | null {
    return this.lastGenerationMeta ? { ...this.lastGenerationMeta } : null;
  }

  protected createTestResult(
    success: boolean,
    message: string,
    extras: Partial<Omit<LLMTestResult, 'success' | 'message' | 'provider' | 'capabilities'>> = {},
  ): LLMTestResult {
    return {
      success,
      provider: this.name,
      message,
      capabilities: this.getCapabilities(),
      ...extras,
    };
  }

  abstract chat(messages: LLMMessage[]): Promise<LLMResponse>;
  abstract stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown>;
  abstract testConnection(): Promise<LLMTestResult>;
}

export class ZAIProvider extends BaseProvider {
  constructor(config: LLMConfig = { provider: 'z-ai' }) {
    super('Z-AI (Built-in)', config, DEFAULT_CAPABILITIES['z-ai']);
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
    });

    const result = {
      content: completion.choices[0]?.message?.content || '',
      model: completion.model,
    };
    this.setLastGenerationMeta({
      model: result.model,
      finishReason: completion.choices[0]?.finish_reason,
      yieldedAny: Boolean(result.content),
      reasoningOnly: false,
    });
    return result;
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const response = await this.chat(messages);
    if (response.content) {
      yield response.content;
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await this.chat([{ role: 'user', content: 'Reply with: ok' }]);
      return this.createTestResult(true, 'Built-in provider is responding normally.', {
        latencyMs: Date.now() - startedAt,
        model: response.model,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

export class OpenAIProvider extends BaseProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    super('OpenAI-Compatible', config, DEFAULT_CAPABILITIES.openai);
    this.apiKey = config.apiKey || '';
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'gpt-4.1-mini';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = clamp(
      config.maxTokens ?? this.getCapabilities().recommendedMaxTokens,
      64,
      32_768,
    );
  }

  private buildBody(): Record<string, unknown> {
    return {
      model: this.model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const { controller, clear } = createAbortController(DEFAULT_TIMEOUT);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          ...this.buildBody(),
          messages: buildOpenAICompatibleMessages(messages, this.getCapabilities().supportsImages),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const parsed = buildOpenAIStyleResponse(data, this.model);
      this.setLastGenerationMeta({
        model: parsed.model,
        finishReason: parsed.finishReason,
        reasoningOnly: parsed.reasoningOnly,
        yieldedAny: Boolean(parsed.content),
      });
      return {
        content: parsed.content,
        model: parsed.model,
        finishReason: parsed.finishReason,
      };
    } finally {
      clear();
    }
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const meta: LLMGenerationMeta = { model: this.model, yieldedAny: false, reasoningOnly: false };
    try {
      yield* streamOpenAICompatible(
        `${this.baseUrl}/chat/completions`,
        {
          ...this.buildBody(),
          messages: buildOpenAICompatibleMessages(messages, this.getCapabilities().supportsImages),
        },
        { Authorization: `Bearer ${this.apiKey}` },
        DEFAULT_TIMEOUT,
        this.getCapabilities().recommendedRetryAttempts,
        meta,
      );
    } finally {
      this.setLastGenerationMeta(meta);
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json();
      const model = data.data?.[0]?.id || this.model;
      return this.createTestResult(true, 'Provider is reachable and returned a model list.', {
        latencyMs: Date.now() - startedAt,
        model,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

export class XiaomiProvider extends BaseProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    super('Xiaomi MiMo', config, DEFAULT_CAPABILITIES.xiaomi);
    this.apiKey = config.apiKey || '';
    this.baseUrl = normalizeXiaomiBaseUrl(config.baseUrl || 'https://api.xiaomimimo.com/v1');
    const normalizedConfiguredModel = normalizeXiaomiModelId(config.model);
    const configuredRaw = String(config.model || '').trim();
    this.model = normalizedConfiguredModel || (isXiaomiMimoModelId(configuredRaw) ? configuredRaw : 'mimo-v2-pro');
    this.temperature = config.temperature ?? 0.7;
    const modelSpec = findXiaomiModel(this.model);
    this.maxTokens = clamp(
      config.maxTokens ?? Math.min(this.getCapabilities().recommendedMaxTokens, modelSpec?.maxCompletionTokens ?? 16_384),
      64,
      modelSpec?.maxCompletionTokens ?? 131_072,
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'NovaAI',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildBody(messages: LLMMessage[], modelOverride: string = this.model): Record<string, unknown> {
    return {
      model: modelOverride,
      temperature: this.temperature,
      // Use OpenAI-compatible field name. Some gateways reject nonstandard params.
      max_tokens: this.maxTokens,
      messages: buildOpenAICompatibleMessages(messages, this.getCapabilities().supportsImages),
    };
  }

  private async listAvailableChatModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const ids: string[] = Array.isArray(data?.data)
        ? (data.data as Array<{ id?: unknown }>)
          .map((m) => String(m?.id || '').trim())
          .filter(Boolean)
        : [];
      const normalizedMimo = ids
        .map((id) => normalizeXiaomiModelId(id) || id)
        .filter((id) => isXiaomiMimoModelId(id) && !isLikelySpeechOnlyModelId(id));
      const genericChat = ids
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && !isLikelySpeechOnlyModelId(id));
      return [...new Set([...normalizedMimo, ...genericChat])];
    } catch {
      return [];
    }
  }

  private buildFallbackCandidates(availableFromProvider: string[]): string[] {
    const staticChatModels = XIAOMI_MODELS
      .filter((model) => model.category !== 'tts')
      .map((model) => model.id);

    const preferredOrder = ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'];
    const merged = [this.model, ...availableFromProvider, ...preferredOrder, ...staticChatModels];
    return [...new Set(
      merged.filter((id) => id && !isLikelySpeechOnlyModelId(id)),
    )];
  }

  private isModelFallbackEligibleError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    const status = parseStatusCode(message);
    const explicitModelIssue = (
      lowered.includes('illegal_access') ||
      lowered.includes('access denied') ||
      lowered.includes('forbidden') ||
      lowered.includes('model not found') ||
      lowered.includes('invalid model') ||
      lowered.includes('unsupported model') ||
      lowered.includes('permission')
    );

    if (explicitModelIssue) {
      return true;
    }

    // Some Xiaomi models (especially multimodal variants) can intermittently fail
    // with transient server-side errors. Allow fallback within MiMo family.
    const transientServerIssue =
      lowered.includes('internal') ||
      lowered.includes('server error') ||
      lowered.includes('overloaded') ||
      lowered.includes('temporarily unavailable') ||
      lowered.includes('model failed');

    if ([429, 500, 502, 503].includes(status ?? -1) && transientServerIssue) {
      return true;
    }

    return false;
  }

  private async chatWithModel(messages: LLMMessage[], model: string): Promise<LLMResponse> {
    const { controller, clear } = createAbortController(CLOUD_TIMEOUT);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildHeaders(),
        },
        body: JSON.stringify(this.buildBody(messages, model)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Xiaomi API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const parsed = buildOpenAIStyleResponse(data, model);
      return {
        content: parsed.content,
        model: parsed.model,
        finishReason: parsed.finishReason,
      };
    } finally {
      clear();
    }
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    let lastError: unknown = null;

    const runAndRecord = async (candidateModel: string) => {
      const result = await this.chatWithModel(messages, candidateModel);
      this.setLastGenerationMeta({
        model: result.model || candidateModel,
        finishReason: result.finishReason,
        reasoningOnly: false,
        yieldedAny: Boolean(result.content),
      });
      if (candidateModel !== this.model) {
        this.model = candidateModel;
      }
      return result;
    };

    try {
      return await runAndRecord(this.model);
    } catch (error) {
      lastError = error;
      if (!this.isModelFallbackEligibleError(error)) {
        throw error;
      }
    }

    const available = await this.listAvailableChatModels();
    const candidates = this.buildFallbackCandidates(available).filter((model) => model !== this.model);
    for (const candidate of candidates) {
      try {
        return await runAndRecord(candidate);
      } catch (error) {
        lastError = error;
        if (!this.isModelFallbackEligibleError(error)) {
          throw error;
        }
      }
    }

    throw (lastError ?? new Error('Xiaomi API error: no reachable model candidates.'));
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    let meta: LLMGenerationMeta = {
      model: this.model,
      yieldedAny: false,
      reasoningOnly: false,
    };

    const streamWithModel = async function* (
      provider: XiaomiProvider,
      model: string,
      inputMessages: LLMMessage[],
      targetMeta: LLMGenerationMeta,
    ): AsyncGenerator<string, void, unknown> {
      yield* streamOpenAICompatible(
        `${provider.baseUrl}/chat/completions`,
        provider.buildBody(inputMessages, model),
        provider.buildHeaders(),
        CLOUD_TIMEOUT,
        provider.getCapabilities().recommendedRetryAttempts,
        targetMeta,
      );
    };

    let lastError: unknown = null;
    const startingModel = this.model;

    try {
      try {
        yield* streamWithModel(this, startingModel, messages, meta);
        return;
      } catch (error) {
        lastError = error;
        if (!this.isModelFallbackEligibleError(error)) {
          throw error;
        }
      }

      const available = await this.listAvailableChatModels();
      const candidates = this.buildFallbackCandidates(available).filter((model) => model !== startingModel);
      for (const candidate of candidates) {
        const retryMeta: LLMGenerationMeta = {
          model: candidate,
          yieldedAny: false,
          reasoningOnly: false,
        };
        try {
          yield* streamWithModel(this, candidate, messages, retryMeta);
          this.model = candidate;
          meta = retryMeta;
          return;
        } catch (error) {
          lastError = error;
          if (!this.isModelFallbackEligibleError(error)) {
            throw error;
          }
        }
      }

      throw (lastError ?? new Error('Xiaomi API error: no reachable model candidates for streaming.'));
    } finally {
      this.setLastGenerationMeta(meta);
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Xiaomi API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json();
      const ids: string[] = Array.isArray(data?.data)
        ? (data.data as Array<{ id?: unknown }>).map((m) => String(m?.id || '')).filter(Boolean)
        : [];
      const availableChatIds = [...new Set(
        ids
          .map((id) => String(id).trim())
          .filter(Boolean)
          .filter((id) => !isLikelySpeechOnlyModelId(id)),
      )];
      const availableMimoIds = [...new Set(
        ids
          .map((id) => normalizeXiaomiModelId(id) || id)
          .filter((id) => isXiaomiMimoModelId(id) && !isLikelySpeechOnlyModelId(id)),
      )];
      const configured = normalizeXiaomiModelId(this.model) || this.model;
      const configuredAvailable = availableMimoIds.includes(configured) || availableChatIds.includes(configured);
      const reported = configuredAvailable ? configured : (availableMimoIds[0] || availableChatIds[0] || configured);
      const note = configuredAvailable
        ? `Configured model "${configured}" is available.`
        : (availableMimoIds.length
          ? `Configured model "${configured}" is not in MiMo /models. First available MiMo model: "${availableMimoIds[0]}".`
          : (availableChatIds.length
            ? `Configured model "${configured}" is not in /models. First available model: "${availableChatIds[0]}".`
            : (ids.length
              ? `Configured model "${configured}" could not be verified against MiMo /models (endpoint returned non-MiMo IDs).`
              : `Configured model "${configured}" could not be verified against /models.`)));

      return this.createTestResult(true, `Xiaomi MiMo API is reachable. ${note}`, {
        latencyMs: Date.now() - startedAt,
        model: reported,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

export class OllamaProvider extends BaseProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    const defaults = config.provider === 'ollama-cloud'
      ? DEFAULT_CAPABILITIES['ollama-cloud']
      : DEFAULT_CAPABILITIES.ollama;
    super(config.provider === 'ollama-cloud' ? 'Ollama Cloud' : 'Ollama', config, defaults);
    this.baseUrl = (config.baseUrl || 'http://localhost:11434')
      .replace(/\/+$/, '')
      .replace(/\/v1$/i, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || (config.provider === 'ollama-cloud' ? 'gpt-oss:120b-cloud' : 'llama3');
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = clamp(
      config.maxTokens ?? this.getCapabilities().recommendedMaxTokens,
      64,
      32_768,
    );
  }

  private get isCloud(): boolean {
    return this.baseUrl.includes('ollama.com');
  }

  private get timeoutMs(): number {
    return this.isCloud ? CLOUD_TIMEOUT : LOCAL_TIMEOUT;
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private get resolvedModel(): string {
    return this.isCloud ? this.model.replace(/-cloud$/, '') : this.model;
  }

  private buildBody(stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.resolvedModel,
      messages: [],
      stream,
    };

    if (this.isCloud) {
      body.temperature = this.temperature;
      body.num_predict = this.maxTokens;
      return body;
    }

    body.options = {
      temperature: this.temperature,
      num_predict: this.maxTokens,
      num_ctx: this.getCapabilities().defaultContextWindow,
    };
    return body;
  }

  private mapMessages(messages: LLMMessage[]) {
    return messages.map((message) => {
      const mapped: Record<string, unknown> = {
        role: message.role,
        content: message.content,
      };

      if (message.images?.length) {
        mapped.images = message.images.map((image) => image.replace(/^data:[^;]+;base64,/, ''));
      }

      return mapped;
    });
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const { controller, clear } = createAbortController(this.timeoutMs);
    try {
      const body = this.buildBody(false);
      body.messages = this.mapMessages(messages);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const content = normalizeTextContent(
        data.message ? (data.message as Record<string, unknown>).content : undefined,
      );
      const reasoningOnly = !content && hasReasoningContent(
        data.message ? (data.message as Record<string, unknown>).reasoning : undefined,
      );
      this.setLastGenerationMeta({
        model: typeof data.model === 'string' ? data.model : this.resolvedModel,
        finishReason: typeof data.done_reason === 'string' ? data.done_reason : undefined,
        yieldedAny: Boolean(content),
        reasoningOnly,
      });
      return {
        content,
        model: typeof data.model === 'string' ? data.model : this.resolvedModel,
        finishReason: typeof data.done_reason === 'string' ? data.done_reason : undefined,
      };
    } finally {
      clear();
    }
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const { controller, clear } = createAbortController(this.timeoutMs);
    const meta: LLMGenerationMeta = {
      model: this.resolvedModel,
      yieldedAny: false,
      reasoningOnly: false,
    };
    try {
      const body = this.buildBody(true);
      body.messages = this.mapMessages(messages);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ollama API error (${response.status}): ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const delta = normalizeTextContent(parsed.message?.content);
            if (!delta) {
              meta.reasoningOnly = meta.reasoningOnly || hasReasoningContent(parsed.message?.reasoning);
            }
            if (delta) {
              meta.yieldedAny = true;
              yield delta;
            }
            if (parsed.done) {
              meta.finishReason = typeof parsed.done_reason === 'string' ? parsed.done_reason : meta.finishReason;
              meta.model = typeof parsed.model === 'string' ? parsed.model : meta.model;
              return;
            }
          } catch {
            continue;
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        try {
          const parsed = JSON.parse(tail);
          const delta = normalizeTextContent(parsed.message?.content);
          if (!delta) {
            meta.reasoningOnly = meta.reasoningOnly || hasReasoningContent(parsed.message?.reasoning);
          }
          if (delta) {
            meta.yieldedAny = true;
            yield delta;
          }
          if (parsed.done) {
            meta.finishReason = typeof parsed.done_reason === 'string' ? parsed.done_reason : meta.finishReason;
            meta.model = typeof parsed.model === 'string' ? parsed.model : meta.model;
          }
        } catch {
          // Ignore incomplete trailing payloads.
        }
      }
    } finally {
      this.setLastGenerationMeta(meta);
      clear();
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json();
      const model = data.models?.[0]?.name || this.resolvedModel;
      return this.createTestResult(true, this.isCloud ? 'Ollama Cloud is reachable.' : 'Ollama is reachable.', {
        latencyMs: Date.now() - startedAt,
        model,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

export class LMStudioProvider extends BaseProvider {
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    super('LM Studio (Local)', config, DEFAULT_CAPABILITIES.lmstudio);
    this.baseUrl = (config.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '');
    this.model = config.model || '';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = clamp(
      config.maxTokens ?? this.getCapabilities().recommendedMaxTokens,
      64,
      32_768,
    );
  }

  private async resolveModel(): Promise<string> {
    if (this.model && this.model !== 'default') {
      return this.model;
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const data = await response.json();
        const firstLoaded = data.data?.[0]?.id;
        if (firstLoaded) {
          return firstLoaded;
        }
      }
    } catch {
      // Ignore and fall back to a generic placeholder.
    }

    return this.model || 'local-model';
  }

  private async buildBody(): Promise<Record<string, unknown>> {
    const model = await this.resolveModel();
    return {
      model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const { controller, clear } = createAbortController(LOCAL_TIMEOUT);
    try {
      const body = await this.buildBody();
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          messages: buildOpenAICompatibleMessages(messages, false),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`LM Studio error (${response.status}): ${errorText || 'Check LM Studio is running and a model is loaded.'}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const parsed = buildOpenAIStyleResponse(data, String(body.model));
      this.setLastGenerationMeta({
        model: parsed.model,
        finishReason: parsed.finishReason,
        reasoningOnly: parsed.reasoningOnly,
        yieldedAny: Boolean(parsed.content),
      });
      return {
        content: parsed.content,
        model: parsed.model,
        finishReason: parsed.finishReason,
      };
    } finally {
      clear();
    }
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const body = await this.buildBody();
    const meta: LLMGenerationMeta = {
      model: String(body.model),
      yieldedAny: false,
      reasoningOnly: false,
    };
    try {
      yield* streamOpenAICompatible(
        `${this.baseUrl}/chat/completions`,
        {
          ...body,
          messages: buildOpenAICompatibleMessages(messages, false),
        },
        {},
        LOCAL_TIMEOUT,
        this.getCapabilities().recommendedRetryAttempts,
        meta,
      );
    } finally {
      this.setLastGenerationMeta(meta);
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        throw new Error(`LM Studio error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json();
      const model = data.data?.[0]?.id;
      if (!model) {
        throw new Error('LM Studio is running but no model is loaded. Load a model in LM Studio first.');
      }

      return this.createTestResult(true, 'LM Studio is reachable and has a loaded model.', {
        latencyMs: Date.now() - startedAt,
        model,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

export class CustomProvider extends BaseProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    super('Custom Provider', config, DEFAULT_CAPABILITIES.custom);
    this.baseUrl = (config.baseUrl || 'http://localhost:8080').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'default';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = clamp(
      config.maxTokens ?? this.getCapabilities().recommendedMaxTokens,
      64,
      32_768,
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildBody(): Record<string, unknown> {
    return {
      model: this.model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const { controller, clear } = createAbortController(DEFAULT_TIMEOUT);
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.buildHeaders() },
        body: JSON.stringify({
          ...this.buildBody(),
          messages: buildOpenAICompatibleMessages(messages, false),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Custom API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const parsed = buildOpenAIStyleResponse(data, this.model);
      this.setLastGenerationMeta({
        model: parsed.model,
        finishReason: parsed.finishReason,
        reasoningOnly: parsed.reasoningOnly,
        yieldedAny: Boolean(parsed.content),
      });
      return {
        content: parsed.content,
        model: parsed.model,
        finishReason: parsed.finishReason,
      };
    } finally {
      clear();
    }
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const meta: LLMGenerationMeta = {
      model: this.model,
      yieldedAny: false,
      reasoningOnly: false,
    };
    try {
      yield* streamOpenAICompatible(
        `${this.baseUrl}/v1/chat/completions`,
        {
          ...this.buildBody(),
          messages: buildOpenAICompatibleMessages(messages, false),
        },
        this.buildHeaders(),
        DEFAULT_TIMEOUT,
        this.getCapabilities().recommendedRetryAttempts,
        meta,
      );
    } finally {
      this.setLastGenerationMeta(meta);
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Custom API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json();
      const model = data.data?.[0]?.id || this.model;
      return this.createTestResult(true, 'Custom provider is reachable.', {
        latencyMs: Date.now() - startedAt,
        model,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

// ─────────────────── OpenRouter Provider ──────────────────────────────────────

export class OpenRouterProvider extends BaseProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    super('OpenRouter', config, DEFAULT_CAPABILITIES.openrouter);
    this.apiKey = config.apiKey || '';
    this.baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.model = config.model || 'openai/gpt-4.1-mini';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = clamp(
      config.maxTokens ?? this.getCapabilities().recommendedMaxTokens,
      64,
      200_000,
    );
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://nova.local',
      'X-Title': 'Nova AI Agent',
    };
  }

  private buildBody(): Record<string, unknown> {
    return {
      model: this.model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const { controller, clear } = createAbortController(CLOUD_TIMEOUT);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.buildHeaders() },
        body: JSON.stringify({
          ...this.buildBody(),
          messages: buildOpenAICompatibleMessages(messages, this.getCapabilities().supportsImages),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const parsed = buildOpenAIStyleResponse(data, this.model);
      this.setLastGenerationMeta({
        model: parsed.model,
        finishReason: parsed.finishReason,
        reasoningOnly: parsed.reasoningOnly,
        yieldedAny: Boolean(parsed.content),
      });
      return {
        content: parsed.content,
        model: parsed.model,
        finishReason: parsed.finishReason,
      };
    } finally {
      clear();
    }
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const meta: LLMGenerationMeta = { model: this.model, yieldedAny: false, reasoningOnly: false };
    try {
      yield* streamOpenAICompatible(
        `${this.baseUrl}/chat/completions`,
        {
          ...this.buildBody(),
          messages: buildOpenAICompatibleMessages(messages, this.getCapabilities().supportsImages),
        },
        this.buildHeaders(),
        CLOUD_TIMEOUT,
        this.getCapabilities().recommendedRetryAttempts,
        meta,
      );
    } finally {
      this.setLastGenerationMeta(meta);
    }
  }

  async testConnection(): Promise<LLMTestResult> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error (${response.status}): ${await response.text()}`);
      }

      const data = await response.json();
      const models = data?.data;
      const modelCount = Array.isArray(models) ? models.length : 0;
      return this.createTestResult(true, `OpenRouter connected — ${modelCount} models available.`, {
        latencyMs: Date.now() - startedAt,
        model: this.model,
      });
    } catch (error) {
      const classified = classifyLLMError(error);
      return this.createTestResult(false, classified.message, {
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

