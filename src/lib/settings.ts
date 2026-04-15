import { db } from '@/lib/db';
import type { LLMConfig } from '@/lib/llm/types';

export type ChatPowerMode = 'safe' | 'builder' | 'power';
export type ChatPermissionMode = 'always_ask' | 'ask_risky' | 'autopilot';
export type ChatSpeedMode = 'simple' | 'balanced' | 'deep';
export type OperatingProfile = 'complete' | 'studio' | 'guarded' | 'autonomous';
export type AutomationMode = 'manual' | 'assisted' | 'always_on';

const LEGACY_SETTING_KEYS: Record<string, string> = {
  // Back-compat for older installs.
  nova_operating_profile: 'ntox_operating_profile',
  nova_automation_mode: 'ntox_automation_mode',
};

const LLM_CONFIG_KEYS = [
  'llm_provider',
  'llm_api_key',
  'llm_base_url',
  'llm_model',
  'llm_temperature',
  'llm_max_tokens',
  'llm_context_window',
  'llm_history_budget',
  'llm_compression_threshold',
  'llm_retry_attempts',
  'llm_quality_mode',
];

export async function getSetting(key: string): Promise<string | null> {
  const setting = await db.settings.findUnique({ where: { key } });
  if (setting?.value != null) return setting.value;

  const legacyKey = LEGACY_SETTING_KEYS[key];
  if (!legacyKey) return null;
  const legacy = await db.settings.findUnique({ where: { key: legacyKey } });
  return legacy?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await db.settings.findMany();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return result;
}

export async function setAllSettings(settings: Record<string, string>): Promise<void> {
  await db.$transaction(
    Object.entries(settings).map(([key, value]) =>
      db.settings.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const [
    provider,
    apiKey,
    baseUrl,
    model,
    temperature,
    maxTokens,
    contextWindow,
    historyBudget,
    compressionThreshold,
    retryAttempts,
    qualityMode,
  ] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_base_url'),
    getSetting('llm_model'),
    getSetting('llm_temperature'),
    getSetting('llm_max_tokens'),
    getSetting('llm_context_window'),
    getSetting('llm_history_budget'),
    getSetting('llm_compression_threshold'),
    getSetting('llm_retry_attempts'),
    getSetting('llm_quality_mode'),
  ]);

  return {
    provider: (provider as LLMConfig['provider']) || 'z-ai',
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    temperature: temperature ? parseFloat(temperature) : undefined,
    maxTokens: maxTokens ? parseInt(maxTokens, 10) : undefined,
    contextWindow: contextWindow ? parseInt(contextWindow, 10) : undefined,
    historyBudget: historyBudget ? parseInt(historyBudget, 10) : undefined,
    compressionThreshold: compressionThreshold ? parseInt(compressionThreshold, 10) : undefined,
    retryAttempts: retryAttempts ? parseInt(retryAttempts, 10) : undefined,
    qualityMode: (qualityMode as LLMConfig['qualityMode']) || undefined,
  };
}

export async function setLLMConfig(config: LLMConfig): Promise<void> {
  const settingsMap: Record<string, string> = {};

  if (config.provider) settingsMap['llm_provider'] = config.provider;
  if (config.apiKey) settingsMap['llm_api_key'] = config.apiKey;
  if (config.baseUrl) settingsMap['llm_base_url'] = config.baseUrl;
  if (config.model) settingsMap['llm_model'] = config.model;
  if (config.temperature !== undefined) settingsMap['llm_temperature'] = String(config.temperature);
  if (config.maxTokens !== undefined) settingsMap['llm_max_tokens'] = String(config.maxTokens);
  if (config.contextWindow !== undefined) settingsMap['llm_context_window'] = String(config.contextWindow);
  if (config.historyBudget !== undefined) settingsMap['llm_history_budget'] = String(config.historyBudget);
  if (config.compressionThreshold !== undefined) settingsMap['llm_compression_threshold'] = String(config.compressionThreshold);
  if (config.retryAttempts !== undefined) settingsMap['llm_retry_attempts'] = String(config.retryAttempts);
  if (config.qualityMode) settingsMap['llm_quality_mode'] = config.qualityMode;

  await setAllSettings(settingsMap);
}

export async function getAgentName(): Promise<string> {
  return (await getSetting('agent_name')) || 'Nova';
}

export async function setAgentName(name: string): Promise<void> {
  await setSetting('agent_name', name);
}

export async function getAgentPersonality(): Promise<string | null> {
  return getSetting('agent_personality');
}

export async function setAgentPersonality(personality: string): Promise<void> {
  await setSetting('agent_personality', personality);
}

export async function getChatPowerMode(): Promise<ChatPowerMode> {
  const mode = (await getSetting('chat_power_mode')) || 'builder';
  if (mode === 'safe' || mode === 'builder' || mode === 'power') {
    return mode;
  }
  return 'builder';
}

export async function getChatPermissionMode(): Promise<ChatPermissionMode> {
  const mode = (await getSetting('chat_permission_mode')) || 'always_ask';
  if (mode === 'always_ask' || mode === 'ask_risky' || mode === 'autopilot') {
    return mode;
  }
  return 'always_ask';
}

export async function getChatMcpAllowlist(): Promise<string[]> {
  const raw = (await getSetting('chat_mcp_allowlist')) || '';
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function getChatSpeedMode(): Promise<ChatSpeedMode> {
  const mode = (await getSetting('chat_speed_mode')) || 'balanced';
  if (mode === 'simple' || mode === 'balanced' || mode === 'deep') {
    return mode;
  }
  return 'balanced';
}

export async function getOperatingProfile(): Promise<OperatingProfile> {
  const value = (await getSetting('nova_operating_profile')) || 'complete';
  if (value === 'complete' || value === 'studio' || value === 'guarded' || value === 'autonomous') {
    return value;
  }
  return 'complete';
}

export async function getAutomationMode(): Promise<AutomationMode> {
  const value = (await getSetting('nova_automation_mode')) || 'assisted';
  if (value === 'manual' || value === 'assisted' || value === 'always_on') {
    return value;
  }
  return 'assisted';
}
