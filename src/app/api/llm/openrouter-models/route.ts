import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchOpenRouterModels } from '@/lib/llm/openrouter-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Read the stored API key from DB settings
    const rows = await db.settings.findMany();
    const settingsMap = Object.fromEntries(rows.map((s) => [s.key, s.value]));
    const apiKey = settingsMap['llm_api_key'] ?? '';

    // Abort after 12 seconds to avoid hanging the UI
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);

    const result = await fetchOpenRouterModels(apiKey, controller.signal);
    clearTimeout(timeoutId);

    // Optional query-param filters applied server-side
    const { searchParams } = new URL(request.url);
    const capabilityParam = searchParams.get('capability'); // text|multimodal|video|audio|free|reasoning
    const providerParam = searchParams.get('provider'); // e.g. "qwen", "google"
    const minContextParam = searchParams.get('minContext'); // e.g. "128000"

    let filtered = result.models;

    if (capabilityParam) {
      filtered = filtered.filter((m) => {
        switch (capabilityParam) {
          case 'text':
            return (
              m.inputModalities.length === 1 && m.inputModalities[0] === 'text'
            );
          case 'multimodal':
            return m.inputModalities.includes('image');
          case 'video':
            return m.inputModalities.includes('video');
          case 'audio':
            return m.inputModalities.includes('audio');
          case 'free':
            return m.isFree;
          case 'reasoning': {
            const lc = m.name.toLowerCase() + ' ' + m.id.toLowerCase();
            return (
              lc.includes('think') ||
              lc.includes('reason') ||
              lc.includes('-r1') ||
              lc.includes('/r1') ||
              lc.includes('-o1') ||
              lc.includes('-o3') ||
              lc.includes('-o4') ||
              lc.includes('qwq') ||
              lc.includes('deepseek-r1')
            );
          }
          default:
            return true;
        }
      });
    }

    if (providerParam) {
      const lp = providerParam.toLowerCase();
      filtered = filtered.filter((m) => m.provider.toLowerCase() === lp);
    }

    if (minContextParam) {
      const minCtx = parseInt(minContextParam, 10);
      if (!isNaN(minCtx)) {
        filtered = filtered.filter((m) => m.contextLength >= minCtx);
      }
    }

    return NextResponse.json({ ...result, models: filtered });
  } catch (err) {
    return NextResponse.json(
      {
        models: [],
        error: {
          code: 'SERVER_ERROR',
          message:
            err instanceof Error ? err.message : 'Internal server error',
        },
        meta: {
          fetchedAt: new Date().toISOString(),
          totalCount: 0,
          partialList: false,
        },
      },
      { status: 500 },
    );
  }
}
