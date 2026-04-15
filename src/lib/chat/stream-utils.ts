import type { LLMConfig, LLMMessage, LLMProvider } from '@/lib/llm/types';

export interface RuntimeProfile {
  capabilities: ReturnType<LLMProvider['getCapabilities']>;
  qualityMode: NonNullable<LLMConfig['qualityMode']>;
  responseTokens: number;
  contextWindow: number;
  historyBudget: number;
  compressionThreshold: number;
  compactMode: boolean;
  skipHeavyReasoning: boolean;
  allowModelCompression: boolean;
  allowKnowledgeRerank: boolean;
  allowTaskDecomposition: boolean;
  allowBackgroundIntelligence: boolean;
  promptTokenBudget: number;
  contextCharBudget: number;
  sectionItemLimit: number;
  summaryCharLimit: number;
  recentMessageCharLimit: number;
  olderMessageCharLimit: number;
  maxToolCount: number;
  toolDescriptionLimit: number;
  maxGraphFacts: number;
  maxMemoryItems: number;
  maxKnowledgeItems: number;
  skillDescriptionLimit: number;
  skillInstructionLimit: number;
}

export interface StreamProviderTextResult {
  content: string;
  finishReason?: string;
  usedFallback: boolean;
  reasoningOnly: boolean;
  model?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const PROMPT_ROUTING_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'answer', 'any', 'build', 'can', 'chat', 'code', 'create',
  'data', 'for', 'from', 'help', 'into', 'just', 'make', 'more', 'need', 'only', 'over', 'project',
  'question', 'really', 'should', 'some', 'something', 'that', 'the', 'their', 'them', 'there',
  'these', 'this', 'those', 'tool', 'tools', 'use', 'using', 'want', 'what', 'when', 'where',
  'which', 'with', 'would', 'write', 'your',
]);

function normalizeRoutingText(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\/]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeRoutingText(text: string): string[] {
  const normalized = normalizeRoutingText(text);
  if (!normalized) return [];
  return [...new Set(normalized.split(' ').filter((token) => token.length > 2 && !PROMPT_ROUTING_STOP_WORDS.has(token)))];
}

