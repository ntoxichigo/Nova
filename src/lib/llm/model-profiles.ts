import type { LLMConfig } from './types';

export interface ModelStabilityProfile {
  id: string;
  label: string;
  reliability: 'stable' | 'cautious' | 'experimental';
  safeMaxTokens: number;
  safeContextWindow?: number;
  forceQualityMode?: NonNullable<LLMConfig['qualityMode']>;
  reasoningOnlyRisk: boolean;
  notes: string;
}

interface ModelProfileRule extends ModelStabilityProfile {
  providers: Array<LLMConfig['provider'] | '*'>;
  pattern: RegExp;
}

const MODEL_PROFILE_RULES: ModelProfileRule[] = [
  {
    id: 'gemma-local-stable',
    label: 'Gemma local stable',
    providers: ['lmstudio', 'ollama', 'custom'],
    pattern: /\bgemma(?:[-/ ]4)?\b/i,
    reliability: 'stable',
    safeMaxTokens: 16384,
    safeContextWindow: 131072,
    forceQualityMode: undefined,
    reasoningOnlyRisk: false,
    notes: 'Best local default for long, reliable answers and tool-heavy frontend tasks.',
  },
  {
    id: 'qwen-reasoning-cautious',
    label: 'Qwen reasoning cautious',
    providers: ['lmstudio', 'ollama', 'custom'],
    pattern: /\bqwen(?:2|2\.5|3|3\.5)?\b/i,
    reliability: 'cautious',
    safeMaxTokens: 16384,
    safeContextWindow: 131072,
    forceQualityMode: undefined,
    reasoningOnlyRisk: true,
    notes: 'Often strong, but some local builds emit reasoning-only or malformed tool output under high token pressure.',
  },
  {
    id: 'gpt-oss-cautious',
    label: 'GPT-OSS cautious',
    providers: ['lmstudio', 'ollama', 'custom'],
    pattern: /\bgpt-oss\b/i,
    reliability: 'cautious',
    safeMaxTokens: 16384,
    safeContextWindow: 131072,
    forceQualityMode: undefined,
    reasoningOnlyRisk: true,
    notes: 'Good capability, but local adapters can truncate or stream empty visible content.',
  },
  {
    id: 'crow-cautious',
    label: 'Crow distill cautious',
    providers: ['lmstudio', 'ollama', 'custom'],
    pattern: /\bcrow\b/i,
    reliability: 'cautious',
    safeMaxTokens: 16384,
    safeContextWindow: 131072,
    forceQualityMode: undefined,
    reasoningOnlyRisk: true,
    notes: 'Distilled local variants can be fast but become unreliable with large completions.',
  },
  {
    id: 'nemotron-cautious',
    label: 'Nemotron cautious',
    providers: ['lmstudio', 'ollama', 'custom'],
    pattern: /\bnemotron\b/i,
    reliability: 'cautious',
    safeMaxTokens: 16384,
    safeContextWindow: 131072,
    forceQualityMode: undefined,
    reasoningOnlyRisk: true,
    notes: 'Useful for light tasks, but high-output chats are more crash-prone locally.',
  },
];

const DEFAULT_LOCAL_PROFILE: ModelStabilityProfile = {
  id: 'local-generic-cautious',
  label: 'Generic local model',
  reliability: 'cautious',
  safeMaxTokens: 16384,
  safeContextWindow: 131072,
  forceQualityMode: undefined,
  reasoningOnlyRisk: false,
  notes: 'Local model without a known stability profile.',
};

const DEFAULT_REMOTE_PROFILE: ModelStabilityProfile = {
  id: 'remote-generic',
  label: 'Generic remote model',
  reliability: 'stable',
  safeMaxTokens: 8192,
  safeContextWindow: 131072,
  forceQualityMode: undefined,
  reasoningOnlyRisk: false,
  notes: 'Remote providers usually tolerate higher output budgets, but still benefit from sensible limits.',
};

export function resolveModelStabilityProfile(
  provider: LLMConfig['provider'],
  model?: string,
  baseUrl?: string,
): ModelStabilityProfile {
  if (model) {
    const matched = MODEL_PROFILE_RULES.find((rule) => {
      const providerMatch = rule.providers.includes('*') || rule.providers.includes(provider);
      return providerMatch && rule.pattern.test(model);
    });
    if (matched) {
      return matched;
    }
  }

  const customLooksLocal = provider === 'custom' && Boolean(baseUrl && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(baseUrl));

  return provider === 'lmstudio' || provider === 'ollama' || customLooksLocal
    ? DEFAULT_LOCAL_PROFILE
    : DEFAULT_REMOTE_PROFILE;  // openrouter, openai, ollama-cloud, z-ai, and non-local custom
}

export function applyModelStabilityProfile(config: LLMConfig): {
  config: LLMConfig;
  profile: ModelStabilityProfile;
} {
  const profile = resolveModelStabilityProfile(config.provider, config.model, config.baseUrl);
  const next: LLMConfig = { ...config };

  // Use user-configured values when present; only fall back to profile defaults
  if (!next.maxTokens) {
    next.maxTokens = profile.safeMaxTokens;
  }

  if (!next.contextWindow) {
    next.contextWindow = profile.safeContextWindow;
  }

  if (profile.forceQualityMode && !config.qualityMode) {
    next.qualityMode = profile.forceQualityMode;
  }

  return { config: next, profile };
}
