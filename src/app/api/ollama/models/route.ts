import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';

function normalizeOllamaBaseUrl(input: string): string {
  return input.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const baseUrlParam = searchParams.get('baseUrl');
    const apiKeyParam = searchParams.get('apiKey');

    const savedBaseUrl = await getSetting('llm_base_url');
    const savedApiKey = await getSetting('llm_api_key');
    const savedProvider = await getSetting('llm_provider');
    const providerUsesOllama = savedProvider === 'ollama' || savedProvider === 'ollama-cloud';

    // For ollama-cloud, always use ollama.com
    const isCloud = savedProvider === 'ollama-cloud' && !baseUrlParam;
    const baseUrl = isCloud
      ? 'https://ollama.com'
      : normalizeOllamaBaseUrl(
          baseUrlParam ||
          (providerUsesOllama ? (savedBaseUrl || '') : '') ||
          'http://localhost:11434'
        );
    const apiKey = apiKeyParam || (isCloud ? savedApiKey : '') || '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return NextResponse.json({ error: 'Ollama not reachable', models: [], connected: false }, { status: 200 });
      }

      const data = await res.json();
      const models = (data.models || []).map((m: { name: string; size?: number; details?: { parameter_size?: string } }) => ({
        name: m.name,
        size: m.size ? formatBytes(m.size) : undefined,
        paramSize: m.details?.parameter_size,
      }));

      return NextResponse.json({ models, connected: true });
    } catch {
      clearTimeout(timeout);
      return NextResponse.json({ error: 'Ollama not running', models: [], connected: false }, { status: 200 });
    }
  } catch {
    return NextResponse.json({ error: 'Internal error', models: [] }, { status: 500 });
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}

// ── DELETE /api/ollama/models  (body: { name }) ────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const { name } = await request.json() as { name?: string };
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const savedBaseUrl = await getSetting('llm_base_url');
    const savedProvider = await getSetting('llm_provider');
    const baseUrl = normalizeOllamaBaseUrl(
      (savedProvider === 'ollama' || savedProvider === 'ollama-cloud')
        ? (savedBaseUrl || 'http://localhost:11434')
        : 'http://localhost:11434'
    );
    const res = await fetch(`${baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return NextResponse.json({ error: 'Failed to delete model' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── POST /api/ollama/models  (body: { name }) — pull with SSE progress ──────
export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json() as { name?: string };
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const savedBaseUrl = await getSetting('llm_base_url');
    const savedProvider = await getSetting('llm_provider');
    const baseUrl = normalizeOllamaBaseUrl(
      (savedProvider === 'ollama' || savedProvider === 'ollama-cloud')
        ? (savedBaseUrl || 'http://localhost:11434')
        : 'http://localhost:11434'
    );

    const ollamaRes = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });
    if (!ollamaRes.ok || !ollamaRes.body) {
      return NextResponse.json({ error: 'Failed to start pull' }, { status: 500 });
    }

    // Stream Ollama pull progress back as SSE
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const reader = ollamaRes.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const obj = JSON.parse(trimmed) as { status?: string; total?: number; completed?: number };
                controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
                if (obj.status === 'success') { controller.close(); return; }
              } catch { /* ignore */ }
            }
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ status: 'success' })}\n\n`));
          controller.close();
        } catch (e) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
