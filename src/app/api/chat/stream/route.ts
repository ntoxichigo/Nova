import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { getChatMcpAllowlist, getChatPermissionMode, getChatPowerMode, getChatSpeedMode, getLLMConfig, getAgentName, getAgentPersonality } from '@/lib/settings';
import { classifyLLMError, createLLMProvider } from '@/lib/llm';
import type { LLMConfig, LLMMessage, LLMProvider } from '@/lib/llm/types';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import { allTools } from '@/lib/tools/executors';
import { rankByRelevance } from '@/lib/embeddings';
import { buildSkillContext, selectRelevantSkill } from '@/lib/skills/router';
import {
  buildRuntimeProfile,
  buildToolResultFallback,
  clipText,
  estimateTokens,
  extractInlineToolCall,
  isWebsiteBuildIntent,
  selectRelevantTools,
  streamProviderText,
} from '@/lib/chat/stream-utils';
import {
  selfCritique,
  extractGraphRelations,
  decomposeTask,
  compressConversation,
  rerankResults,
} from '@/lib/intelligence';
import { discoverMCPTools, callMCPTool } from '@/lib/mcp/client';
import { tryRecordAuditEvent } from '@/lib/audit';
import { evaluateToolPolicy } from '@/lib/policy';
import { getAutonomyProfile, getOrchestrationSettings } from '@/lib/orchestration/config';
import { buildContextPack, classifyTaskMode } from '@/lib/orchestration/context-engine';
import { routeStageModel, summarizeRoutes } from '@/lib/orchestration/model-router';
import { runPlannerSpecialist, runResearchBriefSpecialist, runVerifierSpecialist } from '@/lib/orchestration/specialists';
import { recordOrchestrationTrace } from '@/lib/orchestration/telemetry';
import type { OrchestrationTraceStage, RoutedStage } from '@/lib/orchestration/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 min - cloud inference can be slow

const SAFE_MODE_BLOCKED_TOOLS = new Set([
  'create_script_project',
  'open_workspace_file_in_ide',
  'fs_write_file',
  'fs_edit_file',
  'fs_delete_file',
  'fs_run_command',
  'github_create_issue',
  'github_list_my_repos',
  'google_list_emails',
  'google_calendar_events',
]);

// In builder mode, create_script_project and fs_run_command are now allowed but gated
// by RISKY_APPROVAL_TOOLS — the user will be asked before execution.
// Integration tools (github_*, google_*, telegram_*, discord_*) remain blocked via prefix check.
const BUILDER_MODE_BLOCKED_TOOLS = new Set<string>([]);
const BUILDER_MODE_ALLOWED_PREFIX_EXCEPTIONS = new Set([
  'google_search',
]);
const DIRECT_TOOL_RESPONSE_TOOLS = new Set([
  'get_weather',
  'get_time',
  'get_easter',
  'lookup_wikipedia',
  'web_search',
  'google_search',
  'read_webpage',
]);

function isToolAllowedForPowerMode(
  toolName: string,
  mode: 'safe' | 'builder' | 'power',
  mcpAllowlist: string[] = [],
): boolean {
  if (mode === 'power') {
    return true;
  }

  if (mode === 'builder' && BUILDER_MODE_ALLOWED_PREFIX_EXCEPTIONS.has(toolName)) {
    return true;
  }

  const blocked = mode === 'safe' ? SAFE_MODE_BLOCKED_TOOLS : BUILDER_MODE_BLOCKED_TOOLS;
  if (blocked.has(toolName)) {
    return false;
  }

  // Dynamic and integration-heavy tools are power-mode only for predictable safety.
  if (toolName.startsWith('mcp_')) {
    return mcpAllowlist.includes(toolName);
  }
  if (
    toolName.startsWith('github_') ||
    toolName.startsWith('google_') ||
    toolName.startsWith('telegram_') ||
    toolName.startsWith('discord_')
  ) {
    return false;
  }

  return true;
}

function filterToolsByPowerMode(
  tools: typeof allTools,
  mode: 'safe' | 'builder' | 'power',
  mcpAllowlist: string[] = [],
) {
  return tools.filter((tool) => isToolAllowedForPowerMode(tool.name, mode, mcpAllowlist));
}

const RISKY_APPROVAL_TOOLS = new Set([
  'create_script_project',
  'open_workspace_file_in_ide',
  'fs_write_file',
  'fs_edit_file',
  'fs_delete_file',
  'fs_run_command',
  'run_code',
  'github_create_issue',
  'github_list_my_repos',
  'github_get_repo',
  'github_search_repos',
  'google_list_emails',
  'google_calendar_events',
  'google_search',
]);

function shouldRequireToolApproval(
  toolName: string,
  permissionMode: 'always_ask' | 'ask_risky' | 'autopilot',
  preApprovedTools: Set<string>,
): boolean {
  if (preApprovedTools.has(toolName)) {
    return false;
  }
  if (permissionMode === 'autopilot') {
    return false;
  }
  if (permissionMode === 'always_ask') {
    return true;
  }
  if (toolName.startsWith('mcp_')) {
    return true;
  }
  return RISKY_APPROVAL_TOOLS.has(toolName);
}

