import { NextResponse } from 'next/server';
import { classifyLLMError, createLLMProvider } from '@/lib/llm';
import type { LLMConfig } from '@/lib/llm/types';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import { getLLMConfig } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_CACHE_TTL_MS = 30_000;

type RuntimeStatusPayload = {
  connected: boolean;
  provider: string;
  model: string;
  configuredModel: string;
  resolvedModel: string;
  message: string;
  latencyMs: number;
  profile?: string;
  reliability?: string;
  checkedAt: string;
  errorType?: string;
  chatReady?: boolean;
};

type ProbeResult = {
  success: boolean;
  model: string;
  message: string;
  errorType?: string;
};

let cachedStatus: { payload: RuntimeStatusPayload; cachedAt: number } | null = null;

function shouldRunChatProbe(config: LLMConfig): boolean {
  if (config.provider === 'xiaomi' || config.provider === 'openai' || config.provider === 'openrouter') {
    return true;
  }
  if (config.provider === 'custom') {
    return !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(config.baseUrl || '');
  }
  return false;
}

async function runChatProbe(config: LLMConfig, modelOverride?: string): Promise<ProbeResult> {
  const probeConfig: LLMConfig = {
    ...config,
    model: modelOverride || config.model,
    maxTokens: Math.min(16, Math.max(8, config.maxTokens ?? 16)),
    temperature: 0,
  };
  const probeProvider = createLLMProvider(probeConfig);

  try {
    const probe = await probeProvider.chat([{ role: 'user', content: 'Reply exactly with: ok' }]);
    const resolvedModel = String(probe.model || probeConfig.model || '').trim();
    const via = resolvedModel && probeConfig.model && resolvedModel !== probeConfig.model
      ? ` via fallback "${resolvedModel}"`
      : resolvedModel
        ? ` via "${resolvedModel}"`
        : '';
    return {
      success: true,
      model: resolvedModel,
      message: `Chat probe passed${via}.`,
    };
  } catch (error: unknown) {
    const classified = classifyLLMError(error);
    return {
      success: false,
      model: '',
      message: `Chat probe failed: ${classified.message}`,
      errorType: classified.type,
    };
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';

  if (!forceRefresh && cachedStatus && (Date.now() - cachedStatus.cachedAt) < STATUS_CACHE_TTL_MS) {
    return NextResponse.json({
      ...cachedStatus.payload,
      cached: true,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    const config = await getLLMConfig();
    const { config: profiledConfig, profile } = applyModelStabilityProfile(config);
    const provider = createLLMProvider(profiledConfig);
    const result = await provider.testConnection();

    const configuredModel = String(profiledConfig.model || '').trim();
    let resolvedModel = String(result.model || configuredModel || '').trim();
    let connected = Boolean(result.success);
    let message = result.message || '';
    let errorType: string | undefined;
    let chatReady: boolean | undefined;

    if (connected && shouldRunChatProbe(profiledConfig)) {
      const tried = new Set<string>();
      const probeOrder = [
        resolvedModel,
        configuredModel,
        'mimo-v2-pro',
        'mimo-v2-flash',
      ]
        .map((model) => String(model || '').trim())
        .filter(Boolean)
        .filter((model) => {
          if (tried.has(model)) return false;
          tried.add(model);
          return true;
        });

      let probeResult: ProbeResult = { success: false, model: '', message: 'Chat probe skipped' };
      for (const candidate of probeOrder) {
        probeResult = await runChatProbe(profiledConfig, candidate);
        if (probeResult.success) break;
        if (profiledConfig.provider !== 'xiaomi') break;
      }

      chatReady = probeResult.success;
      if (probeResult.success) {
        if (probeResult.model) {
          resolvedModel = probeResult.model;
        }
        message = `${message} ${probeResult.message}`.trim();
      } else {
        connected = false;
        errorType = probeResult.errorType;
        message = `${message} ${probeResult.message}`.trim();
      }
    }

    const payload: RuntimeStatusPayload = {
      connected,
      provider: profiledConfig.provider,
      model: resolvedModel || configuredModel || '',
      configuredModel,
      resolvedModel,
      message,
      latencyMs: result.latencyMs ?? Date.now() - startedAt,
      profile: profile.label,
      reliability: profile.reliability,
      checkedAt: new Date().toISOString(),
      errorType,
      chatReady,
    };
    cachedStatus = { payload, cachedAt: Date.now() };

    return NextResponse.json({
      ...payload,
      cached: false,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    const classified = classifyLLMError(error);
    const payload: RuntimeStatusPayload = {
      connected: false,
      provider: '',
      model: '',
      configuredModel: '',
      resolvedModel: '',
      message: classified.message,
      errorType: classified.type,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      chatReady: false,
    };
    cachedStatus = { payload, cachedAt: Date.now() };
    return NextResponse.json({
      ...payload,
      cached: false,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
}

