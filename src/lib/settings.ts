import { db } from '@/lib/db';
import type { LLMConfig } from '@/lib/llm/types';

const LLM_CONFIG_KEYS = ['llm_provider', 'llm_api_key', 'llm_base_url', 'llm_model', 'llm_temperature', 'llm_max_tokens'];

export async function getSetting(key: string): Promise<string | null> {
  const setting = await db.settings.findUnique({ where: { key } });
  return setting?.value ?? null;
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
  ] = await Promise.all([
    getSetting('llm_provider'),
    getSetting('llm_api_key'),
    getSetting('llm_base_url'),
    getSetting('llm_model'),
    getSetting('llm_temperature'),
    getSetting('llm_max_tokens'),
  ]);

  return {
    provider: (provider as LLMConfig['provider']) || 'z-ai',
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    temperature: temperature ? parseFloat(temperature) : undefined,
    maxTokens: maxTokens ? parseInt(maxTokens, 10) : undefined,
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
