import type { LLMConfig } from '@/lib/llm/types';

export const MASKED_SECRET_VALUE = '********';

export const ALLOWED_SETTING_KEYS = [
  'agent_name',
  'agent_autonomy_profile',
  'agent_personality',
  'chat_power_mode',
  'chat_permission_mode',
  'chat_speed_mode',
  'chat_mcp_allowlist',
  'chat_auto_approve_tools',
  'nova_operating_profile',
  'nova_automation_mode',
  'llm_api_key',
  'llm_base_url',
  'llm_compression_threshold',
  'llm_context_window',
  'llm_coder_model',
  'llm_history_budget',
  'llm_max_tokens',
  'llm_model',
  'llm_planner_model',
  'llm_provider',
  'llm_quality_mode',
  'llm_research_model',
  'llm_fast_model',
  'llm_strong_model',
  'llm_audit_model',
  'llm_retry_attempts',
  'llm_router_enabled',
  'llm_scoped_agents_enabled',
  'llm_temperature',
  'llm_token_telemetry_enabled',
  'llm_verifier_model',
  'telegram_bot_token',
  'telegram_default_chat_id',
  'telegram_public_url',
  'telegram_webhook_secret',
  'workspace_root',
] as const;

export type AllowedSettingKey = (typeof ALLOWED_SETTING_KEYS)[number];

const LEGACY_KEY_ALIASES: Record<string, AllowedSettingKey> = {
  // Back-compat for older installs (accept legacy keys on PUT and map them forward).
  ntox_operating_profile: 'nova_operating_profile',
  ntox_automation_mode: 'nova_automation_mode',
};

const allowedProviders = new Set<LLMConfig['provider']>([
  'custom',
  'lmstudio',
  'ollama',
  'ollama-cloud',
  'openai',
  'openrouter',
  'xiaomi',
  'z-ai',
]);

const allowedQualityModes = new Set<NonNullable<LLMConfig['qualityMode']>>([
  'balanced',
  'high-context',
  'high-quality',
  'local-safe',
]);

const allowedAutonomyProfiles = new Set([
  'safe',
  'builder',
  'hands-free',
  'reviewer',
  'research',
]);

const allowedChatPowerModes = new Set([
  'safe',
  'builder',
  'power',
]);

const allowedChatPermissionModes = new Set([
  'always_ask',
  'ask_risky',
  'autopilot',
]);

const allowedChatSpeedModes = new Set([
  'simple',
  'balanced',
  'deep',
]);

const allowedOperatingProfiles = new Set([
  'complete',
  'studio',
  'guarded',
  'autonomous',
]);

const allowedAutomationModes = new Set([
  'manual',
  'assisted',
  'always_on',
]);

const secretKeys = new Set<AllowedSettingKey>([
  'llm_api_key',
  'telegram_bot_token',
  'telegram_webhook_secret',
]);

function assertStringLike(value: unknown, key: AllowedSettingKey): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`Setting "${key}" must be a string, number, or boolean`);
}

function validateUrl(value: string, key: AllowedSettingKey): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Setting "${key}" must use http:// or https://`);
  }
  return trimmed.replace(/\/+$/, '');
}

function validateInteger(value: string, key: AllowedSettingKey, min: number, max: number): string {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Setting "${key}" must be an integer between ${min} and ${max}`);
  }
  return String(parsed);
}

function validateFloat(value: string, key: AllowedSettingKey, min: number, max: number): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Setting "${key}" must be a number between ${min} and ${max}`);
  }
  return String(parsed);
}