function isSimpleGreetingMessage(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text || text.length > 72) return false;

  const hasActionIntent = /\b(build|create|generate|write|code|debug|fix|compare|research|analyze|audit|implement|project|website|api|model|tool|file|folder|command)\b/.test(text);
  if (hasActionIntent) return false;

  const hasGreetingWord = /\b(hi|hello|hey|yo|sup|what'?s up|good morning|good afternoon|good evening)\b/.test(text);
  const hasWellbeing = /\b(how are you|how are you doing|how's it going|how is it going)\b/.test(text);

  const greetingPattern =
    /^(hi|hello|hey|yo|sup|what'?s up|good morning|good afternoon|good evening)(\s+[a-z0-9_-]+)?[!?.\s]*$/i;
  const wellbeingPattern = /^(how are you|how are you doing|how's it going|how is it going)[!?.\s]*$/i;

  return greetingPattern.test(text) || wellbeingPattern.test(text) || (hasGreetingWord && hasWellbeing);
}

function buildFastSocialReply(message: string, agentName: string): string | null {
  const text = message.trim();
  if (!text || text.length > 120) return null;

  if (/^(just\s+chat(?:\s+for\s+now)?|let'?s\s+chat|just\s+talk(?:\s+for\s+now)?|chat(?:\s+for\s+now)?)\s*[!?.]*$/i.test(text)) {
    return 'Sure, we can just chat.';
  }
  if (/^(how are you|how are you doing|how's it going|how is it going)[!?.\s]*$/i.test(text)) {
    return `I'm doing well and ready to help.`;
  }
  if (isSimpleGreetingMessage(text)) {
    return `Hi, I'm ${agentName}.`;
  }
  if (/\b(what(?:'s| is)\s+(?:your|ur)\s+name|who\s+are\s+you)\b/i.test(text)) {
    return `I'm ${agentName}.`;
  }

  return null;
}

function isNameRememberIntent(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  return (
    /\b(my name is|call me)\b/.test(text) ||
    /\bremember\b/.test(text)
  );
}

function isLowLatencyConversationMessage(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text || text.length > 140) return false;
  if (text.startsWith('/')) return false;

  const explicitDepthOrGenerationIntent =
    /\b(explain|describe|write|generate|create|build|implement|plan|audit|review|analyze|research|compare|list|guide|tutorial|story|article|essay|code|debug|fix|project|website|api|model|context|tokens?|long|detailed|in[- ]depth|step by step)\b/i;
  if (explicitDepthOrGenerationIntent.test(text)) return false;

  const quickSocialPattern =
    /^(hi|hello|hey|yo|sup|what'?s up|good morning|good afternoon|good evening|thanks|thank you|thx|ok|okay|cool|nice|great|sounds good|how are you|how's it going)[!?.\s]*$/i;
  return quickSocialPattern.test(text);
}

function isQuickDirectTaskMessage(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text || text.length > 220) return false;
  if (text.startsWith('/')) return false;
  if (/\b(compare|audit|analyze|research|plan|architecture|strategy|deploy|refactor|debug|fix|review)\b/.test(text)) return false;

  return /\b(create|make|write|generate|build)\b/.test(text) &&
    /\b(script|python|html|website|landing page|page|component|function|email|query|sql|regex)\b/.test(text);
}

function isSingleFileHtmlRequest(message: string): boolean {
  const text = message.toLowerCase();
  const asksWeb = /\b(html|website|web page|landing page|react website|single page)\b/.test(text);
  const asksSingle = /\b(one html|single html|one file|single file|index\.html|in one html|in one file)\b/.test(text);
  return asksWeb && asksSingle;
}

function hasExplicitWorkspaceTarget(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (/[a-z0-9_\-/]+\.[a-z0-9]{1,8}\b/i.test(text)) return true;
  if (/\b(src|app|pages|components|public|styles|scripts|assets|docs|tests)\/[^\s]+/i.test(text)) return true;
  if (/\b(save as|name it|call it|put it in|write to|create at|open file)\b/i.test(text)) return true;
  return false;
}

type DirectToolIntent =
  | { toolName: 'get_weather'; arguments: { location: string } }
  | { toolName: 'get_time'; arguments: { location: string } }
  | { toolName: 'web_search'; arguments: { query: string } };

function normalizeLocationCandidate(candidate: string): string | null {
  const cleaned = candidate
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const trailingStopwords = new Set([
    'now',
    'today',
    'tonight',
    'currently',
    'please',
    'pls',
    'right',
    'thanks',
  ]);

  const parts = cleaned.split(' ').filter(Boolean);
  while (parts.length > 0 && trailingStopwords.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }

  const normalized = parts.join(' ').replace(/^[,.\-]+|[,.\-]+$/g, '').trim();
  if (!normalized || normalized.length < 2 || normalized.length > 80) return null;
  return normalized;
}

function extractLocationFromMessage(message: string): string | null {
  const text = message.trim();
  if (!text) return null;

  const inMatch = text.match(/\b(?:in|for|at)\s+([a-z][a-z0-9 .,'-]{1,80})/i);
  if (inMatch?.[1]) {
    const normalized = normalizeLocationCandidate(inMatch[1]);
    if (normalized) return normalized;
  }

  const cityOnly = text.match(/^\s*([a-z][a-z0-9 .,'-]{1,50})\s*$/i);
  if (cityOnly?.[1]) {
    const normalized = normalizeLocationCandidate(cityOnly[1]);
    if (normalized) return normalized;
  }

  return null;
}

function detectDirectToolIntent(message: string): DirectToolIntent | null {
  const text = message.trim();
  if (!text || text.length > 320) return null;
  const lower = text.toLowerCase();

  const weatherIntent = /\b(weather|forecast|temperature|wind|humidity|rain|snow|storm|conditions?)\b/.test(lower);
  if (weatherIntent) {
    const location = extractLocationFromMessage(text);
    if (location) {
      return { toolName: 'get_weather', arguments: { location } };
    }
  }

  const timeIntent = /\b(time|timezone|clock|date)\b/.test(lower)
    && /\b(what|current|now|today|time|date|check)\b/.test(lower);
  if (timeIntent) {
    const location = extractLocationFromMessage(text) || 'UTC';
    return { toolName: 'get_time', arguments: { location } };
  }

  const explicitSearch = /^\/?search\s+/i.test(text);
  const liveSearchIntent = /\b(latest|current|today|news|update|updates|price|prices|stock|stocks|crypto)\b/.test(lower)
    && /\b(search|look up|find|check|what(?:'s| is)|tell me)\b/.test(lower);
  if (explicitSearch || liveSearchIntent) {
    const query = explicitSearch
      ? text.replace(/^\/?search\s+/i, '').trim()
      : text;
    if (query.length >= 2) {
      return { toolName: 'web_search', arguments: { query } };
    }
  }

  return null;
}

function tokenizeMessageForRelevance(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'about', 'what',
      'make', 'build', 'create', 'write', 'generate', 'need', 'want', 'just', 'please', 'show',
      'give', 'some', 'more', 'less', 'very', 'high', 'level',
    ]).has(token));
}

function scoreMemoryRelevance(
  content: string,
  type: string,
  message: string,
): number {
  const memoryTokens = new Set(tokenizeMessageForRelevance(content));
  const messageTokens = tokenizeMessageForRelevance(message);
  let score = 0;

  for (const token of messageTokens) {
    if (memoryTokens.has(token)) score += 4;
  }

  const lowered = content.toLowerCase();
  if (type === 'feedback_negative' || type === 'instruction') score += 3;
  if (/\b(name|call me|my name is)\b/.test(lowered) && /\b(name|who am i|call me)\b/.test(message.toLowerCase())) score += 8;
  if (/\bportfolio|website|landing page|html\b/.test(lowered) && /\bportfolio|website|landing page|html\b/.test(message.toLowerCase())) score += 6;

  return score;
}

interface MemoryLike {
  id: string;
  type: string;
  content: string;
  importance: number;
  lastAccessed: Date;
}

function deriveConversationScopedMemories(allMessages: Array<{ id: string; role: string; content: string; createdAt: Date }>): MemoryLike[] {
  const userMessages = allMessages
    .filter((entry) => entry.role === 'user')
    .slice(-30);

  const candidates: MemoryLike[] = [];
  for (const entry of userMessages) {
    const text = entry.content.trim();
    if (!text || text.length < 12) continue;
    const hasConstraintSignal = /\b(must|should|please|don't|do not|avoid|always|never|important|priority|focus)\b/i.test(text);
    const hasPreferenceSignal = /\b(i like|i prefer|my style|my workflow|for me|i need|i want)\b/i.test(text);
    if (!hasConstraintSignal && !hasPreferenceSignal) continue;
    candidates.push({
      id: `conv-${entry.id}`,
      type: hasConstraintSignal ? 'instruction' : 'context',
      content: text,
      importance: hasConstraintSignal ? 8 : 6,
      lastAccessed: entry.createdAt,
    });
  }

  return candidates.slice(-10);
}

function isGenericGuessedPath(toolPath: string): boolean {
  const normalized = toolPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().trim();
  return new Set([
    'index.html',
    'main.py',
    'app.py',
    'script.js',
    'main.js',
    'app.js',
    'style.css',
    'readme.md',
  ]).has(normalized);
}

const IDENTITY_QUERY_PATTERNS = [
  /^(what(?:'s| is)\s+my\s+name)\??$/i,
  /^(who\s+am\s+i)\??$/i,
  /^(do\s+you\s+know\s+my\s+name)\??$/i,
  /^(tell\s+me\s+my\s+name)\??$/i,
];

const NAME_DECLARATION_PATTERNS = [
  /\bmy name is\s+([a-z][a-z' -]{0,40})\b/i,
  /\bcall me\s+([a-z][a-z' -]{0,40})\b/i,
  /\bi am\s+([a-z][a-z' -]{0,40})\b/i,
  /\bi'm\s+([a-z][a-z' -]{0,40})\b/i,
];

const NAME_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'for',
  'working', 'building', 'coding', 'ready', 'fine', 'good', 'great', 'ok', 'okay', 'here',
  'trying', 'using', 'doing', 'back', 'new', 'old', 'sure', 'yes', 'no', 'unknown',
]);

function isIdentityRecallMessage(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 120) return false;
  return IDENTITY_QUERY_PATTERNS.some((pattern) => pattern.test(text));
}

function toDisplayName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeNameCandidate(candidate: string): string | null {
  const cleaned = candidate
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[.,!?;:()[\]{}"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!cleaned) return null;
  const parts = cleaned.split(' ').filter(Boolean).slice(0, 3);
  if (parts.length === 0) return null;
  if (parts.every((part) => NAME_STOPWORDS.has(part))) return null;
  if (parts.some((part) => part.length < 2 || part.length > 24)) return null;
  if (parts.some((part) => /\d/.test(part))) return null;
  return toDisplayName(parts.join(' '));
}

function extractNameFromText(content: string): string | null {
  for (const pattern of NAME_DECLARATION_PATTERNS) {
    const match = content.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeNameCandidate(match[1]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

async function resolveKnownUserName(conversationId: string): Promise<string | null> {
  const [relations, memories, userMessages] = await Promise.all([
    db.memoryRelation.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
    db.agentMemory.findMany({ orderBy: [{ importance: 'desc' }, { lastAccessed: 'desc' }], take: 50 }),
    db.message.findMany({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
  ]);

  for (const relation of relations) {
    if (!/user/i.test(relation.subject)) continue;
    if (!/(name|named|call)/i.test(relation.relation)) continue;
    const normalized = normalizeNameCandidate(relation.object);
    if (normalized) return normalized;
  }

  for (const memory of memories) {
    const parsed = extractNameFromText(memory.content);
    if (parsed) return parsed;
  }

  for (const msg of userMessages) {
    const parsed = extractNameFromText(msg.content);
    if (parsed) return parsed;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId, modelOverride, image, resumeToolCall, runtimeHints, approvedTools } = body as {
      message: string;
      conversationId?: string;
      modelOverride?: string;
      image?: { base64: string; mimeType: string; name: string };
      /** Pre-approved tool call: skip LLM, execute this directly and stream follow-up. */
      resumeToolCall?: { name: string; arguments: Record<string, unknown> };
      runtimeHints?: { reduceLoad?: boolean; continueFrom?: string; taskBrief?: string; chatSpeed?: 'simple' | 'balanced' | 'deep' };
      approvedTools?: string[];
    };

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 });
    }

    const websiteBuildIntent = isWebsiteBuildIntent(message);
    const singleFileHtmlRequest = isSingleFileHtmlRequest(message);

    // Fetch agent identity + LLM config in parallel
    const [agentName, agentPersonality, rawLLMConfig, orchestrationSettings, chatPowerMode, chatPermissionMode, chatMcpAllowlist, chatSpeedSetting] = await Promise.all([
      getAgentName(),
      getAgentPersonality(),
      getLLMConfig(),
      getOrchestrationSettings(),
      getChatPowerMode(),
      getChatPermissionMode(),
      getChatMcpAllowlist(),
      getChatSpeedMode(),
    ]);
    const preApprovedTools = new Set(
      Array.isArray(approvedTools)
        ? approvedTools.filter((entry): entry is string => typeof entry === 'string')
        : [],
    );
    let llmConfig = rawLLMConfig;
    const taskMode = classifyTaskMode(message, { websiteBuildIntent });
    const requestedChatSpeed = runtimeHints?.chatSpeed || chatSpeedSetting || 'balanced';
    const forcedSimpleSpeed = requestedChatSpeed === 'simple';
    const forcedDeepSpeed = requestedChatSpeed === 'deep';
    const lowLatencyChat = !resumeToolCall && taskMode === 'chat' && (
      forcedSimpleSpeed ||
      (!forcedDeepSpeed && (isLowLatencyConversationMessage(message) || isSimpleGreetingMessage(message)))
    );
    const quickDirectTask = !resumeToolCall && (forcedSimpleSpeed || (!forcedDeepSpeed && isQuickDirectTaskMessage(message)));
    const lightContextTurn = lowLatencyChat || quickDirectTask;
    const autonomyProfile = getAutonomyProfile(orchestrationSettings.autonomyProfile);

    // Apply per-request model override if provided
    if (modelOverride && typeof modelOverride === 'string') {
      llmConfig.model = modelOverride;
    }

    if (lightContextTurn) {
      llmConfig.qualityMode = 'balanced';
      llmConfig.maxTokens = Math.min(llmConfig.maxTokens ?? 2048, quickDirectTask ? 1800 : 1200);
      llmConfig.historyBudget = Math.min(llmConfig.historyBudget ?? 16, quickDirectTask ? 6 : 8);
      llmConfig.compressionThreshold = Math.min(llmConfig.compressionThreshold ?? 14, 10);
    }

    if (runtimeHints?.reduceLoad) {
      llmConfig.maxTokens = Math.max(256, Math.floor((llmConfig.maxTokens ?? 2048) / 2));
      llmConfig.historyBudget = Math.max(6, Math.floor((llmConfig.historyBudget ?? 16) * 0.7));
    }

    // Get or create conversation
    let convId = conversationId;
    let convSummary = '';
    if (!convId) {
      const conversation = await db.conversation.create({
        data: { title: message.slice(0, 50) + (message.length > 50 ? '...' : '') },
      });
      convId = conversation.id;
    } else {
      const existing = await db.conversation.findUnique({ where: { id: convId } });
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
      }
      convSummary = existing.summary || '';
    }

    // Save the user message, except for resume calls that already stored it.
    if (!resumeToolCall) {
      await db.message.create({
        data: { conversationId: convId, role: 'user', content: message },
      });
    }

    const makeImmediateResponse = (content: string) => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (data: string) => {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          send(JSON.stringify({
            type: 'meta',
            conversationId: convId,
            skillsUsed: [],
            model: llmConfig.model || llmConfig.provider || 'model',
            provider: llmConfig.provider,
            taskMode: 'chat',
            chatPowerMode,
            chatPermissionMode,
            chatSpeedMode: requestedChatSpeed,
          }));
          send(JSON.stringify({ type: 'replace', content }));
          send(JSON.stringify({
            type: 'done',
            messageId: null,
            learningSuggestions: [],
            toolsUsed: [],
            resolvedModel: llmConfig.model || '',
          }));
          controller.close();

          void db.message.create({
            data: {
              conversationId: convId,
              role: 'assistant',
              content,
              tokenCount: estimateTokens(content),
              modelUsed: llmConfig.model || llmConfig.provider || '',
              skillsUsed: JSON.stringify([]),
              toolCalls: JSON.stringify([]),
            },
          }).catch(() => {});
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    };

    if (!resumeToolCall) {
      const parsedName = extractNameFromText(message);
      if (parsedName && isNameRememberIntent(message)) {
        void (async () => {
          try {
            await db.$transaction([
              db.agentMemory.create({
                data: {
                  type: 'instruction',
                  content: `User name is ${parsedName}.`,
                  importance: 10,
                },
              }),
              db.memoryRelation.upsert({
                where: {
                  subject_relation_object: {
                    subject: 'user',
                    relation: 'name',
                    object: parsedName,
                  },
                },
                update: {},
                create: {
                  subject: 'user',
                  relation: 'name',
                  object: parsedName,
                },
              }),
            ]);
          } catch {
            // Ignore persistence failures for fast path.
          }
        })();
        return makeImmediateResponse(`Got it, ${parsedName}. I'll remember your name.`);
      }

      if (isIdentityRecallMessage(message)) {
        const knownName = await resolveKnownUserName(convId);
        return makeImmediateResponse(
          knownName
            ? `Your name is ${knownName}.`
            : `I don't have your name saved yet.`,
        );
      }

      const fastSocialReply = buildFastSocialReply(message, agentName);
      if (fastSocialReply) {
        return makeImmediateResponse(fastSocialReply);
      }
    }

    // Route and profile the main model before building runtime behavior.
    const initialProfiledConfig = applyModelStabilityProfile(llmConfig).config;
    const { config: routedMainConfig, route: mainRoute } = routeStageModel(
      initialProfiledConfig,
      orchestrationSettings,
      'main',
      taskMode,
    );
    const { config: profiledLLMConfig, profile: modelProfile } = applyModelStabilityProfile(routedMainConfig);
    llmConfig = profiledLLMConfig;
    const provider = createLLMProvider(llmConfig);
    const runtimeProfile = buildRuntimeProfile(llmConfig, provider, Boolean(runtimeHints?.reduceLoad || lightContextTurn));
    const orchestrationRoutes: RoutedStage[] = [mainRoute];
    const orchestrationStageTraces: OrchestrationTraceStage[] = [];

    const messageFetchLimit = lightContextTurn
      ? Math.max(24, runtimeProfile.historyBudget * 3)
      : Math.max(80, runtimeProfile.historyBudget * 6);
    const knowledgeFetchLimit = lightContextTurn
      ? 0
      : Math.max(120, runtimeProfile.maxKnowledgeItems * 40);

    // Fetch skills, knowledge, scoped memory sources, graph relations, and recent messages in parallel.
    const [skills, allKnowledge, globalMemoryPool, graphRelations, recentMessagesWindow] = await Promise.all([
      db.skill.findMany({ where: { isActive: true }, take: 200 }),
      lightContextTurn
        ? Promise.resolve([] as any[])
        : db.knowledge.findMany({
            orderBy: { createdAt: 'desc' },
            take: knowledgeFetchLimit,
          }),
      db.agentMemory.findMany({
        where: {
          type: { in: ['instruction', 'feedback_negative'] },
        },
        orderBy: [{ importance: 'desc' }, { lastAccessed: 'desc' }],
        take: lightContextTurn ? 6 : 10,
      }),
      lightContextTurn
        ? Promise.resolve([] as any[])
        : db.memoryRelation.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
      db.message.findMany({
        where: { conversationId: convId },
        orderBy: { createdAt: 'desc' },
        take: messageFetchLimit,
      }),
    ]);
    const allMessages = [...recentMessagesWindow].reverse();
    const conversationScopedMemories = deriveConversationScopedMemories(allMessages);
    const memories = [...conversationScopedMemories, ...globalMemoryPool];

    // Knowledge retrieval: cosine and keyword ranking, then optional LLM reranking.
    const knowledgeCandidates = !lightContextTurn && allKnowledge.length > 0
      ? await rankByRelevance(allKnowledge, message, runtimeProfile.compactMode ? 5 : 8)
      : [];
    const relevantKnowledge = runtimeProfile.allowKnowledgeRerank && knowledgeCandidates.length > 3
      ? await rerankResults(knowledgeCandidates, message, provider, 3)
      : knowledgeCandidates.slice(0, runtimeProfile.maxKnowledgeItems);

    const memoryCandidates = memories
      .map((entry) => ({
        entry,
        score: scoreMemoryRelevance(entry.content, entry.type, message),
      }))
      .filter(({ entry, score }) => (
        entry.type === 'feedback_negative' ||
        entry.type === 'instruction' ||
        score > 0 ||
        isIdentityRecallMessage(message)
      ))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.entry.importance !== a.entry.importance) return b.entry.importance - a.entry.importance;
        return new Date(b.entry.lastAccessed).getTime() - new Date(a.entry.lastAccessed).getTime();
      })
      .map(({ entry }) => entry);

    const relevantMemories = memoryCandidates.slice(0, runtimeProfile.maxMemoryItems);

    const persistedMemoryIds = relevantMemories
      .map((memory) => memory.id)
      .filter((id) => !String(id).startsWith('conv-'));

    // Batch-update persisted memory access counts
    if (persistedMemoryIds.length > 0) {
      await db.agentMemory.updateMany({
        where: { id: { in: persistedMemoryIds } },
        data: { accessCount: { increment: 1 }, lastAccessed: new Date() },
      });
    }

    // Determine the single most relevant skill for this turn.
    const recentRoutingContext = allMessages
      .filter((m) => m.role === 'user')
      .slice(-4)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
    const selectedSkill = selectRelevantSkill(skills, message, recentRoutingContext);
    const skillsUsedNames = selectedSkill ? [selectedSkill.name] : [];
    const skillsUsedIds = selectedSkill ? [selectedSkill.id] : [];
    const selectedSkillContext = buildSkillContext(selectedSkill, {
      compact: true,
      descriptionLimit: runtimeProfile.skillDescriptionLimit,
      instructionLimit: runtimeProfile.skillInstructionLimit,
    });

    // Activate skill-defined custom tools from Skill.toolDefinition.
    let runtimeTools = filterToolsByPowerMode(allTools, chatPowerMode, chatMcpAllowlist);
    const preferredToolNames: string[] = [];
    if (selectedSkill?.toolDefinition && selectedSkill.toolDefinition !== '{}') {
      try {
        const def = JSON.parse(selectedSkill.toolDefinition) as { tools?: Array<{ name: string; description: string; parameters?: { type: 'object'; properties: Record<string, { type: string; description: string }>; required?: string[] }; endpoint?: string; method?: string }> };
        if (Array.isArray(def.tools)) {
          for (const ct of def.tools) {
            if (
              chatPowerMode === 'power' &&
              isToolAllowedForPowerMode(ct.name, chatPowerMode, chatMcpAllowlist) &&
              ct.name &&
              ct.description &&
              !runtimeTools.find((t) => t.name === ct.name)
            ) {
              const ctCopy = ct;
              preferredToolNames.push(ctCopy.name);
              runtimeTools.push({
                name: ctCopy.name,
                description: ctCopy.description,
                parameters: ctCopy.parameters ?? { type: 'object' as const, properties: {} },
                async execute(args) {
                  if (!ctCopy.endpoint) return { toolName: ctCopy.name, content: JSON.stringify(args) };
                  try {
                    const r = await fetch(ctCopy.endpoint, {
                      method: ctCopy.method ?? 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: ctCopy.method === 'GET' ? undefined : JSON.stringify(args),
                      signal: AbortSignal.timeout(10000),
                    });
                    return { toolName: ctCopy.name, content: (await r.text()).slice(0, 2000) };
                  } catch (e) {
                    return { toolName: ctCopy.name, content: '', error: e instanceof Error ? e.message : 'Tool failed' };
                  }
                },
              });
            }
          }
        }
      } catch { /* ignore malformed toolDefinition */ }
    }

    // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Discover and attach MCP tools ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
    let discoveredMcpTools: Awaited<ReturnType<typeof discoverMCPTools>> = [];
    try {
      if (chatPowerMode === 'power' || chatMcpAllowlist.length > 0) {
        discoveredMcpTools = await discoverMCPTools();
        const eligibleMcpTools = chatPowerMode === 'power'
          ? discoveredMcpTools
          : discoveredMcpTools.filter((tool) => chatMcpAllowlist.includes(tool.name));
        for (const mt of eligibleMcpTools) {
          if (!runtimeTools.find((t) => t.name === mt.name)) {
            const mcpToolName = mt.name;
            runtimeTools.push({
              name: mcpToolName,
              description: `[MCP:${mt.serverName}] ${mt.description}`,
              parameters: (mt.inputSchema as { type: 'object'; properties: Record<string, { type: string; description: string }> }) || { type: 'object' as const, properties: {} },
              async execute(args) {
                try {
                  const result = await callMCPTool(mcpToolName, args);
                  return { toolName: mcpToolName, content: result.slice(0, 4000) };
                } catch (e) {
                  return { toolName: mcpToolName, content: '', error: e instanceof Error ? e.message : 'MCP tool failed' };
                }
              },
            });
          }
        }
      }
    } catch { /* MCP discovery failed; continue without MCP tools. */ }

    runtimeTools = selectRelevantTools(runtimeTools, message, runtimeProfile, preferredToolNames);
    if (singleFileHtmlRequest) {
      runtimeTools = [];
    }

    // Proactive compression: summarize old messages before they overflow.
    // Runs here so liveSummary is ready before we build context sections.
    const messageHistory = allMessages.map((entry) => ({ role: entry.role, content: entry.content }));
    const compressedConversation = runtimeProfile.allowModelCompression
      ? await compressConversation(
          messageHistory,
          provider,
          runtimeProfile.compressionThreshold,
          runtimeProfile.historyBudget,
        )
      : {
          messages: messageHistory.slice(-runtimeProfile.historyBudget),
          didCompress: messageHistory.length > runtimeProfile.historyBudget,
        };

    let liveSummary = convSummary;
    const generatedSummary = compressedConversation.messages
      .find((entry) => entry.role === 'system' && entry.content.startsWith('[Earlier conversation summary'))
      ?.content
      .replace('[Earlier conversation summary - treat as read context]\n', '')
      .trim();

    if (generatedSummary) {
      liveSummary = generatedSummary;
      await db.conversation.update({
        where: { id: convId },
        data: { summary: liveSummary },
      }).catch(() => {});
    }

    const clippedMemories = relevantMemories.slice(0, runtimeProfile.maxMemoryItems);
    const memoryUsedPreview = clippedMemories.map((entry) => ({
      type: entry.type,
      content: clipText(entry.content, 120),
      source: String(entry.id).startsWith('conv-') ? 'conversation' : 'global',
    }));
    const negativeMemories = clippedMemories.filter((entry) => entry.type === 'feedback_negative');
    const clippedKnowledge = relevantKnowledge.slice(0, runtimeProfile.maxKnowledgeItems);

    const skillsSection = selectedSkillContext
      ? clipText(selectedSkillContext, runtimeProfile.summaryCharLimit)
      : '';
    const knowledgeSection = clippedKnowledge.length > 0
      ? clippedKnowledge.map((entry) => `- ${entry.topic}: ${clipText(entry.content, runtimeProfile.sectionItemLimit)}`).join('\n')
      : '';
    const memoriesSection = clippedMemories.length > 0
      ? clippedMemories.map((entry) => `- ${clipText(entry.content, runtimeProfile.sectionItemLimit)}`).join('\n')
      : '';
    const graphSection = graphRelations.length > 0
      ? graphRelations.slice(0, runtimeProfile.maxGraphFacts).map((entry) => `- ${entry.subject} ${entry.relation} ${entry.object}`).join('\n')
      : '';
    const feedbackSection = negativeMemories.length > 0
      ? negativeMemories.map((entry) => `- ${clipText(entry.content, Math.floor(runtimeProfile.sectionItemLimit * 0.8))}`).join('\n')
      : '';
    const summarySection = liveSummary
      ? clipText(liveSummary, runtimeProfile.summaryCharLimit)
      : '';

    const toolList = runtimeTools.map((entry) => `- ${entry.name}: ${clipText(entry.description, runtimeProfile.toolDescriptionLimit)}`).join('\n');
    const blockedToolNames = allTools
      .filter((entry) => !isToolAllowedForPowerMode(entry.name, chatPowerMode, chatMcpAllowlist))
      .map((entry) => entry.name);
    const blockedMcpToolNames = discoveredMcpTools
      .filter((entry) => !isToolAllowedForPowerMode(entry.name, chatPowerMode, chatMcpAllowlist))
      .map((entry) => entry.name);
    const combinedBlockedToolNames = [...new Set([...blockedToolNames, ...blockedMcpToolNames])];
    const blockedToolsHint = combinedBlockedToolNames.length > 0
      ? `\nTools blocked by current chat power mode (${chatPowerMode})${combinedBlockedToolNames.length > 16 ? ' (partial list)' : ''}:\n${combinedBlockedToolNames.slice(0, 16).map((name) => `- ${name}`).join('\n')}`
      : '';
    const websiteBuildRules = websiteBuildIntent
      ? `

Website / code generation rules:
- If the user asks for a SINGLE HTML file ("one html file", "single html", "in one file", "html file", "index.html", etc.): output the COMPLETE, fully working HTML code block directly in the chat. Never redirect to the IDE or Scripts view for single-file requests. Never truncate or abbreviate the code — always write the full file.
- If the user asks for a complex multi-file project (multiple source files, npm packages, a framework setup, build tools): suggest they open the Scripts view / IDE for proper project scaffolding.
- Never refuse to write code in chat. Never say you "can't write files" — you are outputting code as text, not writing to disk.
- If the user wants the file actually saved/opened, prefer \`create_script_project\` for new IDE artifacts or \`open_workspace_file_in_ide\` for existing workspace files.
`
      : '';

    const lowLatencyInstruction = lightContextTurn
      ? '\nLatency mode: answer directly in at most 4 short sentences. Do not add planning steps or long reasoning unless the user asks for depth.'
      : requestedChatSpeed === 'deep'
        ? '\nDepth mode: provide fuller reasoning when useful, but stay focused and avoid irrelevant digressions.'
        : '';

    const BASE_PROMPT = `You are ${agentName}, a personal AI agent with live tool access.${agentPersonality ? ` ${agentPersonality}` : ''}
Be direct, accurate, and concise. Use markdown only when it helps.
Current task mode: ${taskMode}.
Autonomy profile: ${autonomyProfile.label} (${autonomyProfile.description})
Chat power mode: ${chatPowerMode}.
Chat permission mode: ${chatPermissionMode}.
${lowLatencyInstruction}

Tool rules:
- Match the user tone, but stay professional. Do not use overly familiar phrases like "my dude" unless the user clearly speaks that way first.
- If the answer depends on real-time or external data, use the right tool first.
- Never claim you lack real-time access when a listed tool can help.
- For project or file creation, if a tool is the right path, respond with exactly one \`\`\`tool\`\`\` block containing one JSON object: {"name":"tool_name","arguments":{...}} and nothing else.
- Never mix prose with raw tool JSON.
- After tool results arrive, answer from those results and do not invent missing facts.
- When the autonomy profile is review-oriented, prioritize diagnosis and recommendation over acting unless the user explicitly asks for execution.
- If a requested action needs a tool that is unavailable in the current chat power mode, explain that the user can raise chat power mode in Settings (safe/builder/power).
- Never guess a local workspace filename or folder for \`fs_write_file\`, \`fs_read_file\`, \`fs_edit_file\`, or \`fs_delete_file\`. If the user did not specify the target path clearly, ask one short clarification instead.
- If the user wants something opened in the IDE, prefer \`create_script_project\` for new files/projects and \`open_workspace_file_in_ide\` for existing workspace files.
- Do not drag in stale themes from memory (for example portfolio/website history) unless the current user message is actually about that theme.
${websiteBuildRules}

Available tools for this turn:
${toolList || '- none shortlisted for this turn'}${blockedToolsHint}`;

    let contextPack = buildContextPack({
      objective: message,
      taskMode,
      runtimeProfile,
      sections: [
        { label: 'Pinned Task', content: runtimeHints?.taskBrief ? clipText(runtimeHints.taskBrief, runtimeProfile.summaryCharLimit) : '', priority: 0, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'Earlier Conversation', content: summarySection, priority: 1, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'Active Skill', content: skillsSection, priority: 2, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'User Facts', content: graphSection, priority: 3, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'Memories', content: memoriesSection, priority: 4, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'Avoid', content: feedbackSection, priority: 5, maxChars: Math.floor(runtimeProfile.summaryCharLimit * 0.8) },
        { label: 'Knowledge Base', content: knowledgeSection, priority: 6, maxChars: runtimeProfile.summaryCharLimit },
      ],
    });

    if (orchestrationSettings.scopedAgentsEnabled && autonomyProfile.preferResearchPass && taskMode === 'research') {
      const researchBrief = await runResearchBriefSpecialist(llmConfig, orchestrationSettings, contextPack);
      if (researchBrief) {
        orchestrationRoutes.push(researchBrief.route);
        orchestrationStageTraces.push(researchBrief.trace);
        contextPack = buildContextPack({
          objective: message,
          taskMode,
          runtimeProfile,
          sections: [
            { label: 'Research Brief', content: researchBrief.summary, priority: 0, maxChars: runtimeProfile.summaryCharLimit },
            ...contextPack.sections.map((section, index) => ({
              label: section.label,
              content: section.content,
              priority: index + 1,
              maxChars: Math.max(runtimeProfile.sectionItemLimit * 3, section.content.length),
            })),
          ],
        });
      }
    }

    let systemPrompt = `${BASE_PROMPT}\n\n${contextPack.combined}`.trim();

    const recentMessages = compressedConversation.messages
      .filter((entry) => entry.role !== 'system')
      .slice(-runtimeProfile.historyBudget);
    const buildConversationMessages = (
      messages: typeof recentMessages,
      recentLimit: number,
      olderLimit: number,
    ): LLMMessage[] => messages.map((m, idx) => {
      if (image && idx === messages.length - 1 && m.role === 'user') {
        return {
          role: m.role as 'user' | 'assistant',
          content: clipText(
            m.content,
            idx >= messages.length - 4 ? recentLimit : olderLimit,
          ),
          images: [`data:${image.mimeType};base64,${image.base64}`],
        };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: clipText(
          m.content,
          idx >= messages.length - 4 ? recentLimit : olderLimit,
        ),
      };
    });

    let conversationMessages = buildConversationMessages(
      recentMessages,
      runtimeProfile.recentMessageCharLimit,
      runtimeProfile.olderMessageCharLimit,
    );
    let aiMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
    ];

    const estimatePromptTokens = (messages: LLMMessage[]) =>
      messages.reduce((sum, entry) => sum + estimateTokens(entry.content), 0);

    if (estimatePromptTokens(aiMessages) > runtimeProfile.promptTokenBudget) {
      conversationMessages = buildConversationMessages(
        recentMessages.slice(-Math.max(6, Math.floor(runtimeProfile.historyBudget * 0.7))),
        Math.floor(runtimeProfile.recentMessageCharLimit * 0.8),
        Math.floor(runtimeProfile.olderMessageCharLimit * 0.75),
      );
      aiMessages = [{ role: 'system', content: systemPrompt }, ...conversationMessages];
    }

    if (estimatePromptTokens(aiMessages) > runtimeProfile.promptTokenBudget) {
      systemPrompt = BASE_PROMPT.trim();
      aiMessages = [{ role: 'system', content: systemPrompt }, ...conversationMessages];
    }

    if (runtimeHints?.continueFrom) {
      aiMessages.push({
        role: 'user',
        content: `Continue your previous answer from this point without repeating what was already said:\n${clipText(runtimeHints.continueFrom, 800)}`,
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const send = (data: string) => {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        // First event: metadata (conversationId, skillsUsed, model info)
        send(JSON.stringify({
          type: 'meta',
          conversationId: convId,
          skillsUsed: skillsUsedNames,
          model: llmConfig.model || provider.name,
          provider: llmConfig.provider,
          taskMode,
          autonomyProfile: autonomyProfile.id,
          autonomyLabel: autonomyProfile.label,
          chatPowerMode,
          chatPermissionMode,
          chatSpeedMode: requestedChatSpeed,
          routeSummary: summarizeRoutes(orchestrationRoutes),
          contextPackTokens: contextPack.estimatedTokens,
          droppedContextSections: contextPack.droppedSections,
          contextWindow: runtimeProfile.contextWindow,
          historyBudget: runtimeProfile.historyBudget,
          promptTokenBudget: runtimeProfile.promptTokenBudget,
          memoryScope: 'conversation+global-instruction',
          memoryUsed: memoryUsedPreview,
          qualityMode: runtimeProfile.qualityMode,
          modelReliability: modelProfile.reliability,
          modelNotes: modelProfile.notes,
          safeMaxTokens: modelProfile.safeMaxTokens,
        }));

        let fullContent = '';
        let savedMessageId = '';
        let errorAlreadyEmitted = false;
        const toolsUsedInCall: string[] = [];
        const collectedToolResults: string[] = [];
        const orchestrationNotes: string[] = [];
        const streamStartTime = Date.now();
        let responseGenerationMeta: Awaited<ReturnType<typeof streamProviderText>> | null = null;
        const stripIdeMarker = (content: string) => content.replace(/__ide_project_id:[\w-]+/, '').trim();

        const maybeEmitIdeOpen = (content: string) => {
          const ideMatch = content.match(/__ide_project_id:([\w-]+)/);
          if (ideMatch) {
            send(JSON.stringify({ type: 'ide_open', projectId: ideMatch[1] }));
          }
          return stripIdeMarker(content);
        };

        const emitModelError = (error: unknown, partialContent = '') => {
          const classified = classifyLLMError(error);
          errorAlreadyEmitted = true;
          send(JSON.stringify({
            type: 'error_limit',
            errorType: classified.type,
            message: classified.message,
            model: llmConfig.model || provider.name,
            provider: llmConfig.provider,
            partialContent: partialContent.slice(-600),
          }));
          return classified;
        };

        const streamChunks = async (messagesToSend: LLMMessage[], forward = true) => {
          const result = await streamProviderText(provider, messagesToSend, (chunk) => {
            if (!forward) return;
            send(JSON.stringify({ type: 'chunk', content: chunk }));
          });
          responseGenerationMeta = result;
          return result.content;
        };

        const mergeContinuationText = (existing: string, addition: string): string => {
          const left = existing;
          const right = addition.trimStart();
          if (!right) return left;
          if (!left) return right;

          const tail = left.slice(-1500);
          const maxOverlap = Math.min(800, tail.length, right.length);
          for (let size = maxOverlap; size >= 40; size -= 1) {
            const overlap = right.slice(0, size);
            if (tail.endsWith(overlap)) {
              return left + right.slice(size);
            }
          }

          if (left.endsWith('\n') || right.startsWith('\n')) {
            return left + right;
          }
          return `${left}\n${right}`;
        };

        const evaluateAndEmitPolicyGate = async (toolName: string, args: Record<string, unknown>) => {
          const policy = await evaluateToolPolicy(toolName);
          if (policy.mode === 'allow') {
            return {
              allowed: true as const,
              policy,
              reviewId: null as string | null,
            };
          }

          const reviewEvent = await tryRecordAuditEvent({
            source: 'chat',
            action: 'tool_execution',
            entityType: 'tool',
            entityId: toolName,
            entityLabel: toolName,
            status: policy.mode === 'review' ? 'review_required' : 'blocked',
            severity: 'warning',
            summary:
              policy.mode === 'review'
                ? `Mission Control review required for ${toolName}`
                : `Mission Control blocked ${toolName}`,
            details: {
              toolName,
              arguments: args,
              category: policy.category,
              reason: policy.reason,
            },
            conversationId: convId,
          });

          send(
            JSON.stringify({
              type: policy.mode === 'review' ? 'policy_review_required' : 'policy_blocked',
              toolName,
              category: policy.category,
              reviewId: reviewEvent?.id ?? null,
              reason: policy.reason,
            }),
          );

          return {
            allowed: false as const,
            policy,
            reviewId: reviewEvent?.id ?? null,
          };
        };

        const emitPendingApproval = async (toolName: string, args: Record<string, unknown>) => {
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
          const reviewEvent = await tryRecordAuditEvent({
            source: 'chat',
            action: 'tool_execution',
            entityType: 'tool',
            entityId: toolName,
            entityLabel: toolName,
            status: 'review_required',
            severity: 'warning',
            summary: `Awaiting user approval for ${toolName}`,
            details: {
              toolName,
              arguments: args,
              reason: 'chat_permission_mode',
              expiresAt: expiresAt.toISOString(),
            },
            conversationId: convId,
          });

          const createdAt = reviewEvent?.createdAt
            ? new Date(reviewEvent.createdAt).toISOString()
            : new Date().toISOString();

          send(
            JSON.stringify({
              type: 'pending_action',
              toolName,
              arguments: args,
              conversationId: convId,
              permissionMode: chatPermissionMode,
              reviewId: reviewEvent?.id ?? null,
              createdAt,
              expiresAt: expiresAt.toISOString(),
            }),
          );
        };

        const executeGovernedTool = async (toolName: string, args: Record<string, unknown>) => {
          const targetPath = typeof args.path === 'string' ? args.path.trim() : '';
          const requiresExplicitTarget = new Set([
            'fs_write_file',
            'fs_read_file',
            'fs_edit_file',
            'fs_delete_file',
            'open_workspace_file_in_ide',
          ]);
          if (
            requiresExplicitTarget.has(toolName) &&
            targetPath &&
            isGenericGuessedPath(targetPath) &&
            !hasExplicitWorkspaceTarget(message)
          ) {
            return {
              toolName,
              content: '',
              error: `The user did not specify a clear workspace file path. Ask one short clarification about where to save or which file to open instead of guessing "${targetPath}".`,
            };
          }

          let tool = runtimeTools.find((entry) => entry.name === toolName);
          const fallbackLocalTool = allTools.find((entry) => entry.name === toolName);
          if (!tool && !singleFileHtmlRequest && fallbackLocalTool && isToolAllowedForPowerMode(toolName, chatPowerMode, chatMcpAllowlist)) {
            tool = fallbackLocalTool;
          }
          if (!tool) {
            const knownTool = fallbackLocalTool;
            const knownMcpTool = discoveredMcpTools.find((entry) => entry.name === toolName);
            const blockedByPowerMode = Boolean(
              (knownTool || knownMcpTool) && !isToolAllowedForPowerMode(toolName, chatPowerMode, chatMcpAllowlist),
            );
            if (blockedByPowerMode) {
              await tryRecordAuditEvent({
                source: 'chat',
                action: 'tool_execution',
                entityType: 'tool',
                entityId: toolName,
                entityLabel: toolName,
                status: 'blocked',
                severity: 'warning',
                summary: `Tool ${toolName} blocked by chat power mode`,
                details: {
                  toolName,
                  arguments: args,
                  reason: 'chat_power_mode',
                  chatPowerMode,
                },
                conversationId: convId,
              });
              send(
                JSON.stringify({
                  type: 'power_mode_blocked',
                  toolName,
                  mode: chatPowerMode,
                  reason: `Tool "${toolName}" is blocked in ${chatPowerMode} mode.`,
                }),
              );
              return {
                toolName,
                content: '',
                error: `Tool "${toolName}" is blocked by chat power mode (${chatPowerMode}). Raise chat power mode in Settings to use it.`,
              };
            }
            return { toolName, content: '', error: `Tool "${toolName}" is not available.` };
          }

          const policyGate = await evaluateAndEmitPolicyGate(toolName, args);
          if (!policyGate.allowed) {
            return {
              toolName,
              content: '',
              error:
                policyGate.policy.mode === 'review'
                  ? `Mission Control review required for ${toolName}. Open Mission Control > Trust Center to approve it.`
                  : `Mission Control blocked ${toolName}. ${policyGate.policy.reason}`,
            };
          }

          send(JSON.stringify({ type: 'tool_start', toolName }));
          const result = await tool.execute(args);
          toolsUsedInCall.push(toolName);

          const normalized = result.error
            ? result
            : { ...result, content: maybeEmitIdeOpen(result.content) };
          collectedToolResults.push(
            normalized.error
              ? `[${toolName}] ERROR: ${normalized.error}`
              : `[${toolName}] ${normalized.content}`,
          );

          if (normalized.error) {
            send(JSON.stringify({ type: 'tool_error', toolName, error: normalized.error }));
          }
          send(JSON.stringify({ type: 'tool_done', toolName }));

          await tryRecordAuditEvent({
            source: 'chat',
            action: 'tool_execution',
            entityType: 'tool',
            entityId: toolName,
            entityLabel: toolName,
            status: normalized.error ? 'error' : 'success',
            severity: normalized.error ? 'warning' : 'info',
            summary: normalized.error ? `Tool ${toolName} failed` : `Tool ${toolName} executed`,
            details: {
              toolName,
              arguments: args,
              category: policyGate.policy.category,
              resultPreview: (normalized.error || normalized.content).slice(0, 500),
            },
            conversationId: convId,
          });

          return normalized;
        };

        // Chat permission mode approval gate (separate from Mission Control policy).

        // Resume mode: execute a pre-approved tool call and skip the main LLM turn.
        if (resumeToolCall) {
          const result = await executeGovernedTool(resumeToolCall.name, resumeToolCall.arguments);
          if (result.error) {
            fullContent = `Sorry, the action failed: ${result.error}`;
            send(JSON.stringify({ type: 'replace', content: fullContent }));
          } else {
            send(JSON.stringify({ type: 'replace', content: '' }));
            const isProject = resumeToolCall.name === 'create_script_project';
            const followUpPrompt = isProject
              ? `TOOL RESULT:\n[${resumeToolCall.name}] ${result.content}\n\nThe project was saved and opened in the IDE automatically. Confirm in ONE short sentence (e.g. "React Todo App created with 5 files and opened in the IDE."). Do not list features or show code.`
              : `TOOL RESULTS:\n[${resumeToolCall.name}] ${result.content}\n\nAnswer the original question using this data.`;
            try {
              fullContent = await streamChunks([
                { role: 'system' as const, content: systemPrompt },
                { role: 'user' as const, content: message },
                { role: 'user' as const, content: followUpPrompt },
              ], true);
            } catch { /* follow-up failed; ignore */ }
            if (!fullContent.trim()) {
              fullContent = clipText(result.content || `Completed ${resumeToolCall.name}.`, 900);
              send(JSON.stringify({ type: 'replace', content: fullContent }));
            }
          }
          // Skip the rest of the stream logic and fall through to save and done.
        } else {

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 2: Sequential Orchestrator ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        let agentPlanSteps: string[] | null = null;
        if (requestedChatSpeed !== 'simple' && !lightContextTurn && taskMode !== 'chat' && !websiteBuildIntent && autonomyProfile.autoPlan) {
          if (orchestrationSettings.scopedAgentsEnabled) {
            const plannerPlan = await runPlannerSpecialist(llmConfig, orchestrationSettings, taskMode, contextPack);
            if (plannerPlan?.steps?.length) {
              orchestrationRoutes.push(plannerPlan.route);
              orchestrationStageTraces.push(plannerPlan.trace);
              agentPlanSteps = plannerPlan.steps.slice(0, autonomyProfile.maxAutonomousSteps);
              if (plannerPlan.notes) {
                orchestrationNotes.push(plannerPlan.notes);
              }
            }
          }

          if (!agentPlanSteps && runtimeProfile.allowTaskDecomposition) {
            agentPlanSteps = await decomposeTask(message, provider);
          }
        }

        if (agentPlanSteps && agentPlanSteps.length >= 2) {
          // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ ORCHESTRATOR MODE ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
          send(JSON.stringify({ type: 'agent_plan', steps: agentPlanSteps }));

          const stepOutputs: string[] = [];

          for (let i = 0; i < agentPlanSteps.length; i++) {
            const stepName = agentPlanSteps[i];
            const stepSkill = selectRelevantSkill(skills, stepName, '');
            send(JSON.stringify({ type: 'agent_step_start', stepId: i, name: stepName, skill: stepSkill?.name ?? null }));

            const priorCtx = stepOutputs.length > 0
              ? `\nCompleted steps:\n${stepOutputs.map((o, j) => `Step ${j + 1}: ${o.slice(0, 300)}`).join('\n')}`
              : '';

            const stepMsgs: LLMMessage[] = [
              {
                role: 'system',
                content: BASE_PROMPT + '\n' + (buildSkillContext(stepSkill, {
                  compact: true,
                  descriptionLimit: runtimeProfile.skillDescriptionLimit,
                  instructionLimit: Math.min(runtimeProfile.skillInstructionLimit, 500),
                }) || ''),
              },
              { role: 'user', content: `Goal: ${message.slice(0, 200)}\n\nComplete this step now: **${stepName}**${priorCtx}\n\nBe concise and focused on just this step.` },
            ];

            let stepContent = '';
            try {
              stepContent = await streamChunks(stepMsgs, false);
              // Execute any tool calls inside this step
              for (const match of [...stepContent.matchAll(/```tool\s*\r?\n([\s\S]*?)```/g)]) {
                try {
                  const tc = JSON.parse(match[1]);
                  const result = await executeGovernedTool(tc.name, tc.arguments || {});
                  if (!result.error) {
                    stepContent = stepContent.replace(/```tool[\s\S]*?```/g, '').trim() + '\n' + result.content;
                  }
                } catch { /* skip malformed */ }
              }
            } catch { stepContent = ''; }

            stepOutputs.push(stepContent || `(Step ${i + 1} had no output)`);
            send(JSON.stringify({ type: 'agent_step_done', stepId: i, name: stepName, output: stepContent.slice(0, 600) }));
          }

          // Synthesis turn
          const synthPrompt = `You completed these research steps for the request: "${message.slice(0, 200)}"

${agentPlanSteps.map((s, i) => `**Step ${i + 1}: ${s}**\n${stepOutputs[i].slice(0, 600)}`).join('\n\n---\n\n')}

Now synthesize this into a comprehensive, well-structured final response. Use markdown formatting.`;

          try {
            fullContent = await streamChunks([
              { role: 'system', content: systemPrompt },
              { role: 'user', content: synthPrompt },
            ], true);
          } catch {
            fullContent = agentPlanSteps.map((s, i) => `**${s}**\n${stepOutputs[i]}`).join('\n\n---\n\n');
            send(JSON.stringify({ type: 'chunk', content: fullContent }));
          }

        } else {
          // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ NORMAL SINGLE-TURN MODE ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
          // Build the set of tool-call trigger patterns once (used for real-time detection)
          const toolCallPatterns = runtimeTools.flatMap((t) => [
            `"name":"${t.name}"`,
            `"name": "${t.name}"`,
          ]);
          // toolSignalDetected: flips to true the moment we see a tool call forming.
          // Once set, we stop forwarding chunks to the client so the user never sees
          // preamble text / code blocks that appear before the tool JSON.
          let toolSignalDetected = false;
          let rawModelOutput = '';

          try {
            const result = await streamProviderText(provider, aiMessages, (chunk) => {
              rawModelOutput += chunk;
              if (!toolSignalDetected && (
                rawModelOutput.includes('```tool') ||
                toolCallPatterns.some((pattern) => rawModelOutput.includes(pattern))
              )) {
                toolSignalDetected = true;
              }
              if (!toolSignalDetected) {
                send(JSON.stringify({ type: 'chunk', content: chunk }));
              }
            });
            responseGenerationMeta = result;
            fullContent = result.content || rawModelOutput;
          } catch (error) {
            emitModelError(error, fullContent);
          }

          // Parse and execute tool calls embedded in the response
          const toolCallRegex = /```tool\s*\r?\n([\s\S]*?)```/g;
          const toolMatches = singleFileHtmlRequest
            ? []
            : [...fullContent.matchAll(toolCallRegex)];
          const toolResults: string[] = [];

          let pendingActionEmitted = false;
          for (const match of toolMatches) {
            try {
              const toolCall = JSON.parse(match[1]);
              const toolArgs =
                toolCall.arguments && typeof toolCall.arguments === 'object'
                  ? (toolCall.arguments as Record<string, unknown>)
                  : {};
              const policyGate = await evaluateAndEmitPolicyGate(toolCall.name, toolArgs);
              if (!policyGate.allowed) {
                continue;
              }
              // Tools in approval mode need user sign-off before execution.
              if (shouldRequireToolApproval(toolCall.name, chatPermissionMode, preApprovedTools)) {
                await emitPendingApproval(toolCall.name, toolArgs);
                pendingActionEmitted = true;
                continue; // skip auto-execution
              }
              const result = await executeGovernedTool(toolCall.name, toolArgs);
              if (result.error) {
                toolResults.push(`[${toolCall.name}] ERROR: ${result.error}`);
              } else {
                toolResults.push(`[${toolCall.name}] ${result.content}`);
              }
            } catch { /* ignore malformed tool calls */ }
          }

          // If no tool was called but model apologised, nudge it once with a retry
          if (!singleFileHtmlRequest && toolMatches.length === 0 && toolResults.length === 0 && !pendingActionEmitted) {
            // Fallback: model may have output the tool JSON as plain text (no fences)
            const toolNamesSet = runtimeTools.map((t) => t.name);
            const inlineTool = extractInlineToolCall(fullContent, toolNamesSet);
            if (inlineTool) {
              const policyGate = await evaluateAndEmitPolicyGate(inlineTool.name, inlineTool.arguments);
              if (policyGate.allowed) {
                if (shouldRequireToolApproval(inlineTool.name, chatPermissionMode, preApprovedTools)) {
                  await emitPendingApproval(inlineTool.name, inlineTool.arguments);
                  pendingActionEmitted = true;
                } else {
                  const result = await executeGovernedTool(inlineTool.name, inlineTool.arguments);
                  if (result.error) {
                    toolResults.push(`[${inlineTool.name}] ERROR: ${result.error}`);
                  } else {
                    toolResults.push(`[${inlineTool.name}] ${result.content}`);
                  }
                }
              }
            }
          }

          // Direct reliability fallback for weather/time/search intents when the model
          // does not emit a valid tool payload (common on some local models).
          if (!singleFileHtmlRequest && toolMatches.length === 0 && toolResults.length === 0 && !pendingActionEmitted) {
            const directIntent = detectDirectToolIntent(message);
            if (directIntent) {
              const policyGate = await evaluateAndEmitPolicyGate(directIntent.toolName, directIntent.arguments);
              if (policyGate.allowed) {
                if (shouldRequireToolApproval(directIntent.toolName, chatPermissionMode, preApprovedTools)) {
                  await emitPendingApproval(directIntent.toolName, directIntent.arguments);
                  pendingActionEmitted = true;
                } else {
                  const result = await executeGovernedTool(directIntent.toolName, directIntent.arguments);
                  if (result.error) {
                    toolResults.push(`[${directIntent.toolName}] ERROR: ${result.error}`);
                  } else {
                    toolResults.push(`[${directIntent.toolName}] ${result.content}`);
                  }
                }
              }
            }
          }

          // If no tool was called but model apologised, nudge it once with a retry
          if (!singleFileHtmlRequest && toolMatches.length === 0 && toolResults.length === 0) {
            const isApologetic = fullContent.length < 250 &&
              /I (don't|cannot|can't|do not)|I'm (not able|unable)|I (don't|do not) have (access|the ability|real-time)/i.test(fullContent);
            if (isApologetic) {
              fullContent = '';
              const nudge: LLMMessage = {
                role: 'user',
                content: 'You have real-time tools available. Use the correct tool now to answer the original question.',
              };
              try {
                fullContent = await streamChunks([...aiMessages, nudge], true);
              } catch (error) {
                emitModelError(error, fullContent);
              }
              // Execute tool calls from the retry response
              for (const match of [...fullContent.matchAll(toolCallRegex)]) {
                try {
                  const toolCall = JSON.parse(match[1]);
                  const toolArgs =
                    toolCall.arguments && typeof toolCall.arguments === 'object'
                      ? (toolCall.arguments as Record<string, unknown>)
                      : {};
                  const policyGate = await evaluateAndEmitPolicyGate(toolCall.name, toolArgs);
                  if (!policyGate.allowed) {
                    continue;
                  }
                  if (shouldRequireToolApproval(toolCall.name, chatPermissionMode, preApprovedTools)) {
                    await emitPendingApproval(toolCall.name, toolArgs);
                    pendingActionEmitted = true;
                    continue;
                  }
                  const result = await executeGovernedTool(toolCall.name, toolArgs);
                  if (result.error) {
                    toolResults.push(`[${toolCall.name}] ERROR: ${result.error}`);
                  } else {
                    toolResults.push(`[${toolCall.name}] ${result.content}`);
                  }
                } catch { /* skip */ }
              }
            }
          }

          // If a non-project tool call looked intended but malformed, retry once with strict formatting guidance.
          if (!singleFileHtmlRequest && toolSignalDetected && toolMatches.length === 0 && toolResults.length === 0 && !pendingActionEmitted && !websiteBuildIntent) {
            fullContent = '';
            const strictToolRetry: LLMMessage = {
              role: 'user',
              content:
                'Your previous tool call was malformed. Retry now with exactly one valid ```tool block only for one of the available tools.',
            };
            try {
              fullContent = await streamChunks([...aiMessages, strictToolRetry], true);
            } catch (error) {
              emitModelError(error, fullContent);
            }

            for (const match of [...fullContent.matchAll(toolCallRegex)]) {
              try {
                const toolCall = JSON.parse(match[1]);
                const toolArgs =
                  toolCall.arguments && typeof toolCall.arguments === 'object'
                    ? (toolCall.arguments as Record<string, unknown>)
                    : {};
                const policyGate = await evaluateAndEmitPolicyGate(toolCall.name, toolArgs);
                if (!policyGate.allowed) {
                  continue;
                }
                if (shouldRequireToolApproval(toolCall.name, chatPermissionMode, preApprovedTools)) {
                  await emitPendingApproval(toolCall.name, toolArgs);
                  pendingActionEmitted = true;
                  continue;
                }
                const result = await executeGovernedTool(toolCall.name, toolArgs);
                if (result.error) {
                  toolResults.push(`[${toolCall.name}] ERROR: ${result.error}`);
                } else {
                  toolResults.push(`[${toolCall.name}] ${result.content}`);
                }
              } catch { /* skip malformed */ }
            }

            if (toolResults.length === 0) {
              const retryInline = extractInlineToolCall(fullContent, runtimeTools.map((t) => t.name));
              if (retryInline) {
                const policyGate = await evaluateAndEmitPolicyGate(retryInline.name, retryInline.arguments);
                if (!policyGate.allowed) {
                  // policy event already emitted
                } else {
                  if (shouldRequireToolApproval(retryInline.name, chatPermissionMode, preApprovedTools)) {
                    await emitPendingApproval(retryInline.name, retryInline.arguments);
                    pendingActionEmitted = true;
                  } else {
                    const result = await executeGovernedTool(retryInline.name, retryInline.arguments);
                    if (result.error) {
                      toolResults.push(`[${retryInline.name}] ERROR: ${result.error}`);
                    } else {
                      toolResults.push(`[${retryInline.name}] ${result.content}`);
                    }
                  }
                }
              }
            }
          }

          // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Restore content on false-positive tool signal ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
          // toolSignalDetected stopped streaming to client, but no tool was actually found.
          // Put the clean content back so the user sees a normal response.
          // Skip restore if a pending_action was emitted ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the approval card handles UX.
          if (toolSignalDetected && toolMatches.length === 0 && toolResults.length === 0 && !pendingActionEmitted) {
            const toolNamesSet2 = runtimeTools.map((t) => t.name);
            const inlineFallback = extractInlineToolCall(fullContent, toolNamesSet2);
            if (!inlineFallback) {
              // Genuinely no tool ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â restore stripped content
              const restored = fullContent.replace(/```tool\s*\r?\n[\s\S]*?```/g, '').trim();
              send(JSON.stringify({ type: 'replace', content: restored }));
            }
          }

          if (toolResults.length > 0) {
            // Clear ALL previously streamed/shown content ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â preamble, code blocks, raw JSON ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â everything.
            // The follow-up stream is the only thing the user should see.
            send(JSON.stringify({ type: 'replace', content: '' }));

            const toolContext = toolResults.join('\n\n');
            const isProjectCreation = toolsUsedInCall.includes('create_script_project');
            const deterministicFallback = buildToolResultFallback(toolResults, isProjectCreation);
            const onlyDirectResponseTools =
              toolsUsedInCall.length > 0 &&
              toolsUsedInCall.every((toolName) => DIRECT_TOOL_RESPONSE_TOOLS.has(toolName));
            const hasToolErrors = toolResults.some((entry) => /\] ERROR:/i.test(entry));

            if (!isProjectCreation && onlyDirectResponseTools && !hasToolErrors) {
              fullContent = deterministicFallback;
              send(JSON.stringify({ type: 'replace', content: fullContent }));
            } else {
            const followUpMessages = [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: message },
              {
                role: 'user' as const,
                content: isProjectCreation
                  ? `TOOL RESULT:\n${toolContext}\n\nThe project was saved and the IDE opened automatically. Confirm in ONE short sentence (e.g. "Snake Game created with 2 files and opened in the IDE."). Do not list features, do not show code.`
                  : `TOOL RESULTS (ground truth - use ONLY this data):\n${toolContext}\n\nAnswer the original question directly and concisely. Do not mention tool calls.`,
              },
            ];
            let followUpContent = '';
            try {
              followUpContent = await streamChunks(followUpMessages, true);
            } catch (error) {
              emitModelError(error, followUpContent);
            }
            if (
              followUpContent.trim() &&
              !hasToolErrors &&
              /(?:i (?:do not|don't|cannot|can't)|i'm unable|not available|don't have access|builder mode)/i.test(followUpContent)
            ) {
              followUpContent = deterministicFallback;
              send(JSON.stringify({ type: 'replace', content: followUpContent }));
            }
            if (!followUpContent.trim()) {
              followUpContent = deterministicFallback;
              send(JSON.stringify({ type: 'replace', content: followUpContent }));
            }
            fullContent = followUpContent || deterministicFallback;
            }
          }
        }

        } // end of else (non-resume) block

        if (
          requestedChatSpeed !== 'simple' &&
          !lightContextTurn &&
          taskMode !== 'chat' &&
          orchestrationSettings.scopedAgentsEnabled &&
          autonomyProfile.autoVerify &&
          fullContent.trim()
        ) {
          const verification = await runVerifierSpecialist(
            llmConfig,
            orchestrationSettings,
            taskMode,
            contextPack,
            fullContent,
            collectedToolResults,
          );

          if (verification) {
            orchestrationRoutes.push(verification.route);
            orchestrationStageTraces.push(verification.trace);
            orchestrationNotes.push(`Verifier ${verification.verdict} (${verification.confidence})`);
            send(JSON.stringify({
              type: 'verification',
              verdict: verification.verdict,
              summary: verification.summary,
              followUp: verification.followUp || null,
              confidence: verification.confidence,
            }));

            if (verification.verdict === 'revise' && verification.followUp) {
              let revisedContent = '';
              try {
                revisedContent = await streamChunks([
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: message },
                  { role: 'assistant', content: fullContent },
                  {
                    role: 'user',
                    content: `Revise the previous answer to satisfy this verification feedback:\n${verification.followUp}\n\nKeep the answer grounded, concise, and complete.`,
                  },
                ], false);
              } catch {
                revisedContent = '';
              }
              if (revisedContent.trim()) {
                fullContent = revisedContent.trim();
                send(JSON.stringify({ type: 'replace', content: fullContent }));
              }
            }
          }
        }

        if (requestedChatSpeed !== 'simple' && !lightContextTurn && responseGenerationMeta?.finishReason === 'length' && fullContent.trim()) {
          const maxAutoContinuations = runtimeProfile.qualityMode === 'high-context' ? 3 : 2;
          const maxAllowedChars = Math.max(12_000, (llmConfig.maxTokens ?? runtimeProfile.responseTokens) * 5);
          let autoContinuationCount = 0;

          while (
            autoContinuationCount < maxAutoContinuations &&
            responseGenerationMeta?.finishReason === 'length' &&
            fullContent.length < maxAllowedChars
          ) {
            autoContinuationCount += 1;
            const assistantTail = fullContent.slice(
              -Math.max(1_600, Math.min(18_000, Math.floor(runtimeProfile.promptTokenBudget * 2.8))),
            );
            const continuationMessages: LLMMessage[] = [
              {
                role: 'system',
                content: `${systemPrompt}\n\nContinuation mode: continue the same answer exactly where it stopped. Do not repeat completed sections.`,
              },
              ...conversationMessages.slice(-Math.max(4, Math.min(runtimeProfile.historyBudget, 12))),
              { role: 'assistant', content: assistantTail },
              {
                role: 'user',
                content: 'Continue directly from the cutoff point. No recap. No repeated paragraphs. Finish the remaining answer.',
              },
            ];

            let continuation = '';
            try {
              continuation = await streamChunks(continuationMessages, false);
            } catch {
              break;
            }

            const trimmedContinuation = continuation.trim();
            if (!trimmedContinuation) {
              break;
            }

            fullContent = mergeContinuationText(fullContent, trimmedContinuation);
            send(JSON.stringify({ type: 'replace', content: fullContent }));
          }

          if (autoContinuationCount > 0) {
            orchestrationNotes.push(`Auto-continued response ${autoContinuationCount} time(s) after length stop.`);
          }
        }

        if (responseGenerationMeta?.finishReason === 'length' && fullContent.trim()) {
          send(JSON.stringify({
            type: 'error_limit',
            errorType: 'token_limit',
            message: 'The response hit the model output limit. Auto-continue tried first. Use continue to resume from the partial answer without restarting the chat.',
            partialContent: fullContent.slice(-1200),
          }));
        }

        if (!fullContent.trim() && !errorAlreadyEmitted) {
          fullContent = responseGenerationMeta?.reasoningOnly
            ? `Model returned reasoning tokens but no visible answer. The model (${modelProfile.label}) may only output internal thinking. Try disabling reasoning/thinking mode in the model settings, or switch to a different model.`
            : `Model returned an empty response. This can happen when the model name is wrong, the API key lacks access to this model, or the model doesn't support the current request format. Check your provider settings and model ID.`;
          send(JSON.stringify({ type: 'replace', content: fullContent }));
        }

        // Auto-update conversation title after the 2nd exchange (once context is set)
        if (runtimeProfile.allowBackgroundIntelligence && allMessages.length === 2) {
          (async () => {
            let title = '';
            try {
              const titleResult = await streamProviderText(provider, [{
                role: 'user',
                content: `Generate a short conversation title (max 6 words, no quotes, no trailing punctuation) that captures what this conversation is about: "${message.slice(0, 200)}"`,
              }]);
              title = titleResult.content;
              if (title.trim()) {
                await db.conversation.update({ where: { id: convId }, data: { title: title.trim().slice(0, 60) } });
              }
            } catch { /* ignore */ }
          })();
        }

        // Check learning suggestions
        const learningSuggestions: string[] = [];
        const learningPatterns = [
          /I (don't|do not) (know|have information|understand) (about|how to|what is|what are)\s+(.+)/gi,
          /I('m| am) (not |un)aware of\s+(.+)/gi,
        ];
        for (const pattern of learningPatterns) {
          for (const match of fullContent.matchAll(pattern)) {
            learningSuggestions.push(match[0]);
          }
        }

        // Emit completion before persistence so UI never gets stuck in "Thinking..."
        // when DB/audit writes are slow.
        const dedupedToolsUsed = [...new Set(toolsUsedInCall)];
        send(JSON.stringify({
          type: 'done',
          messageId: null,
          learningSuggestions: [...new Set(learningSuggestions)],
          toolsUsed: dedupedToolsUsed,
          resolvedModel: responseGenerationMeta?.model || llmConfig.model || provider.name || '',
        }));
        controller.close();

        // Persist in background after stream completion.
        void (async () => {
          try {
            const latencyMs = Date.now() - streamStartTime;
            const estimatedTokens = estimateTokens(fullContent);
            orchestrationStageTraces.unshift({
              stage: 'main',
              model: llmConfig.model || provider.name || '',
              promptTokens: estimatePromptTokens(aiMessages),
              outputTokens: estimatedTokens,
              usedFallback: responseGenerationMeta?.usedFallback,
              finishReason: responseGenerationMeta?.finishReason,
            });

            const saved = await db.message.create({
              data: {
                conversationId: convId,
                role: 'assistant',
                content: fullContent,
                skillsUsed: JSON.stringify(skillsUsedIds),
                tokenCount: estimatedTokens,
                latencyMs,
                toolCalls: JSON.stringify(dedupedToolsUsed),
                modelUsed: llmConfig.model || provider.name || '',
              },
            });
            savedMessageId = saved.id;

            if (memoryUsedPreview.length > 0) {
              await tryRecordAuditEvent({
                source: 'chat',
                action: 'memory_context_used',
                entityType: 'conversation',
                entityId: convId,
                entityLabel: convId,
                status: 'success',
                severity: 'info',
                summary: `Used ${memoryUsedPreview.length} memory item(s) for this turn`,
                details: {
                  memoryScope: 'conversation+global-instruction',
                  memoryUsed: memoryUsedPreview,
                },
                conversationId: convId,
              });
            }

            if (orchestrationSettings.tokenTelemetryEnabled) {
              if (contextPack.droppedSections.length > 0) {
                orchestrationNotes.push(`Dropped context sections: ${contextPack.droppedSections.join(', ')}`);
              }
              orchestrationNotes.push(`Memory used: ${memoryUsedPreview.length} item(s)`);
              await recordOrchestrationTrace({
                source: 'chat',
                entityId: savedMessageId,
                entityLabel: llmConfig.model || provider.name || '',
                conversationId: convId,
                taskMode,
                autonomyProfile: autonomyProfile.id,
                provider: llmConfig.provider,
                model: llmConfig.model || provider.name || '',
                promptTokens: estimatePromptTokens(aiMessages),
                outputTokens: estimatedTokens,
                contextTokens: contextPack.estimatedTokens,
                toolsUsed: dedupedToolsUsed,
                routes: orchestrationRoutes,
                stages: orchestrationStageTraces,
                notes: orchestrationNotes,
              }).catch(() => {});
            }

            if (runtimeProfile.allowBackgroundIntelligence) {
              selfCritique(message, fullContent, provider).then(async (corrected) => {
                if (corrected !== fullContent && savedMessageId) {
                  await db.message.update({
                    where: { id: savedMessageId },
                    data: { content: corrected },
                  }).catch(() => {});
                }
              }).catch(() => {});

              extractGraphRelations(message, fullContent, provider).then(async (relations) => {
                for (const rel of relations) {
                  try {
                    await db.memoryRelation.upsert({
                      where: { subject_relation_object: { subject: rel.subject, relation: rel.relation, object: rel.object } },
                      update: {},
                      create: { subject: rel.subject, relation: rel.relation, object: rel.object },
                    });
                  } catch { /* ignore duplicate */ }
                }
              }).catch(() => {});
            }
          } catch (persistError) {
            const errMsg = persistError instanceof Error ? persistError.message : String(persistError);
            console.error('[Stream Persist Error]', errMsg);
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const stack = error instanceof Error ? (error.stack ?? '') : '';
    console.error('[Stream Error]', message);
    if (stack) console.error('[Stack]', stack);
    return new Response(JSON.stringify({ error: message, stack: stack.split('\n').slice(0, 5).join('\n') }), { status: 500 });
  }
}
