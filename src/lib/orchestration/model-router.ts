import { createLLMProvider } from '@/lib/llm';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import type { LLMConfig } from '@/lib/llm/types';
import type { OrchestrationSettings, RoutedStage, SpecialistStage, TaskMode } from './types';

function providerDefaultFastModel(config: LLMConfig): string {
  if (config.provider === 'xiaomi') return 'mimo-v2-flash';
  if (config.provider === 'openrouter') return 'google/gemini-2.5-flash';
  if (config.provider === 'openai') return 'gpt-4.1-mini';
  return config.model || '';
}

function providerDefaultStrongModel(config: LLMConfig): string {
  if (config.provider === 'xiaomi') return 'mimo-v2-pro';
  if (config.provider === 'openrouter') return 'qwen/qwen3-coder';
  if (config.provider === 'openai') return 'gpt-4.1';
  return config.model || '';
}

function providerDefaultAuditModel(config: LLMConfig): string {
  if (config.provider === 'xiaomi') return 'mimo-v2-pro';
  if (config.provider === 'openrouter') return 'deepseek/deepseek-r1-0528';
  if (config.provider === 'openai') return 'o4-mini';
  return config.model || '';
}

function overrideForStage(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  stage: SpecialistStage,
  taskMode: TaskMode,
): string {
  if (!settings.routerEnabled) return '';

  switch (stage) {
    case 'planner':
      return settings.plannerModel || settings.auditModel || providerDefaultAuditModel(baseConfig);
    case 'coder':
      return settings.coderModel || settings.strongModel || providerDefaultStrongModel(baseConfig);
    case 'verifier':
      return settings.verifierModel || settings.auditModel || providerDefaultAuditModel(baseConfig);
    case 'researcher':
      return settings.researchModel || settings.auditModel || providerDefaultAuditModel(baseConfig);
    case 'main':
      if (taskMode === 'chat') {
        return settings.fastModel || providerDefaultFastModel(baseConfig);
      }
      if (taskMode === 'coding' || taskMode === 'build' || taskMode === 'debug') {
        return settings.coderModel || settings.strongModel || providerDefaultStrongModel(baseConfig);
      }
      if (taskMode === 'review' || taskMode === 'research') {
        return settings.verifierModel || settings.researchModel || settings.auditModel || providerDefaultAuditModel(baseConfig);
      }
      return '';
    default:
      return '';
  }
}

export function routeStageModel(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  stage: SpecialistStage,
  taskMode: TaskMode,
): { config: LLMConfig; route: RoutedStage } {
  const overrideModel = overrideForStage(baseConfig, settings, stage, taskMode).trim();
  const config = overrideModel
    ? { ...baseConfig, model: overrideModel }
    : { ...baseConfig };

  return {
    config,
    route: {
      stage,
      taskMode,
      selectedModel: config.model || baseConfig.model || baseConfig.provider,
      usedOverride: Boolean(overrideModel),
      reason: overrideModel
        ? `Routed ${stage} stage to ${overrideModel} for ${taskMode} work.`
        : `Using the base model for the ${stage} stage.`,
    },
  };
}

export function createProviderForStage(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  stage: SpecialistStage,
  taskMode: TaskMode,
) {
  const routed = routeStageModel(baseConfig, settings, stage, taskMode);
  const profiled = applyModelStabilityProfile(routed.config);
  return {
    provider: createLLMProvider(profiled.config),
    config: profiled.config,
    route: routed.route,
    profile: profiled.profile,
  };
}

export function summarizeRoutes(routes: RoutedStage[]): string {
  if (routes.length === 0) return 'No specialist routes used.';
  return routes.map((route) => `${route.stage}: ${route.selectedModel}`).join(' | ');
}
