import type { NovaConfig } from './config.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ── Streaming generator — yields text chunks ──────────────────────────────────
export async function* streamLLM(
  messages: LLMMessage[],
  config: NovaConfig,
): AsyncGenerator<string> {
  const { provider, model, baseUrl, apiKey } = config;

  if (provider === 'ollama') {
    yield* ollamaStream(messages, model, baseUrl);
  } else {
    // openai / lmstudio / custom — all OpenAI-compatible
    yield* openaiStream(messages, model, baseUrl, apiKey);
  }
}

async function* ollamaStream(
  messages: LLMMessage[],
  model: string,
  baseUrl: string,
): AsyncGenerator<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${err.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('No response body');
  yield* parseNDJSON(res.body, (obj: { message?: { content?: string }; done?: boolean }) => {
    if (obj.done) return null;
    return obj.message?.content ?? null;
  });
}

async function* openaiStream(
  messages: LLMMessage[],
  model: string,
  baseUrl: string,
  apiKey: string,
): AsyncGenerator<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`LLM ${res.status}: ${err.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('No response body');
  yield* parseSSE(res.body, (data) => {
    if (data === '[DONE]') return null;
    try {
      const obj = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      return obj.choices?.[0]?.delta?.content ?? null;
    } catch {
      return null;
    }
  });
}

// ── Stream parsers ────────────────────────────────────────────────────────────
async function* parseNDJSON<T>(
  body: ReadableStream<Uint8Array>,
  extract: (obj: T) => string | null,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = extract(JSON.parse(line) as T);
        if (chunk != null) yield chunk;
      } catch { /* partial line */ }
    }
  }
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  extract: (data: string) => string | null,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/^data:\s*/, '').trim();
      if (!trimmed) continue;
      const chunk = extract(trimmed);
      if (chunk != null) yield chunk;
    }
  }
}
