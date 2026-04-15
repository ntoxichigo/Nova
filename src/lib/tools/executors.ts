import type { ToolDefinition } from './types';
import { db } from '@/lib/db';
import { applyResponsiveHtmlGuard as applySharedResponsiveHtmlGuard } from '@/lib/html-preview';

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(source: string, tagName: string): string {
  const match = source.match(new RegExp(`<${tagName}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\/${tagName}>`, 'i'));
  return stripHtml((match?.[1] ?? match?.[2] ?? '').trim());
}

function stripMarkdown(text: string): string {
  return stripHtml(text)
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[\*_`]/g, '')
    .trim();
}

function isTimeSensitiveQuery(query: string): boolean {
  return /\b(current|latest|today|now|news|breaking|weather|temperature|wind|forecast|price|prices|stock|stocks|crypto|bitcoin|ethereum|eth|election|elections|score|scores|match|matches|release|released|launch|launched|update|updates|tonight|this week|this month|this year|2026|2027)\b/i.test(query);
}

function isEasterQuery(query: string): boolean {
  return /\beaster\b/i.test(query) && /\b(when|date|coming|this year|next year|what day|which day|sunday)\b/i.test(query);
}

function extractYear(query: string): number | null {
  const match = query.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function calculateEasterSunday(year: number): Date {
  // Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatEasterAnswer(year: number): string {
  const easterSunday = calculateEasterSunday(year);
  const formatted = easterSunday.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `Easter Sunday in ${year} is ${formatted}.`;
}

async function fetchGoogleNewsResults(query: string): Promise<string[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items.slice(0, 4).map((match) => {
      const item = match[1];
      const title = extractTag(item, 'title');
      const description = extractTag(item, 'description');
      const pubDate = extractTag(item, 'pubDate');
      const parts = [title];
      if (description) parts.push(description.slice(0, 220));
      if (pubDate) parts.push(pubDate);
      return `**${parts[0]}**${parts.length > 1 ? ` — ${parts.slice(1).join(' • ')}` : ''}`;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchDuckDuckGoResults(query: string): Promise<string[]> {
  try {
    const url = `https://r.jina.ai/https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'text/plain', 'X-Return-Format': 'markdown' },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split('\n');
    const results: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const titleMatch = line.match(/^## \[(.+?)\]\((.+?)\)$/);
      if (!titleMatch) continue;

      const title = stripMarkdown(titleMatch[1]);
      let snippet = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
        const candidate = stripMarkdown(lines[j].trim());
        if (!candidate) continue;
        if (candidate.startsWith('## ')) break;
        if (candidate.startsWith('[') || candidate.startsWith('!')) continue;
        if (candidate.length > 20 && candidate !== title) {
          snippet = candidate;
          break;
        }
      }

      results.push(snippet ? `**${title}** — ${snippet}` : `**${title}**`);
      if (results.length >= 4) break;
    }

    return results;
  } catch {
    return [];
  }
}

async function fetchWikipediaResults(query: string): Promise<string[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data.query?.search ?? [];
    return hits.slice(0, 3).map((hit: { title: string; snippet?: string }) => {
      const snippet = stripHtml(String(hit.snippet || '')).slice(0, 220);
      return snippet ? `**${hit.title}** — ${snippet}` : `**${hit.title}**`;
    });
  } catch {
    return [];
  }
}

export const getEasterTool: ToolDefinition = {
  name: 'get_easter',
  description: 'Calculate the date of Easter Sunday for a given year. Use when asked when Easter is, when Easter is coming this year, or what date Easter falls on.',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'integer', description: 'Gregorian year to calculate Easter for. Defaults to the current year.' },
    },
  },
  async execute(args) {
    const explicitYear = Number(args.year);
    const year = Number.isFinite(explicitYear) ? Math.trunc(explicitYear) : new Date().getFullYear();
    return { toolName: 'get_easter', content: formatEasterAnswer(year) };
  },
};

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information, news, real-time data, or anything that changes over time. Always use this when asked about recent events, today\'s date, prices, weather, or any topic that may have changed since 2023.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query || '').trim();
    if (!query) return { toolName: 'web_search', content: '', error: 'Query is required' };

    if (isEasterQuery(query)) {
      const year = extractYear(query) ?? new Date().getFullYear();
      return { toolName: 'web_search', content: formatEasterAnswer(year) };
    }

    const results: string[] = [];

    if (isTimeSensitiveQuery(query)) {
      results.push(...await fetchGoogleNewsResults(query));
    }

    if (results.length === 0) {
      results.push(...await fetchDuckDuckGoResults(query));
    }

    if (results.length === 0) {
      results.push(...await fetchWikipediaResults(query));
    }

    if (results.length === 0) {
      return {
        toolName: 'web_search',
        content: `No results found for "${query}". Try a more specific query, or I can answer from my training data if this is a general knowledge question.`,
      };
    }

    return {
      toolName: 'web_search',
      content: `Search results for "${query}":\n\n${results.join('\n\n')}`,
    };
  },
};

export const readKnowledgeTool: ToolDefinition = {
  name: 'read_knowledge',
  description: 'Read from the knowledge base. Use when asked about topics the agent has been taught.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic or keyword to search for in the knowledge base' },
    },
    required: ['topic'],
  },
  async execute(args) {
    const topic = String(args.topic || '');
    try {
      const entries = await db.knowledge.findMany();
      const topicLower = topic.toLowerCase();
      const matches = entries.filter((e) =>
        e.topic.toLowerCase().includes(topicLower) ||
        e.content.toLowerCase().includes(topicLower)
      );
      if (matches.length === 0) return { toolName: 'read_knowledge', content: `No knowledge found for "${topic}"` };
      const content = matches.map((e) => `**${e.topic}**\n${e.content}`).join('\n\n');
      return { toolName: 'read_knowledge', content };
    } catch (err) {
      return { toolName: 'read_knowledge', content: '', error: err instanceof Error ? err.message : 'Knowledge read failed' };
    }
  },
};

