import { createContext, runInContext } from 'node:vm';

export interface ToolResult {
  name: string;
  content: string;
  error?: string;
}

interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// ── Web search (Google News RSS — no API key) ─────────────────────────────────
const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for current news and information.',
  async execute({ query }: Record<string, unknown>) {
    const q = String(query ?? '');
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
      const results = items.map((m) => {
        const get = (tag: string) =>
          (m[1].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'))?.[1] ?? '')
            .replace(/<[^>]+>/g, '').trim();
        const title = get('title');
        const desc  = get('description').slice(0, 220);
        const date  = get('pubDate');
        return `**${title}**\n${desc}${date ? `\n*${date}*` : ''}`;
      }).filter(Boolean);
      return { name: 'web_search', content: results.join('\n\n---\n\n') || 'No results.' };
    } catch (e) {
      return { name: 'web_search', content: '', error: String(e) };
    }
  },
};

// ── Weather (wttr.in — no API key) ────────────────────────────────────────────
const weatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for any city or location.',
  async execute({ location }: Record<string, unknown>) {
    const loc = String(location ?? 'London');
    try {
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(loc)}?format=j1`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      interface WttrResp {
        current_condition?: Array<{
          temp_C: string; FeelsLikeC: string; windspeedKmph: string;
          humidity: string; weatherDesc: Array<{ value: string }>;
        }>;
        nearest_area?: Array<{
          areaName: Array<{ value: string }>; country: Array<{ value: string }>;
        }>;
      }
      const d = (await res.json()) as WttrResp;
      const c = d.current_condition?.[0];
      const a = d.nearest_area?.[0];
      const name = a
        ? `${a.areaName[0]?.value}, ${a.country[0]?.value}`
        : loc;
      const desc = c?.weatherDesc[0]?.value ?? '';
      return {
        name: 'get_weather',
        content: `**${name}**: ${c?.temp_C}°C (feels ${c?.FeelsLikeC}°C), ${desc}, wind ${c?.windspeedKmph} km/h, humidity ${c?.humidity}%`,
      };
    } catch (e) {
      return { name: 'get_weather', content: '', error: String(e) };
    }
  },
};

// ── Current time ──────────────────────────────────────────────────────────────
const timeTool: Tool = {
  name: 'get_time',
  description: 'Get the current date and time for a timezone or city.',
  async execute({ location }: Record<string, unknown>) {
    const tz = String(location ?? 'UTC');
    try {
      const s = new Date().toLocaleString('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: 'short',
        day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
      });
      return { name: 'get_time', content: `Current time in **${tz}**: ${s}` };
    } catch {
      return { name: 'get_time', content: `UTC: ${new Date().toUTCString()}` };
    }
  },
};

// ── Wikipedia ─────────────────────────────────────────────────────────────────
const wikipediaTool: Tool = {
  name: 'wikipedia',
  description: 'Look up any topic on Wikipedia for factual information.',
  async execute({ query }: Record<string, unknown>) {
    const q = String(query ?? '').replace(/ /g, '_');
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'NovaCLI/2.0 (opensource)' }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { title?: string; extract?: string };
      return { name: 'wikipedia', content: `**${d.title}**\n\n${d.extract?.slice(0, 1500) ?? ''}` };
    } catch (e) {
      return { name: 'wikipedia', content: '', error: String(e) };
    }
  },
};

// ── Run code (vm sandbox) ─────────────────────────────────────────────────────
const runCodeTool: Tool = {
  name: 'run_code',
  description: 'Execute JavaScript for calculations or data transforms. Use console.log() to print results.',
  async execute({ code }: Record<string, unknown>) {
    const src = String(code ?? '').trim();
    const blocked = /\b(require|import\s*\(|fetch|XMLHttpRequest|child_process|exec|spawn|fs\b|os\b|net\b|eval|Function\s*\(|process\.exit)\b/.test(src);
    if (blocked) return { name: 'run_code', content: '', error: 'Blocked: restricted API used.' };
    try {
      const output: string[] = [];
      const ctx = createContext({
        console: {
          log:   (...a: unknown[]) => output.push(a.map(String).join(' ')),
          error: (...a: unknown[]) => output.push('[err] ' + a.map(String).join(' ')),
        },
        Math, JSON, parseInt, parseFloat, isNaN, isFinite,
        Array, Object, String, Number, Boolean, Date, Error, Set, Map, RegExp,
      });
      runInContext(src, ctx, { timeout: 5000 });
      return { name: 'run_code', content: output.join('\n') || '(no output — use console.log)' };
    } catch (e) {
      return { name: 'run_code', content: '', error: e instanceof Error ? e.message : String(e) };
    }
  },
};

// ── Public API ────────────────────────────────────────────────────────────────
export const allTools: Tool[] = [webSearchTool, weatherTool, timeTool, wikipediaTool, runCodeTool];

export function buildSystemPrompt(agentName: string): string {
  const list = allTools.map((t) => `- **${t.name}**: ${t.description}`).join('\n');
  return `You are ${agentName}, a personal AI agent with live tool access.
Be helpful, direct, and concise. Use markdown formatting where appropriate.

## Use tools for real-time data
- Weather, news, stocks, current events → call get_weather or web_search
- Calculations → use run_code
- Facts → use wikipedia
- Do NOT apologize for lacking real-time access — use the tools!

## How to call a tool
Emit a fenced code block with language "tool":
\`\`\`tool
{"name":"web_search","arguments":{"query":"latest AI news 2026"}}
\`\`\`

## Available tools
${list}`;
}

export function parseTool(text: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const m of text.matchAll(/```tool\s*\r?\n([\s\S]*?)```/g)) {
    try {
      const obj = JSON.parse(m[1]) as { name: string; arguments: Record<string, unknown> };
      if (obj.name) calls.push(obj);
    } catch { /* skip malformed */ }
  }
  return calls;
}

export async function executeTool(
  call: { name: string; arguments: Record<string, unknown> },
): Promise<ToolResult> {
  const tool = allTools.find((t) => t.name === call.name);
  if (!tool) return { name: call.name, content: '', error: `Tool "${call.name}" not found` };
  return tool.execute(call.arguments ?? {});
}
