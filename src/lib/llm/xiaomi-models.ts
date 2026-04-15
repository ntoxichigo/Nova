export interface XiaomiModelInfo {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  maxCompletionTokens: number;
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  category: 'chat' | 'multimodal' | 'tts';
}

export const XIAOMI_MODELS: XiaomiModelInfo[] = [
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro',
    description: 'Flagship long-context reasoning and coding model with up to 1M context.',
    contextLength: 1_000_000,
    maxCompletionTokens: 131_072,
    supportsVision: false,
    supportsAudio: false,
    supportsVideo: false,
    category: 'chat',
  },
  {
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash',
    description: 'Fast coding and agent model with strong tool-calling accuracy.',
    contextLength: 262_144,
    maxCompletionTokens: 65_536,
    supportsVision: false,
    supportsAudio: false,
    supportsVideo: false,
    category: 'chat',
  },
  {
    id: 'mimo-v2-omni',
    name: 'MiMo V2 Omni',
    description: 'Multimodal MiMo model for text, image, audio, and video input.',
    contextLength: 262_144,
    maxCompletionTokens: 32_768,
    supportsVision: true,
    supportsAudio: true,
    supportsVideo: true,
    category: 'multimodal',
  },
  {
    id: 'mimo-v2-tts',
    name: 'MiMo V2 TTS',
    description: 'Speech generation model with voice and style control.',
    contextLength: 32_768,
    maxCompletionTokens: 8_192,
    supportsVision: false,
    supportsAudio: true,
    supportsVideo: false,
    category: 'tts',
  },
];

export function findXiaomiModel(modelId?: string): XiaomiModelInfo | undefined {
  if (!modelId) return undefined;
  return XIAOMI_MODELS.find((model) => model.id === modelId);
}

export function isXiaomiMimoModelId(modelId: string | undefined | null): boolean {
  const raw = String(modelId || '').trim();
  if (!raw) return false;
  if (normalizeXiaomiModelId(raw)) return true;
  return /^mimo-v\d+/i.test(raw);
}

function normalizeToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_:.]/g, '');
}

function stripWrappingNoise(input: string): string {
  return input
    .trim()
    .replace(/^[`"'“”‘’]+/, '')
    .replace(/[`"'“”‘’]+$/, '')
    .trim();
}

/**
 * Accept either the canonical Xiaomi model id (e.g. "mimo-v2-pro") or the display name
 * (e.g. "MiMo V2 Pro") and return a canonical id when recognized.
 */
export function normalizeXiaomiModelId(model: string | undefined | null): string | undefined {
  const raw = stripWrappingNoise(String(model || ''));
  if (!raw) return undefined;

  // Exact id match first
  const exact = XIAOMI_MODELS.find((m) => m.id === raw);
  if (exact) return exact.id;

  const needle = normalizeToken(raw);
  const byId = XIAOMI_MODELS.find((m) => normalizeToken(m.id) === needle);
  if (byId) return byId.id;

  const byName = XIAOMI_MODELS.find((m) => normalizeToken(m.name) === needle);
  if (byName) return byName.id;

  return undefined;
}

/**
 * Xiaomi MiMo supports an OpenAI-compatible API. The base URL should include "/v1" for
 * routes like "/chat/completions" and "/models". Normalize common Xiaomi hosts.
 */
export function normalizeXiaomiBaseUrl(baseUrl: string | undefined | null): string {
  const raw = stripWrappingNoise(String(baseUrl || '')).replace(/\/+$/, '');
  if (!raw) return 'https://api.xiaomimimo.com/v1';

  try {
    const url = new URL(raw);
    const host = url.host.toLowerCase();

    // Xiaomi OpenAI-compatible endpoints expect /v1 prefix.
    const needsV1 = host.endsWith('xiaomimimo.com') && !url.pathname.toLowerCase().endsWith('/v1');
    if (needsV1) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1`;
      return url.toString().replace(/\/+$/, '');
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    // Fall through for non-URL strings (should be rare).
  }

  return raw;
}