export const createMemoryTool: ToolDefinition = {
  name: 'create_memory',
  description: 'Save important information to long-term memory. Use when the user shares personal preferences, important facts, or asks you to remember something.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The information to remember' },
      type: { type: 'string', description: 'Memory type: preference, fact, instruction, or general' },
      importance: { type: 'string', description: 'Importance 1-10. Default: 5' },
    },
    required: ['content'],
  },
  async execute(args) {
    const content = String(args.content || '');
    const type = String(args.type || 'general');
    const importance = Math.min(10, Math.max(1, parseInt(String(args.importance || '5'), 10) || 5));
    try {
      await db.agentMemory.create({ data: { content, type, importance } });
      return { toolName: 'create_memory', content: `Remembered: ${content}` };
    } catch (err) {
      return { toolName: 'create_memory', content: '', error: err instanceof Error ? err.message : 'Memory creation failed' };
    }
  },
};

export const listSkillsTool: ToolDefinition = {
  name: 'list_skills',
  description: 'List all active skills. Use when asked about available capabilities.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute() {
    try {
      const skills = await db.skill.findMany({ where: { isActive: true } });
      if (skills.length === 0) return { toolName: 'list_skills', content: 'No skills are currently active.' };
      const content = skills.map((s) => `**${s.name}** (${s.category}): ${s.description}`).join('\n');
      return { toolName: 'list_skills', content: `Active skills:\n${content}` };
    } catch (err) {
      return { toolName: 'list_skills', content: '', error: err instanceof Error ? err.message : 'Failed to list skills' };
    }
  },
};

export const getTimeTool: ToolDefinition = {
  name: 'get_time',
  description: 'Get the current date and time for a city or timezone. Use when asked "what time is it in X", "what is today\'s date", or any time/date question.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name or IANA timezone (e.g. "London", "New York", "Europe/Paris"). Use "UTC" for universal time.' },
    },
    required: ['location'],
  },
  async execute(args) {
    const location = String(args.location || 'UTC').trim();
    const cityMap: Record<string, string> = {
      london: 'Europe/London', 'new york': 'America/New_York', 'new york city': 'America/New_York',
      nyc: 'America/New_York', paris: 'Europe/Paris', berlin: 'Europe/Berlin',
      tokyo: 'Asia/Tokyo', sydney: 'Australia/Sydney', dubai: 'Asia/Dubai',
      moscow: 'Europe/Moscow', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai',
      rome: 'Europe/Rome', madrid: 'Europe/Madrid', amsterdam: 'Europe/Amsterdam',
      singapore: 'Asia/Singapore', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles',
      chicago: 'America/Chicago', toronto: 'America/Toronto', milan: 'Europe/Rome',
      istanbul: 'Europe/Istanbul', mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata',
      seoul: 'Asia/Seoul', 'hong kong': 'Asia/Hong_Kong', bangkok: 'Asia/Bangkok',
      jakarta: 'Asia/Jakarta', cairo: 'Africa/Cairo', nairobi: 'Africa/Nairobi',
      'sao paulo': 'America/Sao_Paulo', 'mexico city': 'America/Mexico_City',
      utc: 'UTC', gmt: 'GMT',
    };
    const tz = cityMap[location.toLowerCase()] ?? location;
    try {
      // Pure JS — no external API needed
      const now = new Date();
      const formatted = now.toLocaleString('en-GB', {
        timeZone: tz,
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short',
      });
      return { toolName: 'get_time', content: `Current date & time in **${location}**: ${formatted}` };
    } catch {
      // If tz is invalid, fall back to UTC
      const now = new Date();
      const utc = now.toUTCString();
      return { toolName: 'get_time', content: `Current UTC time: ${utc} (could not resolve timezone for "${location}")` };
    }
  },
};