function normalizeSettingValue(key: AllowedSettingKey, rawValue: unknown): string | null {
  const value = assertStringLike(rawValue, key).trim();

  if (secretKeys.has(key) && value === MASKED_SECRET_VALUE) {
    return null;
  }

  switch (key) {
    case 'llm_provider':
      if (!allowedProviders.has(value as LLMConfig['provider'])) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedProviders].join(', ')}`);
      }
      return value;
    case 'llm_base_url':
    case 'telegram_public_url':
      return validateUrl(value, key);
    case 'llm_temperature':
      return validateFloat(value, key, 0, 2);
    case 'llm_context_window':
      return validateInteger(value, key, 2048, 1000000);
    case 'llm_history_budget':
      return validateInteger(value, key, 4, 120);
    case 'llm_compression_threshold':
      return validateInteger(value, key, 6, 96);
    case 'llm_max_tokens':
      return validateInteger(value, key, 64, 200000);
    case 'llm_retry_attempts':
      return validateInteger(value, key, 0, 3);
    case 'llm_quality_mode':
      if (!allowedQualityModes.has(value as NonNullable<LLMConfig['qualityMode']>)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedQualityModes].join(', ')}`);
      }
      return value;
    case 'agent_name':
      if (!value || value.length > 80) {
        throw new Error('Setting "agent_name" must be between 1 and 80 characters');
      }
      return value;
    case 'agent_autonomy_profile':
      if (!allowedAutonomyProfiles.has(value)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedAutonomyProfiles].join(', ')}`);
      }
      return value;
    case 'chat_power_mode':
      if (!allowedChatPowerModes.has(value)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedChatPowerModes].join(', ')}`);
      }
      return value;
    case 'chat_permission_mode':
      if (!allowedChatPermissionModes.has(value)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedChatPermissionModes].join(', ')}`);
      }
      return value;
    case 'chat_speed_mode':
      if (!allowedChatSpeedModes.has(value)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedChatSpeedModes].join(', ')}`);
      }
      return value;
    case 'nova_operating_profile':
      if (!allowedOperatingProfiles.has(value)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedOperatingProfiles].join(', ')}`);
      }
      return value;
    case 'nova_automation_mode':
      if (!allowedAutomationModes.has(value)) {
        throw new Error(`Setting "${key}" must be one of ${[...allowedAutomationModes].join(', ')}`);
      }
      return value;
    case 'chat_mcp_allowlist':
      if (value.length > 20000) {
        throw new Error('Setting "chat_mcp_allowlist" must be 20000 characters or fewer');
      }
      return value;
    case 'chat_auto_approve_tools':
    case 'llm_router_enabled':
    case 'llm_scoped_agents_enabled':
    case 'llm_token_telemetry_enabled':
      if (value !== 'true' && value !== 'false') {
        throw new Error(`Setting "${key}" must be true or false`);
      }
      return value;
    case 'agent_personality':
      if (value.length > 4000) {
        throw new Error('Setting "agent_personality" must be 4000 characters or fewer');
      }
      return value;
    case 'workspace_root':
      return value;
    case 'telegram_default_chat_id':
      if (value && !/^-?\d+$/.test(value)) {
        throw new Error('Setting "telegram_default_chat_id" must be a numeric chat id');
      }
      return value;
    case 'telegram_webhook_secret':
      if (value && value.length < 16) {
        throw new Error('Setting "telegram_webhook_secret" must be at least 16 characters');
      }
      return value;
    case 'llm_api_key':
    case 'telegram_bot_token':
      if (!value) return null; // never overwrite with empty - omit to preserve existing key
      if (value.length > 1000) {
        throw new Error(`Setting "${key}" is too long`);
      }
      return value;
    case 'llm_model':
    case 'llm_fast_model':
    case 'llm_strong_model':
    case 'llm_audit_model':
    case 'llm_planner_model':
    case 'llm_coder_model':
    case 'llm_verifier_model':
    case 'llm_research_model':
      if (value.length > 1000) {
        throw new Error(`Setting "${key}" is too long`);
      }
      return value;
    default:
      return value;
  }
}

export function sanitizeSettingPayload(payload: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const key = (ALLOWED_SETTING_KEYS as readonly string[]).includes(rawKey)
      ? (rawKey as AllowedSettingKey)
      : LEGACY_KEY_ALIASES[rawKey];

    if (!key) {
      throw new Error(`Unknown setting "${rawKey}"`);
    }
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const normalized = normalizeSettingValue(key, rawValue);
    if (normalized !== null) {
      sanitized[key] = normalized;
    }
  }

  return sanitized;
}

export function maskSensitiveSettings(settings: Record<string, string>): Record<string, string> {
  const safe = { ...settings };
  for (const key of secretKeys) {
    if (safe[key]) {
      safe[key] = MASKED_SECRET_VALUE;
    }
  }
  return safe;
}
