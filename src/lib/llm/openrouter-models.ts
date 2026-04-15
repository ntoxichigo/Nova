/**
 * OpenRouter model fetching & normalization service.
 * Always fetches fresh from https://openrouter.ai/api/v1/models — no caching.
 */

export type OpenRouterErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  maxCompletionTokens: number | null;
  pricing: {
    prompt: number; // per-token cost (raw)
    completion: number;
  };
  inputModalities: string[]; // ['text'], ['text','image'], etc.
  description: string;
  deprecated: boolean;
  expirationDate?: string; // formatted for display
  isFree: boolean;
}

export interface OpenRouterModelsResponse {
  models: OpenRouterModel[];
  error?: {
    code: OpenRouterErrorCode;
    message: string;
    retryAfterSeconds?: number;
  };
  meta: {
    fetchedAt: string;
    totalCount: number;
    partialList: boolean;
  };
}

/** Raw shape returned by the OpenRouter /api/v1/models endpoint */
interface RawOpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number | null;
  };
  expiration_date?: number | null; // Unix timestamp (seconds)
}

const PROVIDER_NAME_MAP: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'meta-llama': 'Meta',
  meta: 'Meta',
  mistralai: 'Mistral',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  nvidia: 'NVIDIA',
  'x-ai': 'xAI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  amazon: 'Amazon',
  'z-ai': 'Z.ai',
  microsoft: 'Microsoft',
  nousresearch: 'Nous Research',
  baidu: 'Baidu',
  minimax: 'MiniMax',
  moonshotai: 'Moonshot',
  'bytedance-seed': 'ByteDance',
  bytedance: 'ByteDance',
  'ibm-granite': 'IBM',
  'arcee-ai': 'Arcee AI',
  inception: 'Inception',
  allenai: 'AllenAI',
  tngtech: 'TNG Tech',
  morph: 'Morph',
  switchpoint: 'Switchpoint',
  thedrummer: 'TheDrummer',
  'prime-intellect': 'Prime Intellect',
  openrouter: 'OpenRouter',
  'xiaomi': 'Xiaomi',
  'stepfun': 'StepFun',
  'liquid': 'Liquid AI',
  'essentialai': 'EssentialAI',
  'aion-labs': 'Aion Labs',
  'sao10k': 'Sao10K',
  'alfredpros': 'AlfredPros',
  'eleutherai': 'EleutherAI',
  'inflection': 'Inflection',
  'anthracite-org': 'Anthracite',
  'mancer': 'Mancer',
  'undi95': 'Undi95',
  'alpindale': 'Alpindale',
};

export function parseProvider(modelId: string): string {
  const vendor = modelId.split('/')[0] ?? modelId;
  return (
    PROVIDER_NAME_MAP[vendor.toLowerCase()] ??
    vendor.charAt(0).toUpperCase() + vendor.slice(1)
  );
}

function parseInputModalities(
  rawModality: string,
  rawInput?: string[],
): string[] {
  if (rawInput && rawInput.length > 0) return rawInput;
  const inputPart = (rawModality.split('->')[0] ?? rawModality).trim();
  return inputPart.split('+');
}

export async function fetchOpenRouterModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpenRouterModelsResponse> {
  const fetchedAt = new Date().toISOString();

  try {
    const headers: Record<string, string> = {
      'HTTP-Referer': 'https://nova.local',
      'X-Title': 'Nova AI',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      signal,
    });

    if (response.status === 401) {
      return {
        models: [],
        error: {
          code: 'AUTH_FAILED',
          message:
            'API key is invalid or missing. Check your OpenRouter API key in Settings.',
        },
        meta: { fetchedAt, totalCount: 0, partialList: false },
      };
    }

    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get('retry-after') ?? '60',
        10,
      );
      return {
        models: [],
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limited by OpenRouter. Try again in ${retryAfter}s.`,
          retryAfterSeconds: retryAfter,
        },
        meta: { fetchedAt, totalCount: 0, partialList: false },
      };
    }

    if (!response.ok) {
      return {
        models: [],
        error: {
          code: 'SERVER_ERROR',
          message: `OpenRouter returned HTTP ${response.status}. Try again later.`,
        },
        meta: { fetchedAt, totalCount: 0, partialList: false },
      };
    }

    const data = (await response.json()) as { data: RawOpenRouterModel[] };
    const today = Date.now();

    const models: OpenRouterModel[] = (data.data ?? [])
      .filter((m) => m.id && m.name)
      .map((m) => {
        const promptCost = parseFloat(m.pricing?.prompt ?? '0');
        const completionCost = parseFloat(m.pricing?.completion ?? '0');
        const expiresAtMs = m.expiration_date
          ? m.expiration_date * 1000
          : null;

        return {
          id: m.id,
          name: m.name,
          provider: parseProvider(m.id),
          contextLength:
            m.top_provider?.context_length ?? m.context_length ?? 0,
          maxCompletionTokens:
            m.top_provider?.max_completion_tokens ?? null,
          pricing: { prompt: promptCost, completion: completionCost },
          inputModalities: parseInputModalities(
            m.architecture?.modality ?? 'text->text',
            m.architecture?.input_modalities,
          ),
          description: (m.description ?? '').slice(0, 220),
          deprecated: expiresAtMs !== null && expiresAtMs < today,
          expirationDate: expiresAtMs
            ? new Date(expiresAtMs).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : undefined,
          isFree:
            promptCost === 0 &&
            completionCost === 0 &&
            !m.pricing?.prompt?.startsWith('-'), // -1 means "contact sales"
        };
      })
      // Non-deprecated first, then alphabetically within each group
      .sort((a, b) => {
        if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    return {
      models,
      meta: { fetchedAt, totalCount: models.length, partialList: false },
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        models: [],
        error: {
          code: 'TIMEOUT',
          message:
            'Request timed out. OpenRouter may be slow — try again.',
        },
        meta: { fetchedAt, totalCount: 0, partialList: true },
      };
    }
    return {
      models: [],
      error: {
        code: 'NETWORK_ERROR',
        message:
          'Network error fetching models. Check your connection.',
      },
      meta: { fetchedAt, totalCount: 0, partialList: false },
    };
  }
}

/** Format per-token cost as cost-per-1M-tokens display string */
export function formatCostPer1M(perToken: number): string {
  if (perToken < 0) return 'Contact sales';
  if (perToken === 0) return 'Free';
  const per1M = perToken * 1_000_000;
  if (per1M < 0.01) return `$${(per1M * 1000).toFixed(2)}/B`;
  return `$${per1M.toFixed(per1M < 1 ? 3 : 2)}`;
}

/** Format token count as "121k", "1M", etc. */
export function formatContextLength(tokens: number): string {
  if (!tokens || tokens === 0) return '?k';
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}