export const getWeatherTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather, temperature and wind speed for any city. Use when asked about weather, temperature, or conditions in a location.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City or location name, e.g. "London", "Paris"' },
    },
    required: ['location'],
  },
  async execute(args) {
    const location = String(args.location || '').trim();
    if (!location) return { toolName: 'get_weather', content: '', error: 'Location is required' };
    try {
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Weather data unavailable for "${location}"`);
      const data = await res.json();
      const c = data.current_condition?.[0];
      if (!c) throw new Error('No weather data in response');
      const tempC = c.temp_C;
      const tempF = c.temp_F;
      const desc = c.weatherDesc?.[0]?.value ?? 'Unknown';
      const windKmph = c.windspeedKmph;
      const humidity = c.humidity;
      const feelsLike = c.FeelsLikeC;
      return {
        toolName: 'get_weather',
        content: `**Weather in ${location}:**\n- Condition: ${desc}\n- Temperature: ${tempC}°C (${tempF}°F), feels like ${feelsLike}°C\n- Wind: ${windKmph} km/h\n- Humidity: ${humidity}%`,
      };
    } catch (err) {
      return { toolName: 'get_weather', content: '', error: err instanceof Error ? err.message : 'Weather lookup failed' };
    }
  },
};

export const lookupWikipediaTool: ToolDefinition = {
  name: 'lookup_wikipedia',
  description: 'Look up factual information about a person, place, event, concept or any topic on Wikipedia. Use for "who is", "what is", "tell me about" questions.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'The topic to look up, e.g. "Emmanuel Macron", "quantum computing", "Paris"' },
    },
    required: ['topic'],
  },
  async execute(args) {
    const topic = String(args.topic || '').trim();
    if (!topic) return { toolName: 'lookup_wikipedia', content: '', error: 'Topic is required' };
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) {
        // Try a search fallback
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&srlimit=1&origin=*`;
        const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
        if (!sRes.ok) throw new Error(`Wikipedia: no results for "${topic}"`);
        const sData = await sRes.json();
        const firstHit = sData.query?.search?.[0];
        if (!firstHit) throw new Error(`Wikipedia: no results for "${topic}"`);
        // Fetch summary of the first hit
        const url2 = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(firstHit.title)}`;
        const r2 = await fetch(url2, { signal: AbortSignal.timeout(6000) });
        if (!r2.ok) throw new Error(`Wikipedia: could not fetch "${firstHit.title}"`);
        const d2 = await r2.json();
        return { toolName: 'lookup_wikipedia', content: `**${d2.title}**\n${d2.extract}` };
      }
      const data = await res.json();
      return { toolName: 'lookup_wikipedia', content: `**${data.title}**\n${data.extract}` };
    } catch (err) {
      return { toolName: 'lookup_wikipedia', content: '', error: err instanceof Error ? err.message : 'Wikipedia lookup failed' };
    }
  },
};

export const readWebpageTool: ToolDefinition = {
  name: 'read_webpage',
  description: 'Fetch and read the content of any webpage URL. Use when the user shares a link or asks to summarize/read a specific webpage.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The full URL of the webpage to read, e.g. "https://example.com/article"' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = String(args.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return { toolName: 'read_webpage', content: '', error: 'A valid URL starting with http:// or https:// is required' };
    }
    try {
      const readerUrl = `https://r.jina.ai/${url}`;
      const res = await fetch(readerUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'text/plain', 'X-Return-Format': 'markdown' },
      });
      if (!res.ok) throw new Error(`Failed to fetch page (${res.status})`);
      const raw = await res.text();
      const text = raw.replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
      const truncated = raw.length > 3000 ? text + '\n\n[...content truncated]' : text;
      return { toolName: 'read_webpage', content: `**Page content from ${url}:**\n\n${truncated}` };
    } catch (err) {
      return { toolName: 'read_webpage', content: '', error: err instanceof Error ? err.message : 'Failed to read webpage' };
    }
  },
};

export const runCodeTool: ToolDefinition = {
  name: 'run_code',
  description: 'Execute a JavaScript code snippet and return the output. Use for calculations, data transformations, sorting, parsing JSON, math operations, or any pure computation.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute. Use console.log() to output results.' },
    },
    required: ['code'],
  },
  async execute(args) {
    const code = String(args.code || '').trim();
    if (!code) return { toolName: 'run_code', content: '', error: 'Code is required' };
    const blocked = /\b(require|import\s*\(|fetch|XMLHttpRequest|child_process|exec|spawn|fs\b|path\b|os\b|net\b|eval|Function\s*\(|process\.exit|__dirname|__filename)\b/.test(code);
    if (blocked) {
      return { toolName: 'run_code', content: '', error: 'Code uses restricted APIs. Only pure computation is allowed (Math, Array, String, Object, JSON, Date, console.log).' };
    }
    try {
      const vm = await import('vm');
      const output: string[] = [];
      const context = vm.createContext({
        console: {
          log: (...a: unknown[]) => output.push(a.map(String).join(' ')),
          error: (...a: unknown[]) => output.push('[err] ' + a.map(String).join(' ')),
        },
        Math, JSON, parseInt, parseFloat, isNaN, isFinite,
        Array, Object, String, Number, Boolean, Date, Error, Set, Map, RegExp,
      });
      vm.runInContext(code, context, { timeout: 5000 });
      const result = output.join('\n') || '(no output — use console.log() to print results)';
      return { toolName: 'run_code', content: `**Code output:**\n\`\`\`\n${result.slice(0, 2000)}\n\`\`\`` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution error';
      return { toolName: 'run_code', content: '', error: `Code execution failed: ${msg}` };
    }
  },
};

export const saveNoteTool: ToolDefinition = {
  name: 'save_note',
  description: 'Save a named note for later retrieval. Use when the user asks to remember something with a specific name, like "save this as my project plan" or "remember this as interview prep".',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short unique title/name for the note, e.g. "project alpha", "interview prep"' },
      content: { type: 'string', description: 'The content to save in the note' },
    },
    required: ['title', 'content'],
  },
  async execute(args) {
    const title = String(args.title || '').trim().slice(0, 100);
    const content = String(args.content || '').trim();
    if (!title || !content) return { toolName: 'save_note', content: '', error: 'Both title and content are required' };
    try {
      await db.note.upsert({
        where: { title },
        update: { content, updatedAt: new Date() },
        create: { title, content },
      });
      return { toolName: 'save_note', content: `Note saved: **"${title}"**` };
    } catch (err) {
      return { toolName: 'save_note', content: '', error: err instanceof Error ? err.message : 'Failed to save note' };
    }
  },
};

export const readNotesTool: ToolDefinition = {
  name: 'read_notes',
  description: 'Read saved notes by title or search for notes matching a query. Use when asked to retrieve a saved note, show notes about a topic, or list all notes.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Note title or keyword to search for. Leave empty to list all notes.' },
    },
  },
  async execute(args) {
    const query = String(args.query || '').trim().toLowerCase();
    try {
      const notes = await db.note.findMany({ orderBy: { updatedAt: 'desc' } });
      if (notes.length === 0) return { toolName: 'read_notes', content: 'No notes saved yet.' };
      const filtered = query
        ? notes.filter((n) => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
        : notes;
      if (filtered.length === 0) return { toolName: 'read_notes', content: `No notes found matching "${query}".` };
      const content = filtered
        .map((n) => `## ${n.title}\n${n.content.slice(0, 500)}${n.content.length > 500 ? '\n[...]' : ''}`)
        .join('\n\n---\n\n');
      return { toolName: 'read_notes', content: `**Notes:**\n\n${content}` };
    } catch (err) {
      return { toolName: 'read_notes', content: '', error: err instanceof Error ? err.message : 'Failed to read notes' };
    }
  },
};