function hasIntent(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

export function extractInlineToolCall(
  text: string,
  toolNames: string[],
): {
  name: string;
  arguments: Record<string, unknown>;
  rawStart: number;
  rawEnd: number;
} | null {
  const starts = [...text.matchAll(/\{\s*\"name\"\s*:/g)]
    .map((match) => match.index)
    .filter((value): value is number => typeof value === 'number');

  for (const start of starts) {
    const end = findJsonObjectEnd(text, start);
    if (end === -1) continue;

    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      if (typeof obj.name !== 'string' || !toolNames.includes(obj.name)) continue;
      if (!obj.arguments || typeof obj.arguments !== 'object') continue;

      return {
        name: obj.name,
        arguments: obj.arguments as Record<string, unknown>,
        rawStart: start,
        rawEnd: end,
      };
    } catch {
      // Keep scanning for the next plausible object boundary.
    }
  }

  return null;
}

export function isWebsiteBuildIntent(input: string): boolean {
  const text = input.toLowerCase();
  const asksToBuild = /\b(create|build|generate|make|design|code|scaffold)\b/.test(text);
  const webTarget = /\b(website|web page|web app|landing page|homepage|portfolio|single html|one html|html file|index\.html)\b/.test(text);
  return asksToBuild && webTarget;
}

export function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildRuntimeProfile(
  config: LLMConfig,
  provider: LLMProvider,
  reduceLoad: boolean,
): RuntimeProfile {
  const capabilities = provider.getCapabilities();
  const qualityMode = config.qualityMode ?? (capabilities.isLocal ? 'balanced' : 'high-quality');
  const modelName = (config.model || '').toLowerCase();
  const isFreeTierModel = /\bfree\b/.test(modelName);
  const isBudgetSensitive = reduceLoad || capabilities.isLocal || qualityMode !== 'high-quality' || isFreeTierModel;
  const responseTokens = clamp(
    reduceLoad
      ? Math.max(256, Math.floor((config.maxTokens ?? capabilities.recommendedMaxTokens) / 2))
      : (config.maxTokens ?? capabilities.recommendedMaxTokens),
    256,
    isFreeTierModel ? 8_192 : 32_768,
  );
  const requestedContextWindow = config.contextWindow ?? capabilities.defaultContextWindow;
  const contextWindow = clamp(
    reduceLoad
      ? Math.max(4_096, Math.floor(requestedContextWindow * 0.75))
      : requestedContextWindow,
    2_048,
    capabilities.maxContextWindow,
  );
  const recommendedHistory = config.historyBudget ?? capabilities.recommendedHistoryMessages;
  const historyBudget = clamp(
    isBudgetSensitive
      ? Math.min(
          reduceLoad ? 10 : (capabilities.isLocal ? 12 : 14),
          Math.max(6, Math.floor(recommendedHistory * (reduceLoad ? 0.55 : 0.7))),
        )
      : recommendedHistory,
    4,
    96,
  );
  const compressionThreshold = clamp(
    Math.max(
      historyBudget + 2,
      reduceLoad
        ? Math.floor((config.compressionThreshold ?? capabilities.recommendedCompressionThreshold) * 0.8)
        : (config.compressionThreshold ?? capabilities.recommendedCompressionThreshold),
    ),
    6,
    96,
  );
  const compactMode =
    reduceLoad ||
    qualityMode === 'local-safe' ||
    qualityMode === 'balanced' ||
    capabilities.isLocal ||
    isFreeTierModel ||
    contextWindow <= 16_384;
  const skipHeavyReasoning =
    compactMode ||
    qualityMode !== 'high-quality' ||
    isFreeTierModel ||
    responseTokens <= 1_024;
  const maxPromptByWindow = Math.max(1_200, contextWindow - responseTokens - 1_024);
  const targetPromptBudget = reduceLoad
    ? 1_800
    : capabilities.isLocal
      ? (qualityMode === 'high-context' ? 8_000 : qualityMode === 'high-quality' ? 6_000 : 4_000)
      : qualityMode === 'high-context'
        ? 24_000
        : qualityMode === 'high-quality'
          ? 16_000
          : 9_000;
  const promptTokenBudget = clamp(
    Math.min(targetPromptBudget, maxPromptByWindow),
    1_200,
    Math.min(maxPromptByWindow, capabilities.isLocal ? 24_000 : 64_000),
  );
  const contextCharBudget = clamp(
    Math.floor(promptTokenBudget * (compactMode ? 2.2 : 3.2)),
    2_400,
    180_000,
  );
  const allowBackgroundIntelligence = !skipHeavyReasoning && !isFreeTierModel;
  const expansiveContext = !reduceLoad && promptTokenBudget >= 16_000;

  return {
    capabilities,
    qualityMode,
    responseTokens,
    contextWindow,
    historyBudget,
    compressionThreshold,
    compactMode,
    skipHeavyReasoning,
    allowModelCompression: !isBudgetSensitive,
    allowKnowledgeRerank: !skipHeavyReasoning,
    allowTaskDecomposition: !skipHeavyReasoning,
    allowBackgroundIntelligence,
    promptTokenBudget,
    contextCharBudget,
    sectionItemLimit: compactMode ? (expansiveContext ? 220 : 110) : (expansiveContext ? 700 : 220),
    summaryCharLimit: compactMode ? (expansiveContext ? 1_200 : 650) : (expansiveContext ? 5_000 : 1_500),
    recentMessageCharLimit: compactMode ? (expansiveContext ? 1_200 : 700) : (expansiveContext ? 6_000 : 1_400),
    olderMessageCharLimit: compactMode ? (expansiveContext ? 600 : 260) : (expansiveContext ? 2_800 : 520),
    maxToolCount: compactMode ? 6 : 10,
    toolDescriptionLimit: compactMode ? 84 : 140,
    maxGraphFacts: compactMode ? 4 : 8,
    maxMemoryItems: compactMode ? (expansiveContext ? 5 : 3) : (expansiveContext ? 12 : 5),
    maxKnowledgeItems: compactMode ? (expansiveContext ? 4 : 2) : (expansiveContext ? 8 : 3),
    skillDescriptionLimit: compactMode ? (expansiveContext ? 280 : 180) : (expansiveContext ? 900 : 320),
    skillInstructionLimit: compactMode ? (expansiveContext ? 900 : 500) : (expansiveContext ? 2_600 : 1_200),
  };
}

export interface ToolLike {
  name: string;
  description: string;
}

function scoreTool(tool: ToolLike, message: string, preferredNames: Set<string>): number {
  const normalizedMessage = normalizeRoutingText(message);
  const tokens = tokenizeRoutingText(message);
  const haystack = normalizeRoutingText(`${tool.name} ${tool.description}`);
  const toolNameTokens = tokenizeRoutingText(tool.name);
  let score = 0;

  if (preferredNames.has(tool.name)) score += 100;
  if (normalizedMessage.includes(normalizeRoutingText(tool.name))) score += 40;

  for (const token of tokens) {
    if (toolNameTokens.includes(token)) {
      score += 18;
    } else if (haystack.includes(token)) {
      score += 6;
    }
  }

  if (hasIntent(message, /\b(weather|forecast|temperature|wind|humidity|rain|snow|storm)\b/i) && /\bweather\b/.test(haystack)) score += 24;
  if (hasIntent(message, /\b(time|date|timezone|clock)\b/i) && /\btime\b/.test(haystack)) score += 24;
  if (hasIntent(message, /\b(search|research|latest|current|today|news|price|prices|stock|stocks|crypto|bitcoin|ethereum)\b/i) && /\b(search|webpage|wikipedia|google)\b/.test(haystack)) score += 20;
  if (hasIntent(message, /\b(code|python|javascript|typescript|debug|bug|script|run)\b/i) && /\b(run code|code|file|filesystem)\b/.test(haystack)) score += 18;
  if (hasIntent(message, /\b(github|repository|repo|pull request|issue|commit|branch)\b/i) && /\bgithub\b/.test(haystack)) score += 20;
  if (hasIntent(message, /\b(email|mail|calendar|meeting|event)\b/i) && /\b(email|calendar)\b/.test(haystack)) score += 18;

  return score;
}

export function selectRelevantTools<T extends ToolLike>(
  tools: T[],
  message: string,
  runtimeProfile: RuntimeProfile,
  preferredToolNames: string[] = [],
): T[] {
  if (tools.length === 0) return [];

  const preferred = new Set(preferredToolNames);
  const scored = tools
    .map((tool) => ({ tool, score: scoreTool(tool, message, preferred) }))
    .sort((a, b) => b.score - a.score);

  const selected: T[] = [];
  for (const entry of scored) {
    if (selected.length >= runtimeProfile.maxToolCount) break;
    if (entry.score <= 0 && selected.length > 0) break;
    if (!selected.find((tool) => tool.name === entry.tool.name)) {
      selected.push(entry.tool);
    }
  }

  if (selected.length === 0) {
    const defaultNames = hasIntent(message, /\b(search|latest|current|today|news|price|prices|stock|stocks|crypto|weather|forecast)\b/i)
      ? ['web_search', 'read_webpage', 'google_search', 'get_weather', 'get_time']
      : ['read_knowledge', 'list_skills', 'get_time'];

    for (const toolName of defaultNames) {
      const match = tools.find((tool) => tool.name === toolName);
      if (match && !selected.find((tool) => tool.name === match.name)) {
        selected.push(match);
      }
      if (selected.length >= Math.min(runtimeProfile.maxToolCount, 4)) break;
    }
  }

  return selected.slice(0, runtimeProfile.maxToolCount);
}

export async function streamProviderText(
  provider: LLMProvider,
  messages: LLMMessage[],
  onChunk?: (chunk: string) => void,
): Promise<StreamProviderTextResult> {
  let out = '';
  try {
    for await (const chunk of provider.stream(messages)) {
      out += chunk;
      onChunk?.(chunk);
    }
  } catch (error) {
    if (out.trim()) {
      throw error;
    }
    const response = await provider.chat(messages);
    const meta = provider.getLastGenerationMeta?.();
    const content = response.content?.trim() ? response.content : '';
    if (content) {
      onChunk?.(content);
    }
    return {
      content,
      finishReason: response.finishReason || meta?.finishReason,
      usedFallback: true,
      reasoningOnly: meta?.reasoningOnly ?? false,
      model: response.model || meta?.model,
    };
  }

  const meta = provider.getLastGenerationMeta?.();
  if (!out.trim()) {
    const response = await provider.chat(messages);
    const fallbackMeta = provider.getLastGenerationMeta?.();
    const content = response.content?.trim() ? response.content : '';
    if (content) {
      onChunk?.(content);
    }
    return {
      content,
      finishReason: response.finishReason || fallbackMeta?.finishReason || meta?.finishReason,
      usedFallback: true,
      reasoningOnly: fallbackMeta?.reasoningOnly ?? meta?.reasoningOnly ?? false,
      model: response.model || fallbackMeta?.model || meta?.model,
    };
  }

  return {
    content: out,
    finishReason: meta?.finishReason,
    usedFallback: false,
    reasoningOnly: meta?.reasoningOnly ?? false,
    model: meta?.model,
  };
}

export function buildToolResultFallback(toolResults: string[], isProjectCreation: boolean): string {
  if (isProjectCreation) {
    const joined = toolResults.join('\n');
    const projectMatch = joined.match(/Project \*\*(.+?)\*\* created with (\d+) file/);
    if (projectMatch) {
      return `${projectMatch[1]} created with ${projectMatch[2]} file(s) and opened in the IDE.`;
    }
    return 'Project created successfully and opened in the IDE.';
  }

  const firstResult = toolResults[0]?.replace(/^\[[^\]]+\]\s*/, '').trim();
  if (!firstResult) {
    return 'Action completed successfully.';
  }

  return clipText(firstResult, 500);
}
