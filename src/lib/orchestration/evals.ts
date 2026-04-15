import { allTools } from '@/lib/tools/executors';
import { buildRuntimeProfile, selectRelevantTools } from '@/lib/chat/stream-utils';
import { createLLMProvider } from '@/lib/llm';
import type { LLMConfig } from '@/lib/llm/types';
import { tryRecordAuditEvent } from '@/lib/audit';
import { AUTONOMY_PROFILES, getAutonomyProfile } from './config';
import { buildContextPack, classifyTaskMode } from './context-engine';
import { routeStageModel } from './model-router';
import type { EvalCaseResult, EvalRunResult, OrchestrationSettings } from './types';

function status(summaryOk: boolean, label: string, details?: Record<string, unknown>): EvalCaseResult {
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    status: summaryOk ? 'pass' : 'fail',
    summary: summaryOk ? `${label} passed.` : `${label} failed.`,
    details,
  };
}

export async function runOrchestrationEvalSuite(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
): Promise<EvalRunResult> {
  const provider = createLLMProvider(baseConfig);
  const runtimeProfile = buildRuntimeProfile(baseConfig, provider, false);
  const syntheticSettings: OrchestrationSettings = {
    ...settings,
    routerEnabled: true,
    plannerModel: settings.plannerModel || 'planner-model',
    coderModel: settings.coderModel || 'coder-model',
    verifierModel: settings.verifierModel || 'verifier-model',
    researchModel: settings.researchModel || 'research-model',
  };

  const cases: EvalCaseResult[] = [];

  const debugMode = classifyTaskMode('Please debug the failing React build and fix the lint errors.');
  cases.push(status(debugMode === 'debug', 'Task classification: debug', { taskMode: debugMode }));

  const researchMode = classifyTaskMode('Research the latest Xiaomi MiMo V2 model updates and compare them.');
  cases.push(status(researchMode === 'research', 'Task classification: research', { taskMode: researchMode }));

  const coderRoute = routeStageModel(baseConfig, syntheticSettings, 'main', 'coding').route;
  cases.push(status(coderRoute.selectedModel === syntheticSettings.coderModel, 'Model routing: coding main stage', coderRoute as unknown as Record<string, unknown>));

  const researchRoute = routeStageModel(baseConfig, syntheticSettings, 'researcher', 'research').route;
  cases.push(status(researchRoute.selectedModel === syntheticSettings.researchModel, 'Model routing: research stage', researchRoute as unknown as Record<string, unknown>));

  const builderProfile = getAutonomyProfile('builder');
  cases.push(status(builderProfile.allowHandsFreeExecution && builderProfile.autoVerify, 'Autonomy profile: builder', builderProfile as unknown as Record<string, unknown>));

  const reviewerProfile = AUTONOMY_PROFILES.reviewer;
  cases.push(status(reviewerProfile.reviewOnly && !reviewerProfile.allowHandsFreeExecution, 'Autonomy profile: reviewer', reviewerProfile as unknown as Record<string, unknown>));

  const pack = buildContextPack({
    objective: 'Debug a failing React build and keep the answer concise.',
    taskMode: 'debug',
    runtimeProfile,
    sections: [
      { label: 'Workspace', content: 'src/App.tsx\nsrc/main.tsx\nvite.config.ts', priority: 1 },
      { label: 'Errors', content: 'Type error in App.tsx line 18.\nBuild fails on missing export.', priority: 2 },
      { label: 'Recent Messages', content: 'USER: The build broke after I renamed a hook.\nASSISTANT: Investigating.', priority: 3 },
    ],
  });
  cases.push(status(pack.estimatedTokens <= runtimeProfile.promptTokenBudget, 'Context pack budget', {
    estimatedTokens: pack.estimatedTokens,
    budget: runtimeProfile.promptTokenBudget,
  }));

  const selectedTools = selectRelevantTools(allTools, 'Find the latest Xiaomi MiMo model news and pricing', runtimeProfile);
  cases.push(status(selectedTools.some((tool) => /search|read/i.test(tool.name)), 'Tool routing: research shortlist', {
    tools: selectedTools.map((tool) => tool.name),
  }));

  const passCount = cases.filter((entry) => entry.status === 'pass').length;
  const failCount = cases.length - passCount;
  const result: EvalRunResult = {
    ranAt: new Date().toISOString(),
    overallStatus: failCount === 0 ? 'pass' : 'fail',
    passCount,
    failCount,
    cases,
  };

  await tryRecordAuditEvent({
    source: 'eval',
    action: 'orchestration_eval',
    entityType: 'eval_suite',
    entityId: 'core-orchestration',
    entityLabel: 'Core Orchestration',
    status: result.overallStatus === 'pass' ? 'success' : 'error',
    severity: result.overallStatus === 'pass' ? 'info' : 'warning',
    summary: `Core orchestration eval ${result.overallStatus}`,
    details: result as unknown as Record<string, unknown>,
  });

  return result;
}