// ── File System Tools ────────────────────────────────────────────────────────
import fs from 'fs/promises';
import path from 'path';
import { spawnProjectShellCommand } from '@/lib/script-executor';

/** Resolve and validate a path stays within the allowed workspace root */
async function resolveWorkspacePath(userPath: string): Promise<{ abs: string; root: string } | null> {
  try {
    const setting = await db.settings.findUnique({ where: { key: 'workspace_root' } });
    const root = setting?.value?.trim() || '';
    if (!root) return null;
    const abs = path.resolve(root, userPath.replace(/^[/\\]+/, ''));
    // Guard against path traversal
    if (!abs.startsWith(path.resolve(root))) return null;
    return { abs, root: path.resolve(root) };
  } catch { return null; }
}

export const fsReadFileTool: ToolDefinition = {
  name: 'fs_read_file',
  description: 'Read the contents of a file in the configured workspace. Use when asked to read, view, or inspect a file or piece of code.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to file from the workspace root, e.g. "src/app/page.tsx"' },
      start_line: { type: 'integer', description: 'First line to read (1-based). Omit to read from start.' },
      end_line: { type: 'integer', description: 'Last line to read (1-based). Omit to read to end.' },
    },
    required: ['path'],
  },
  async execute(args) {
    const resolved = await resolveWorkspacePath(String(args.path || ''));
    if (!resolved) return { toolName: 'fs_read_file', content: '', error: 'Workspace root not configured. Go to Settings → Workspace Path and set the folder path.' };
    try {
      const raw = await fs.readFile(resolved.abs, 'utf-8');
      let lines = raw.split('\n');
      const start = args.start_line ? Number(args.start_line) - 1 : 0;
      const end = args.end_line ? Number(args.end_line) : lines.length;
      lines = lines.slice(start, end);
      const ext = path.extname(resolved.abs).slice(1) || 'text';
      const display = args.start_line ? `(lines ${args.start_line}–${Math.min(Number(args.end_line || lines.length + start), raw.split('\n').length)})` : '';
      return { toolName: 'fs_read_file', content: `**${args.path}** ${display}\n\`\`\`${ext}\n${lines.join('\n')}\n\`\`\`` };
    } catch (err) {
      return { toolName: 'fs_read_file', content: '', error: `Cannot read file: ${err instanceof Error ? err.message : err}` };
    }
  },
};

export const fsWriteFileTool: ToolDefinition = {
  name: 'fs_write_file',
  description: 'Write a file to the LOCAL FILESYSTEM workspace (requires workspace path setting). NOT for creating projects \u2014 use create_script_project for that.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to file from workspace root, e.g. "src/utils/helper.ts"' },
      content: { type: 'string', description: 'Full file contents to write' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const resolved = await resolveWorkspacePath(String(args.path || ''));
    if (!resolved) return { toolName: 'fs_write_file', content: '', error: 'Workspace root not configured. Go to Settings → Workspace Path.' };
    try {
      await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
      await fs.writeFile(resolved.abs, String(args.content), 'utf-8');
      return { toolName: 'fs_write_file', content: `✅ Wrote **${args.path}** (${String(args.content).split('\n').length} lines)` };
    } catch (err) {
      return { toolName: 'fs_write_file', content: '', error: `Cannot write file: ${err instanceof Error ? err.message : err}` };
    }
  },
};

export const openWorkspaceFileInIdeTool: ToolDefinition = {
  name: 'open_workspace_file_in_ide',
  description: 'Import a file from the configured local workspace into the NOVA IDE and open it there. Use when the user wants a local file opened, previewed, or edited inside the IDE.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from workspace root, e.g. "index.html" or "src/app/page.tsx"' },
      projectName: { type: 'string', description: 'Optional IDE project name to use for the imported file.' },
    },
    required: ['path'],
  },
  async execute(args) {
    const targetPath = String(args.path || '').trim();
    const resolved = await resolveWorkspacePath(targetPath);
    if (!resolved) {
      return { toolName: 'open_workspace_file_in_ide', content: '', error: 'Workspace root not configured. Go to Settings -> Workspace Path.' };
    }

    try {
      const rawContent = await fs.readFile(resolved.abs, 'utf-8');
      const normalizedPath = targetPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const folderParts = normalizedPath.split('/').slice(0, -1);
      const folders: { path: string }[] = [];
      let currentFolder = '';
      for (const segment of folderParts) {
        currentFolder = currentFolder ? `${currentFolder}/${segment}` : segment;
        folders.push({ path: currentFolder });
      }

      const projectName = String(args.projectName || path.basename(normalizedPath) || 'Imported File').slice(0, 120);
      const language = detectLang(normalizedPath);
      const safeContent = (language === 'html' || /\.html?$/i.test(normalizedPath))
        ? applyHtmlResponsiveGuard(rawContent)
        : rawContent;

      const project = await db.scriptProject.create({
        data: {
          name: projectName,
          description: `Imported from workspace path ${normalizedPath}`,
          folders: folders.length > 0 ? { create: folders.map((folder) => ({ path: folder.path })) } : undefined,
          files: {
            create: [{
              path: normalizedPath,
              language,
              content: safeContent,
            }],
          },
        },
        include: { files: { select: { id: true, path: true } } },
      });

      return {
        toolName: 'open_workspace_file_in_ide',
        content: `Opened **${normalizedPath}** in IDE project **${project.name}**.\n\n__ide_project_id:${project.id}`,
      };
    } catch (err) {
      return {
        toolName: 'open_workspace_file_in_ide',
        content: '',
        error: `Could not import file into IDE: ${err instanceof Error ? err.message : err}`,
      };
    }
  },
};

