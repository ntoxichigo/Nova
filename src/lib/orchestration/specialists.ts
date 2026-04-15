import type { LLMConfig, LLMMessage } from '@/lib/llm/types';
import { clipText, estimateTokens, streamProviderText } from '@/lib/chat/stream-utils';
import { createProviderForStage } from './model-router';
import type {
  ContextPack,
  OrchestrationSettings,
  SpecialistPlan,
  SpecialistResearchBrief,
  SpecialistStage,
  SpecialistVerification,
  TaskMode,
} from './types';

function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

async function runStageText(
  stage: SpecialistStage,
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  taskMode: TaskMode,
  messages: LLMMessage[],
) {
  const { provider, route } = createProviderForStage(baseConfig, settings, stage, taskMode);
  const result = await streamProviderText(provider, messages);
  const promptTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const outputTokens = estimateTokens(result.content.trim());
  return {
    content: result.content.trim(),
    route,
    meta: result,
    trace: {
      stage,
      model: route.selectedModel,
      promptTokens,
      outputTokens,
      usedFallback: result.usedFallback,
      finishReason: result.finishReason,
    },
  };
}

export async function runPlannerSpecialist(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  taskMode: TaskMode,
  contextPack: ContextPack,
): Promise<SpecialistPlan | null> {
  const prompt = [
    'Create a compact execution plan for the task below.',
    'Return JSON only with keys: objective, steps, risks, notes.',
    'steps must be 2 to 5 short strings.',
    'risks must be 0 to 3 short strings.',
    '',
    contextPack.combined,
  ].join('\n');

  try {
    const result = await runStageText('planner', baseConfig, settings, taskMode, [
      { role: 'system', content: 'You are a disciplined planning specialist.' },
      { role: 'user', content: prompt },
    ]);
    const parsed = extractJsonObject(result.content);
    const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    const steps = rawSteps
      .map((step) => String(step).trim())
      .filter(Boolean)
      .slice(0, 5);
    if (steps.length < 2) {
      return null;
    }
    return {
      objective: String(parsed?.objective || contextPack.objective).trim(),
      steps,
      risks: Array.isArray(parsed?.risks)
        ? parsed.risks.map((risk) => String(risk).trim()).filter(Boolean).slice(0, 3)
        : [],
      notes: String(parsed?.notes || '').trim(),
      route: result.route,
      trace: result.trace,
    };
  } catch {
    return null;
  }
}

export async function runVerifierSpecialist(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  taskMode: TaskMode,
  contextPack: ContextPack,
  candidateResponse: string,
  toolResults: string[] = [],
): Promise<SpecialistVerification | null> {
  const prompt = [
    'Review whether the draft below fully satisfies the objective.',
    'Return JSON only with keys: verdict, summary, followUp, confidence.',
    'verdict must be "pass" or "revise".',
    '',
    contextPack.combined,
    '',
    toolResults.length > 0 ? `Tool Results:\n${clipText(toolResults.join('\n\n'), 1600)}` : '',
    '',
    `Draft:\n${clipText(candidateResponse, 2400)}`,
  ].filter(Boolean).join('\n');

  try {
    const result = await runStageText('verifier', baseConfig, settings, taskMode, [
      { role: 'system', content: 'You are a strict verification specialist focused on completeness and correctness.' },
      { role: 'user', content: prompt },
    ]);
    const parsed = extractJsonObject(result.content);
    const verdict = parsed?.verdict === 'revise' ? 'revise' : 'pass';
    return {
      verdict,
      summary: String(parsed?.summary || result.content || 'Verification completed.').trim(),
      followUp: parsed?.followUp ? String(parsed.followUp).trim() : undefined,
      confidence: parsed?.confidence === 'low' || parsed?.confidence === 'medium' ? parsed.confidence : 'high',
      route: result.route,
      trace: result.trace,
    };
  } catch {
    return null;
  }
}

export async function runResearchBriefSpecialist(
  baseConfig: LLMConfig,
  settings: OrchestrationSettings,
  contextPack: ContextPack,
): Promise<SpecialistResearchBrief | null> {
  try {
    const result = await runStageText('researcher', baseConfig, settings, 'research', [
      { role: 'system', content: 'You are a research briefing specialist. Summarize the key angles and missing evidence.' },
      { role: 'user', content: contextPack.combined },
    ]);
    if (!result.content) return null;
    return {
      summary: clipText(result.content, 900),
      route: result.route,
      trace: result.trace,
    };
  } catch {
    return null;
  }
}
