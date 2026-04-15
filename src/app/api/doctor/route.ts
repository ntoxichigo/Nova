import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createLLMProvider } from '@/lib/llm';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import { getLLMConfig } from '@/lib/settings';
import { buildRuntimeProfile, extractInlineToolCall, streamProviderText } from '@/lib/chat/stream-utils';
import { applyResponsiveHtmlGuard } from '@/lib/html-preview';
import { createScriptProjectTool } from '@/lib/tools/executors';
import { getOrchestrationSettings } from '@/lib/orchestration/config';
import { buildContextPack, classifyTaskMode } from '@/lib/orchestration/context-engine';
import { routeStageModel, summarizeRoutes } from '@/lib/orchestration/model-router';
import { runOrchestrationEvalSuite } from '@/lib/orchestration/evals';
import { getOrchestrationTelemetrySummary } from '@/lib/orchestration/telemetry';
import { getOperatingSystemState } from '@/lib/operating-system';
import type { DoctorCheck, DoctorCheckStatus, DoctorRunResult } from '@/lib/doctor/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckOutcome {
  status: DoctorCheckStatus;
  summary: string;
  details?: Record<string, unknown>;
}

async function runCheck(
  id: string,
  label: string,
  runner: () => Promise<CheckOutcome>,
): Promise<DoctorCheck> {
  const startedAt = Date.now();

  try {
    const result = await runner();
    return {
      id,
      label,
      status: result.status,
      summary: result.summary,
      details: result.details,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'fail',
      summary: error instanceof Error ? error.message : 'Unexpected diagnostic failure',
      details: {
        error: error instanceof Error ? error.stack || error.message : String(error),
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

function projectIdFromToolResult(content: string): string | null {
  return content.match(/__ide_project_id:([a-z0-9]+)/i)?.[1] ?? null;
}

function overallStatus(checks: DoctorCheck[]): DoctorCheckStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

export async function POST() {
  const startedAt = Date.now();

  const [llmConfig, orchestrationSettings, telemetry, operatingSystem] = await Promise.all([
    getLLMConfig(),
    getOrchestrationSettings(),
    getOrchestrationTelemetrySummary().catch(() => null),
    getOperatingSystemState().catch(() => null),
  ]);
  const { config: profiledConfig, profile } = applyModelStabilityProfile(llmConfig);
  const provider = createLLMProvider(profiledConfig);
  const runtimeProfile = buildRuntimeProfile(profiledConfig, provider, false);
  const routePreview = [
    routeStageModel(profiledConfig, orchestrationSettings, 'main', 'coding').route,
    routeStageModel(profiledConfig, orchestrationSettings, 'planner', 'coding').route,
    routeStageModel(profiledConfig, orchestrationSettings, 'verifier', 'coding').route,
  ];

  const checks: DoctorCheck[] = [];

  checks.push(await runCheck('provider-ping', 'Provider Ping', async () => {
    const result = await provider.testConnection();
    return {
      status: result.success ? 'pass' : 'fail',
      summary: result.success
        ? `Connection healthy via ${result.provider}${result.model ? ` / ${result.model}` : ''}.`
        : result.message || 'Provider connection failed.',
      details: {
        provider: result.provider,
        model: result.model || profiledConfig.model || '',
        latencyMs: result.latencyMs ?? null,
        capabilities: result.capabilities,
      },
    };
  }));

  checks.push(await runCheck('stream-test', 'Stream Test', async () => {
    const result = await streamProviderText(provider, [
      {
        role: 'user',
        content: 'Reply with exactly STREAM_OK and nothing else.',
      },
    ]);
    const normalized = result.content.trim();
    const ok = normalized.includes('STREAM_OK');
    return {
      status: ok ? 'pass' : 'fail',
      summary: ok
        ? 'Streaming returned usable output.'
        : 'Streaming did not return the expected token-safe response.',
      details: {
        contentPreview: normalized.slice(0, 200),
        finishReason: result.finishReason || '',
        usedFallback: result.usedFallback,
        reasoningOnly: result.reasoningOnly,
        model: result.model || profiledConfig.model || '',
      },
    };
  }));

  checks.push(await runCheck('tool-call-test', 'Tool Call Parse Test', async () => {
    const inlineSample = `{"name":"create_script_project","arguments":{"title":"ML Frontend Showcase","description":"Modern premium single-page website about machine learning","files":[{"name":"index.html","content":"<!DOCTYPE html><html><body><canvas width=\\"1600\\" height=\\"900\\"></canvas></body></html>"}]}}`;
    const inlineCall = extractInlineToolCall(inlineSample, [createScriptProjectTool.name]);
    const fencedSample = `\`\`\`tool\n${inlineSample}\n\`\`\``;
    const fencedMatch = fencedSample.match(/```tool\s*([\s\S]*?)```/i);
    const fencedParsed = fencedMatch ? JSON.parse(fencedMatch[1].trim()) as Record<string, unknown> : null;

    const parsedOk = Boolean(
      inlineCall &&
      inlineCall.name === createScriptProjectTool.name &&
      fencedParsed &&
      fencedParsed.name === createScriptProjectTool.name,
    );

    return {
      status: parsedOk ? 'pass' : 'fail',
      summary: parsedOk
        ? 'Inline and fenced tool payloads parse correctly.'
        : 'Tool payload parsing failed for a real website-generation sample.',
      details: {
        inlineParsed: Boolean(inlineCall),
        fencedParsed: Boolean(fencedParsed),
        fileAliasAccepted: Boolean(
          inlineCall &&
          Array.isArray((inlineCall.arguments as { files?: unknown[] }).files),
        ),
      },
    };
  }));

  checks.push(await runCheck('project-create-test', 'Project Create Test', async () => {
    let createdProjectId: string | null = null;

    try {
      const probeName = `Doctor Probe ${Date.now()}`;
      const result = await createScriptProjectTool.execute({
        title: probeName,
        description: 'Diagnostic website project creation probe.',
        files: [
          {
            name: 'index.html',
            content: '<!DOCTYPE html><html><body><main style="width:100vw"><canvas width="1600" height="900"></canvas><h1>Doctor probe</h1></main></body></html>',
          },
        ],
      });

      if (result.error) {
        throw new Error(result.error);
      }

      createdProjectId = projectIdFromToolResult(result.content);
      if (!createdProjectId) {
        throw new Error('Project was created but no IDE project marker was returned.');
      }

      const project = await db.scriptProject.findUnique({
        where: { id: createdProjectId },
        include: { files: true },
      });

      if (!project) {
        throw new Error('Created project could not be loaded from the database.');
      }

      const firstFile = project.files[0];
    const guarded = Boolean(firstFile?.content.includes('nova-preview-guard'));

      return {
        status: project.files.length > 0 ? 'pass' : 'fail',
        summary: `Project creation succeeded with ${project.files.length} file(s).`,
        details: {
          projectId: project.id,
          fileCount: project.files.length,
          firstFilePath: firstFile?.path || '',
          previewGuardApplied: guarded,
        },
      };
    } finally {
      if (createdProjectId) {
        await db.scriptProject.delete({ where: { id: createdProjectId } }).catch(() => {});
      }
    }
  }));

  checks.push(await runCheck('preview-test', 'Preview Guard Test', async () => {
    const guarded = applyResponsiveHtmlGuard(
      '<!DOCTYPE html><html><body><section style="width:100vw"><canvas width="1800" height="800"></canvas></section></body></html>',
      'Doctor Preview',
    );

    const hasViewport = guarded.includes('name="viewport"');
    const hasStyleGuard = guarded.includes('id="nova-preview-guard"');
    const hasScriptGuard = guarded.includes('id="nova-preview-guard-script"');
    const hasCanvasGuard = guarded.includes('canvas{width:100%!important;height:auto!important;}');
    const ok = hasViewport && hasStyleGuard && hasScriptGuard && hasCanvasGuard;

    return {
      status: ok ? 'pass' : 'fail',
      summary: ok
        ? 'Responsive preview shell is active for raw HTML artifacts.'
        : 'Preview guard is missing one or more containment protections.',
      details: {
        hasViewport,
        hasStyleGuard,
        hasScriptGuard,
        hasCanvasGuard,
        outputSize: guarded.length,
      },
    };
  }));

  checks.push(await runCheck('context-pack-test', 'Context Pack Test', async () => {
    const syntheticPack = buildContextPack({
      objective: 'Diagnose why a React build crashes and propose the next fix.',
      taskMode: classifyTaskMode('Debug the failing React build and fix the crash.'),
      runtimeProfile,
      sections: [
        { label: 'Workspace', content: 'src/App.tsx\nsrc/main.tsx\nvite.config.ts', priority: 1 },
        { label: 'Errors', content: 'Build fails on missing export and type mismatch.', priority: 2 },
        { label: 'Conversation', content: 'USER: The app crashes after a refactor.\nASSISTANT: Investigating.', priority: 3 },
      ],
    });

    return {
      status: syntheticPack.estimatedTokens > 0 ? 'pass' : 'fail',
      summary: syntheticPack.estimatedTokens > 0
        ? 'Context engine built a compact task pack successfully.'
        : 'Context engine returned an empty pack.',
      details: {
        estimatedTokens: syntheticPack.estimatedTokens,
        droppedSections: syntheticPack.droppedSections,
        providerContextCap: runtimeProfile.contextWindow,
      },
    };
  }));

  checks.push(await runCheck('routing-test', 'Model Routing Test', async () => {
    const codingMain = routeStageModel(profiledConfig, orchestrationSettings, 'main', 'coding').route;
    const researcher = routeStageModel(profiledConfig, orchestrationSettings, 'researcher', 'research').route;
    const summary = summarizeRoutes([codingMain, researcher]);
    return {
      status: summary.length > 0 ? 'pass' : 'fail',
      summary: 'Stage-aware model routing is configured and routable.',
      details: {
        main: codingMain,
        researcher,
        summary,
      },
    };
  }));

  let latestEval: Awaited<ReturnType<typeof runOrchestrationEvalSuite>> | null = null;
  checks.push(await runCheck('eval-suite-test', 'Eval Harness Test', async () => {
    latestEval = await runOrchestrationEvalSuite(profiledConfig, orchestrationSettings);
    return {
      status: latestEval.overallStatus === 'pass' ? 'pass' : 'warn',
      summary: latestEval.overallStatus === 'pass'
        ? `Orchestration eval suite passed ${latestEval.passCount}/${latestEval.cases.length} checks.`
        : `Orchestration eval suite reported ${latestEval.failCount} failing check(s).`,
      details: latestEval as unknown as Record<string, unknown>,
    };
  }));

  const payload: DoctorRunResult = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    overallStatus: overallStatus(checks),
    checks,
    config: {
      provider: profiledConfig.provider,
      model: profiledConfig.model || '',
      profile: profile.label,
      operatingProfile: operatingSystem?.selectedProfile,
      automationMode: operatingSystem?.automationMode,
      maxTokens: profiledConfig.maxTokens,
      contextWindow: profiledConfig.contextWindow,
      qualityMode: profiledConfig.qualityMode,
      autonomyProfile: orchestrationSettings.autonomyProfile,
      routerEnabled: orchestrationSettings.routerEnabled,
      scopedAgentsEnabled: orchestrationSettings.scopedAgentsEnabled,
      tokenTelemetryEnabled: orchestrationSettings.tokenTelemetryEnabled,
      routeSummary: summarizeRoutes(routePreview),
    },
    telemetry: telemetry ?? undefined,
    latestEval,
  };

  return NextResponse.json(payload, {
    status: payload.overallStatus === 'fail' ? 502 : 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