export const fsEditFileTool: ToolDefinition = {
  name: 'fs_edit_file',
  description: 'Edit a file by replacing an exact string with new content. Safer than overwriting the whole file. Use for targeted edits.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from workspace root' },
      old_str: { type: 'string', description: 'The exact text to find and replace (must be unique in file)' },
      new_str: { type: 'string', description: 'The replacement text' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  async execute(args) {
    const resolved = await resolveWorkspacePath(String(args.path || ''));
    if (!resolved) return { toolName: 'fs_edit_file', content: '', error: 'Workspace root not configured.' };
    try {
      const original = await fs.readFile(resolved.abs, 'utf-8');
      const oldStr = String(args.old_str);
      const count = (original.split(oldStr).length - 1);
      if (count === 0) return { toolName: 'fs_edit_file', content: '', error: `String not found in ${args.path}. Make sure old_str matches exactly.` };
      if (count > 1) return { toolName: 'fs_edit_file', content: '', error: `old_str matched ${count} times in ${args.path}. Make it more specific.` };
      const updated = original.replace(oldStr, String(args.new_str));
      await fs.writeFile(resolved.abs, updated, 'utf-8');
      return { toolName: 'fs_edit_file', content: `✅ Edited **${args.path}** — replaced 1 occurrence` };
    } catch (err) {
      return { toolName: 'fs_edit_file', content: '', error: `Edit failed: ${err instanceof Error ? err.message : err}` };
    }
  },
};

export const fsListDirTool: ToolDefinition = {
  name: 'fs_list_dir',
  description: 'List files in the LOCAL FILESYSTEM workspace (requires workspace path setting). NOT for creating projects — use create_script_project instead.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to directory from workspace root. Use "." for root.' },
      recursive: { type: 'boolean', description: 'If true, list all nested files too (depth limited to 3). Default false.' },
    },
    required: ['path'],
  },
  async execute(args) {
    const dirPath = String(args.path || '.').trim() || '.';
    const resolved = await resolveWorkspacePath(dirPath === '.' ? '' : dirPath);
    if (!resolved) return { toolName: 'fs_list_dir', content: '', error: 'Workspace root not set. If you want to CREATE a project, use create_script_project instead. To browse local files, set a workspace path in Settings.' };
    const targetDir = dirPath === '.' ? resolved.root : resolved.abs;
    try {
      const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage', '.cache']);
      async function listDir(dir: string, indent: number, maxDepth: number): Promise<string[]> {
        if (indent > maxDepth) return [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const lines: string[] = [];
        for (const e of entries.sort((a, b) => (b.isDirectory() ? 1 : 0) - (a.isDirectory() ? 1 : 0) || a.name.localeCompare(b.name))) {
          if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
          lines.push(`${'  '.repeat(indent)}${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
          if (e.isDirectory() && args.recursive && indent < maxDepth) {
            lines.push(...await listDir(path.join(dir, e.name), indent + 1, maxDepth));
          }
        }
        return lines;
      }
      const lines = await listDir(targetDir, 0, args.recursive ? 3 : 1);
      return { toolName: 'fs_list_dir', content: `**${dirPath}/**\n${lines.join('\n') || '(empty directory)'}` };
    } catch (err) {
      return { toolName: 'fs_list_dir', content: '', error: `Cannot list directory: ${err instanceof Error ? err.message : err}` };
    }
  },
};

export const fsDeleteFileTool: ToolDefinition = {
  name: 'fs_delete_file',
  description: 'Delete a file from the workspace. Only use when explicitly asked to delete a file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path from workspace root' },
    },
    required: ['path'],
  },
  async execute(args) {
    const resolved = await resolveWorkspacePath(String(args.path || ''));
    if (!resolved) return { toolName: 'fs_delete_file', content: '', error: 'Workspace root not configured.' };
    try {
      const stat = await fs.stat(resolved.abs);
      if (stat.isDirectory()) return { toolName: 'fs_delete_file', content: '', error: 'That path is a directory. Only individual files can be deleted.' };
      await fs.unlink(resolved.abs);
      return { toolName: 'fs_delete_file', content: `🗑️ Deleted **${args.path}**` };
    } catch (err) {
      return { toolName: 'fs_delete_file', content: '', error: `Delete failed: ${err instanceof Error ? err.message : err}` };
    }
  },
};

const SAFE_COMMAND_BINARIES = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'python',
  'python3',
  'py',
  'pip',
  'pip3',
  'uv',
  'pytest',
  'ruff',
  'eslint',
  'tsc',
  'vite',
  'next',
  'git',
  'ls',
  'dir',
  'cat',
  'type',
  'echo',
  'pwd',
  'whoami',
]);

function parseCommandBinary(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const first = trimmed.match(/^[^\s]+/)?.[0] || '';
  return first.replace(/^['"]|['"]$/g, '').toLowerCase();
}

function validateWorkspaceCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return 'Command is required.';
  if (/[;&|><]/.test(trimmed)) {
    return 'Command chaining and redirection are not allowed in this tool.';
  }
  if (/\b(rm\s+-rf|rmdir\s+\/s|del\s+\/f\s+\/s\s+\/q|format\s+|shutdown\s+|reboot\s+|mkfs|diskpart)\b/i.test(trimmed)) {
    return 'Dangerous system-level commands are blocked.';
  }
  if (/\bgit\s+(reset\s+--hard|clean\s+-fd|checkout\s+--)\b/i.test(trimmed)) {
    return 'Destructive git commands are blocked.';
  }

  const binary = parseCommandBinary(trimmed);
  if (!SAFE_COMMAND_BINARIES.has(binary)) {
    return `Command "${binary || '(unknown)'}" is not on the workspace-safe allowlist.`;
  }

  return null;
}

export const fsRunCommandTool: ToolDefinition = {
  name: 'fs_run_command',
  description: 'Run a safe shell command inside the configured workspace root. Use for build/test/run workflows in normal chat when command execution is explicitly requested.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Single command to execute, e.g. "npm test" or "python main.py".' },
      timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (1000-120000). Default 20000.' },
    },
    required: ['command'],
  },
  async execute(args) {
    const command = String(args.command || '').trim();
    const validationError = validateWorkspaceCommand(command);
    if (validationError) {
      return { toolName: 'fs_run_command', content: '', error: validationError };
    }

    const resolved = await resolveWorkspacePath('');
    if (!resolved) {
      return { toolName: 'fs_run_command', content: '', error: 'Workspace root not configured. Set it in Settings first.' };
    }

    const timeoutMs = Math.min(120000, Math.max(1000, Number(args.timeout_ms) || 20000));
    const child = spawnProjectShellCommand({ command, workspaceDir: resolved.root });
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const result = await new Promise<{ error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ error: error.message || 'Failed to start command.' });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ error: `Command timed out after ${timeoutMs}ms.` });
          return;
        }
        if (code && code !== 0) {
          resolve({ error: stderr.trim() || `Command exited with code ${code}.` });
          return;
        }
        resolve({});
      });
    });

    const durationMs = Date.now() - startedAt;
    const output = (stdout || stderr || '(no output)').trim();
    if (result.error) {
      return {
        toolName: 'fs_run_command',
        content: output.slice(0, 100000),
        error: result.error,
      };
    }

    return {
      toolName: 'fs_run_command',
      content: `${output.slice(0, 100000)}\n\n[command finished in ${durationMs}ms]`,
    };
  },
};

// ── Helper: load a connection token from DB ─────────────────────────────────
import { decryptToken } from '@/lib/crypto';

async function getConnectionToken(service: string): Promise<string | null> {
  try {
    const conn = await db.connection.findUnique({ where: { service }, select: { accessToken: true } });
    if (!conn?.accessToken) return null;
    return decryptToken(conn.accessToken) || null;
  } catch { return null; }
}

// ── GitHub Tools ─────────────────────────────────────────────────────────────

export const githubSearchReposTool: ToolDefinition = {
  name: 'github_search_repos',
  description: 'Search GitHub repositories. Use when asked to find repos, explore open-source projects, or look up GitHub repositories.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query, e.g. "react state management stars:>1000"' },
      limit: { type: 'integer', description: 'Max results to return (1-10). Default: 5' },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query || '').trim();
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
    const token = await getConnectionToken('github');
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NovaAI' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
      const data = await res.json();
      const items = data.items ?? [];
      if (!items.length) return { toolName: 'github_search_repos', content: `No repositories found for "${query}"` };
      const lines = items.map((r: { full_name: string; description?: string; stargazers_count: number; language?: string; html_url: string }) =>
        `**[${r.full_name}](${r.html_url})** ⭐${r.stargazers_count.toLocaleString()}${r.language ? ` · ${r.language}` : ''}\n${r.description || ''}`
      );
      return { toolName: 'github_search_repos', content: `**GitHub repos for "${query}":**\n\n${lines.join('\n\n')}` };
    } catch (err) {
      return { toolName: 'github_search_repos', content: '', error: err instanceof Error ? err.message : 'GitHub search failed' };
    }
  },
};

export const githubGetRepoTool: ToolDefinition = {
  name: 'github_get_repo',
  description: 'Get details, README, and stats for a specific GitHub repository. Use when asked about a specific repo like "owner/repo".',
  parameters: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Repository in "owner/repo" format, e.g. "vercel/next.js"' },
    },
    required: ['repo'],
  },
  async execute(args) {
    const repo = String(args.repo || '').trim().replace(/^https?:\/\/github\.com\//, '');
    if (!repo.includes('/')) return { toolName: 'github_get_repo', content: '', error: 'Use "owner/repo" format' };
    const token = await getConnectionToken('github');
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NovaAI' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const [repoRes, readmeRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo}`, { headers, signal: AbortSignal.timeout(8000) }),
        fetch(`https://api.github.com/repos/${repo}/readme`, { headers, signal: AbortSignal.timeout(8000) }),
      ]);
      if (!repoRes.ok) throw new Error(`Repo not found: ${repo}`);
      const d = await repoRes.json();
      let readme = '';
      if (readmeRes.ok) {
        const rd = await readmeRes.json();
        readme = Buffer.from(rd.content, 'base64').toString('utf8').slice(0, 1200);
      }
      const lines = [
        `# ${d.full_name}`,
        d.description || '',
        `⭐ ${d.stargazers_count.toLocaleString()} stars · 🍴 ${d.forks_count.toLocaleString()} forks · ${d.language || 'N/A'}`,
        `Topics: ${(d.topics || []).join(', ') || 'none'}`,
        `License: ${d.license?.name || 'none'} · Last push: ${d.pushed_at?.slice(0, 10) || 'unknown'}`,
        readme ? `\n**README (excerpt):**\n${readme}${readme.length >= 1200 ? '\n[...]' : ''}` : '',
      ].filter(Boolean);
      return { toolName: 'github_get_repo', content: lines.join('\n') };
    } catch (err) {
      return { toolName: 'github_get_repo', content: '', error: err instanceof Error ? err.message : 'Failed to get repo' };
    }
  },
};

export const githubCreateIssueTool: ToolDefinition = {
  name: 'github_create_issue',
  description: 'Create a GitHub issue in a repository. Requires a connected GitHub account with repo write access.',
  parameters: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Repository in "owner/repo" format' },
      title: { type: 'string', description: 'Issue title' },
      body: { type: 'string', description: 'Issue body/description (markdown supported)' },
      labels: { type: 'string', description: 'Comma-separated labels, e.g. "bug,help wanted"' },
    },
    required: ['repo', 'title'],
  },
  async execute(args) {
    const repo = String(args.repo || '').trim();
    const title = String(args.title || '').trim();
    const body = String(args.body || '').trim();
    const labels = String(args.labels || '').split(',').map((l) => l.trim()).filter(Boolean);
    const token = await getConnectionToken('github');
    if (!token) return { toolName: 'github_create_issue', content: '', error: 'GitHub not connected. Go to Settings → Connections to add your token.' };
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'NovaAI', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, labels }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || res.statusText);
      }
      const issue = await res.json();
      return { toolName: 'github_create_issue', content: `✅ Issue created: **[#${issue.number} ${issue.title}](${issue.html_url})**` };
    } catch (err) {
      return { toolName: 'github_create_issue', content: '', error: err instanceof Error ? err.message : 'Failed to create issue' };
    }
  },
};

export const githubListMyReposTool: ToolDefinition = {
  name: 'github_list_my_repos',
  description: 'List repositories owned by the connected GitHub account. Requires a connected GitHub account.',
  parameters: {
    type: 'object',
    properties: {
      sort: { type: 'string', description: 'Sort by: "updated" (default), "created", "pushed", "full_name"' },
      limit: { type: 'integer', description: 'Max repos to return (1-20). Default: 10' },
    },
  },
  async execute(args) {
    const token = await getConnectionToken('github');
    if (!token) return { toolName: 'github_list_my_repos', content: '', error: 'GitHub not connected. Go to Settings → Connections.' };
    const sort = ['updated', 'created', 'pushed', 'full_name'].includes(String(args.sort)) ? String(args.sort) : 'updated';
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    try {
      const res = await fetch(`https://api.github.com/user/repos?sort=${sort}&per_page=${limit}&affiliation=owner`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'NovaAI' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(res.statusText);
      const repos = await res.json();
      if (!repos.length) return { toolName: 'github_list_my_repos', content: 'No repositories found.' };
      const lines = repos.map((r: { name: string; description?: string; language?: string; stargazers_count: number; private: boolean; html_url: string }) =>
        `- **[${r.name}](${r.html_url})**${r.private ? ' 🔒' : ''} ${r.language ? `· ${r.language}` : ''} ${r.stargazers_count ? `⭐${r.stargazers_count}` : ''}\n  ${r.description || ''}`
      );
      return { toolName: 'github_list_my_repos', content: `**Your GitHub repositories:**\n\n${lines.join('\n')}` };
    } catch (err) {
      return { toolName: 'github_list_my_repos', content: '', error: err instanceof Error ? err.message : 'Failed to list repos' };
    }
  },
};

// ── Google Tools ─────────────────────────────────────────────────────────────

export const googleSearchTool: ToolDefinition = {
  name: 'google_search',
  description: 'Search Google and get results. When connected, uses your Google account for better results. Falls back to public search otherwise.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query || '').trim();
    if (!query) return { toolName: 'google_search', content: '', error: 'Query is required' };
    // Use the Jina.ai Google reader for a clean extract (works without API key)
    try {
      const url = `https://r.jina.ai/https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`;
      const res = await fetch(url, { headers: { Accept: 'text/plain', 'X-Return-Format': 'markdown' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error('Search request failed');
      const text = res.ok ? (await res.text()).slice(0, 3000) : '';
      return { toolName: 'google_search', content: `**Google results for "${query}":**\n\n${text}` };
    } catch (err) {
      return { toolName: 'google_search', content: '', error: err instanceof Error ? err.message : 'Google search failed' };
    }
  },
};

export const googleListEmailsTool: ToolDefinition = {
  name: 'google_list_emails',
  description: 'List recent emails from Gmail. Requires a connected Google account with Gmail access.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query, e.g. "is:unread", "from:boss@work.com". Leave empty for latest.' },
      limit: { type: 'integer', description: 'Max emails to return (1-10). Default: 5' },
    },
  },
  async execute(args) {
    const token = await getConnectionToken('google');
    if (!token) return { toolName: 'google_list_emails', content: '', error: 'Google not connected. Go to Settings → Connections to add your token.' };
    const q = encodeURIComponent(String(args.query || '').trim());
    const maxResults = Math.min(10, Math.max(1, Number(args.limit) || 5));
    try {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${q}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
      );
      if (!listRes.ok) {
        const e = await listRes.json();
        throw new Error(e.error?.message || listRes.statusText);
      }
      const { messages = [] } = await listRes.json();
      if (!messages.length) return { toolName: 'google_list_emails', content: 'No emails found.' };

      const details = await Promise.all(
        messages.slice(0, maxResults).map(async (m: { id: string }) => {
          const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
          if (!r.ok) return null;
          const d = await r.json();
          const headers: Array<{ name: string; value: string }> = d.payload?.headers || [];
          const get = (name: string) => headers.find((h) => h.name === name)?.value || '';
          return `- **${get('Subject') || '(no subject)'}**\n  From: ${get('From')} · ${get('Date').slice(0, 16)}`;
        })
      );
      return { toolName: 'google_list_emails', content: `**Recent emails:**\n\n${details.filter(Boolean).join('\n')}` };
    } catch (err) {
      return { toolName: 'google_list_emails', content: '', error: err instanceof Error ? err.message : 'Failed to list emails' };
    }
  },
};

export const googleListCalendarTool: ToolDefinition = {
  name: 'google_calendar_events',
  description: 'List upcoming Google Calendar events. Requires a connected Google account with Calendar access.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'integer', description: 'How many days ahead to look. Default: 7' },
    },
  },
  async execute(args) {
    const token = await getConnectionToken('google');
    if (!token) return { toolName: 'google_calendar_events', content: '', error: 'Google not connected. Go to Settings → Connections.' };
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const now = new Date();
    const end = new Date(now.getTime() + days * 86400000);
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=15`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error?.message || res.statusText);
      }
      const { items = [] } = await res.json();
      if (!items.length) return { toolName: 'google_calendar_events', content: `No events in the next ${days} days.` };
      const lines = items.map((ev: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }) => {
        const start = ev.start?.dateTime || ev.start?.date || '';
        const d = start ? new Date(start).toLocaleString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `- **${ev.summary || '(no title)'}** — ${d}${ev.location ? ` · 📍 ${ev.location}` : ''}`;
      });
      return { toolName: 'google_calendar_events', content: `**Upcoming events (next ${days} days):**\n\n${lines.join('\n')}` };
    } catch (err) {
      return { toolName: 'google_calendar_events', content: '', error: err instanceof Error ? err.message : 'Failed to get calendar events' };
    }
  },
};

// ── IDE: create a full script project with multiple files ──────────────────────
export const createScriptProjectTool: ToolDefinition = {
  name: 'create_script_project',
  description:
    'Create a new code project in the NOVA IDE. Generates multiple files with full content, saves them to the database, and opens the IDE automatically. Use this when the user asks to build, create, or scaffold any code project, app, or script. For website requests that ask for a single file, create one file at path "index.html".',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short project name, e.g. "Todo App" or "Data Pipeline". Alias accepted: title.' },
      title: { type: 'string', description: 'Alias for name. If provided, used as project name when name is missing.' },
      description: { type: 'string', description: 'One-sentence description of what the project does' },
      files: {
        type: 'array',
        description:
          'Array of file objects, each with path/name, language, and content. Example: [{"path":"index.html","language":"html","content":"<!DOCTYPE html>..."}]. Pass as a real JSON array — do NOT serialize it as a string.',
      },
    },
    required: ['files'],
  },
  async execute(args) {
    const name = String(args.name || args.title || 'New Project').slice(0, 120);
    const description = String(args.description || '').slice(0, 500);
    let files: Array<{ path?: unknown; name?: unknown; filename?: unknown; language?: unknown; content?: unknown }> = [];

    // Accept either an already-parsed array or a JSON string
    if (Array.isArray(args.files)) {
      files = args.files as Array<{ path?: unknown; name?: unknown; filename?: unknown; language?: unknown; content?: unknown }>;
    } else {
      try {
        files = JSON.parse(String(args.files || '[]'));
        if (!Array.isArray(files)) files = [];
      } catch {
        return { toolName: 'create_script_project', content: '', error: 'Invalid files value. Pass an array: [{"path":"index.html","language":"html","content":"..."}].' };
      }
    }

    if (files.length === 0) {
      return { toolName: 'create_script_project', content: '', error: 'At least one file is required.' };
    }

    try {
      const normalizedFiles = normalizeProjectFiles(files);
      const { db } = await import('@/lib/db');
      const project = await db.scriptProject.create({
        data: {
          name,
          description,
          files: {
            create: normalizedFiles.map((f) => ({
              path: f.path.slice(0, 260),
              language: f.language,
              content: f.content,
            })),
          },
        },
        include: { files: { select: { id: true, path: true } } },
      });

      const fileList = project.files.map((f) => `• \`${f.path}\``).join('\n');
      // __ide_project_id marker is parsed by the stream route to emit ide_open SSE
      return {
        toolName: 'create_script_project',
        content: `Project **${name}** created with ${project.files.length} file(s):\n${fileList}\n\n__ide_project_id:${project.id}`,
      };
    } catch (err) {
      return { toolName: 'create_script_project', content: '', error: err instanceof Error ? err.message : 'Failed to create project' };
    }
  },
};

function detectLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const m: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'html', css: 'css', json: 'json', md: 'markdown', py: 'python' };
  return m[ext] || 'plaintext';
}

function looksLikeHtmlDocument(content: string): boolean {
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(content);
}

function applyHtmlResponsiveGuard(content: string): string {
  return applySharedResponsiveHtmlGuard(content, 'Nova Project Preview');
}

function normalizeProjectFiles(
  files: Array<{ path?: unknown; name?: unknown; filename?: unknown; language?: unknown; content?: unknown }>,
): Array<{ path: string; language: string; content: string }> {
  return files.map((file, index) => {
    const rawContent = String(file.content ?? '');
    const rawPath = String(file.path ?? file.name ?? file.filename ?? '').trim();
    let path = rawPath;
    const htmlLike = looksLikeHtmlDocument(rawContent);

    if (!path) {
      path = htmlLike ? 'index.html' : `file-${index + 1}.txt`;
    } else if (htmlLike && !/\.(html?|xhtml)$/i.test(path) && !path.includes('.')) {
      path = 'index.html';
    }

    const language = String(file.language ?? (htmlLike ? 'html' : detectLang(path)));
    const safeContent = (language === 'html' || /\.html?$/i.test(path))
      ? applyHtmlResponsiveGuard(rawContent)
      : rawContent;

    return {
      path,
      language,
      content: safeContent,
    };
  });
}

export const allTools: ToolDefinition[] = [
  createScriptProjectTool,
  webSearchTool,
  getEasterTool,
  lookupWikipediaTool,
  readKnowledgeTool,
  createMemoryTool,
  listSkillsTool,
  getTimeTool,
  getWeatherTool,
  readWebpageTool,
  runCodeTool,
  saveNoteTool,
  readNotesTool,
  // File system
  fsReadFileTool,
  fsWriteFileTool,
  openWorkspaceFileInIdeTool,
  fsEditFileTool,
  fsListDirTool,
  fsDeleteFileTool,
  fsRunCommandTool,
  // GitHub
  githubSearchReposTool,
  githubGetRepoTool,
  githubCreateIssueTool,
  githubListMyReposTool,
  googleSearchTool,
  googleListEmailsTool,
  googleListCalendarTool,
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return allTools.find((t) => t.name === name);
}
