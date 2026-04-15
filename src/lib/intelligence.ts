/**
 * Nova Intelligence Layer
 *
 * Sliding window summarization, self-critique, re-ranking retrieval,
 * graph relation extraction, and task decomposition.
 * All functions accept an LLMProvider so they work with any configured model.
 */

import type { LLMProvider } from './llm/types';

// ─────────────────── helpers ────────────────────────────────────────────────

/** Stream a full response from the provider into a single string */
async function streamToString(
  provider: LLMProvider,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
): Promise<string> {
  let out = '';
  for await (const chunk of provider.stream(messages)) {
    out += chunk;
  }
  return out.trim();
}

// ─────────────── 1. Sliding Window Summarization ────────────────────────────

/**
 * When a conversation exceeds the threshold, compress the oldest messages into
 * a short summary and return a pruned message array.
 * Keeps the last `keepRecent` messages intact so immediate context is preserved.
 */
export async function compressConversation(
  messages: { role: string; content: string }[],
  provider: LLMProvider,
  threshold = 24,
  keepRecent = 10,
): Promise<{ messages: { role: string; content: string }[]; didCompress: boolean }> {
  const nonSystem = messages.filter((m) => m.role !== 'system');
  if (nonSystem.length < threshold) return { messages, didCompress: false };

  const system = messages.filter((m) => m.role === 'system');
  const toSummarize = nonSystem.slice(0, nonSystem.length - keepRecent);
  const recent = nonSystem.slice(nonSystem.length - keepRecent);

  const prompt = `Summarize this conversation into 5 concise bullet points capturing key facts, decisions, and important context. Be extremely brief.

${toSummarize.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`).join('\n\n')}

Output ONLY the bullet points, starting with •`;

  try {
    const summary = await streamToString(provider, [{ role: 'user', content: prompt }]);
    const summaryMessage = {
      role: 'system' as const,
      content: `[Earlier conversation summary — treat as read context]\n${summary}`,
    };

    return {
      messages: [...system, summaryMessage, ...recent],
      didCompress: true,
    };
  } catch {
    // Summarization failed — just drop the oldest messages
    return {
      messages: [...system, ...recent],
      didCompress: true,
    };
  }
}

// ──────────────────── 2. Self-Critique Pass ─────────────────────────────────

/**
 * Ask the model to fact-check its own response.
 * Only applied to responses that look like factual/technical answers.
 * Returns the (potentially corrected) response string.
 */
export async function selfCritique(
  question: string,
  response: string,
  provider: LLMProvider,
): Promise<string> {
  // Skip for short responses, greetings, or tool-output blocks
  const needsCritique =
    response.length > 150 &&
    /\?|how |what |when |where |why |explain|tell me|describe|is it|does it/i.test(question) &&
    !response.includes('```tool');

  if (!needsCritique) return response;

  const prompt = `You are a concise fact-checker. Review this response for critical factual errors only.

QUESTION: ${question.slice(0, 300)}
RESPONSE: ${response.slice(0, 1500)}

If the response is accurate and complete, output exactly: APPROVED
If there is a significant factual error, output: CORRECTION: [one sentence correction]
Do NOT add opinions. Do NOT rewrite the response.`;

  try {
    const result = await streamToString(provider, [{ role: 'user', content: prompt }]);
    if (result.startsWith('CORRECTION:')) {
      const correction = result.replace('CORRECTION:', '').trim();
      return `${response}\n\n> **Auto-check:** ${correction}`;
    }
    return response;
  } catch {
    return response;
  }
}

// ─────────────────── 3. Re-ranking Retrieval ────────────────────────────────

/**
 * After cosine-based initial retrieval, ask the LLM to re-rank candidates
 * by true relevance. Falls back to the original order on error.
 */
export async function rerankResults<T extends { topic: string; content: string }>(
  candidates: T[],
  query: string,
  provider: LLMProvider,
  topK = 3,
): Promise<T[]> {
  if (candidates.length <= topK) return candidates;

  const itemList = candidates
    .map((c, i) => `${i}: ${c.topic} — ${c.content.slice(0, 150)}`)
    .join('\n');

  const prompt = `Rate each item's relevance to the query (0-10). Output ONLY a JSON array of numbers, one per item.

Query: "${query.slice(0, 200)}"
Items:
${itemList}

JSON array (${candidates.length} numbers):`;

  try {
    const result = await streamToString(provider, [{ role: 'user', content: prompt }]);
    const match = result.match(/\[[\d\s.,]+\]/);
    if (!match) return candidates.slice(0, topK);
    const scores = JSON.parse(match[0]) as number[];
    return candidates
      .map((item, i) => ({ item, score: scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.item);
  } catch {
    return candidates.slice(0, topK);
  }
}

// ──────────────────── 4. Graph Relation Extraction ──────────────────────────

export interface MemoryRelationInput {
  subject: string;
  relation: string;
  object: string;
}

/**
 * Extract entity relationships from the conversation exchange.
 * Returns facts like { subject: "user", relation: "likes", object: "coffee" }
 */
export async function extractGraphRelations(
  userMessage: string,
  assistantResponse: string,
  provider: LLMProvider,
): Promise<MemoryRelationInput[]> {
  // Heuristic: only bother if the user message sounds personal
  const looksPersonal =
    /\b(i am|i'm|i like|i love|i hate|i work|my |i use|i prefer|i want|i need|i have|my name|i live)\b/i.test(
      userMessage,
    );
  if (!looksPersonal) return [];

  const prompt = `Extract facts about the USER from this exchange. Focus on: preferences, job, location, goals, habits.

USER: ${userMessage.slice(0, 400)}
ASSISTANT: ${assistantResponse.slice(0, 400)}

Output ONLY a compact JSON array. Use "user" as subject. Max 4 items.
Example: [{"subject":"user","relation":"likes","object":"coffee"},{"subject":"user","relation":"works_at","object":"startup"}]

If no personal facts found, output: []`;

  try {
    const result = await streamToString(provider, [{ role: 'user', content: prompt }]);
    const match = result.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as MemoryRelationInput[];
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

// ──────────────────── 5. Task Decomposition ─────────────────────────────────

/**
 * Detect complex multi-step requests and return a list of sub-tasks.
 * Returns null if the message is simple and doesn't need decomposition.
 */
export async function decomposeTask(
  message: string,
  provider: LLMProvider,
): Promise<string[] | null> {
  // Never decompose code/project creation requests — those must be handled
  // as a single tool call (create_script_project). Decomposing them causes
  // multiple partial projects to be created instead of one complete project.
  const isCodeCreation =
    /\b(create|build|make|write|scaffold|code|implement|generate)\b.{0,60}\b(app|application|component|project|script|website|game|react|html|css|javascript|jsx|tsx|todo|counter|calculator|form|widget|page|ui)\b/i.test(message) ||
    /\breact\b|\bjsx\b|\bcomponent\b|\busestate\b|\bvanilla (js|html|css)\b/i.test(message);

  if (isCodeCreation) return null;

  const isComplex =
    message.length > 80 &&
    /\b(plan|build|create|develop|implement|organize|research|analyze|write a|design|make me a|help me (create|build|plan|write|design|research|implement))\b/i.test(
      message,
    );

  if (!isComplex) return null;

  const prompt = `Break this task into 3-5 clear, actionable steps. Be brief and specific.

Task: ${message.slice(0, 400)}

Output ONLY a numbered list:
1. First step
2. Second step
3. Third step`;

  try {
    const result = await streamToString(provider, [{ role: 'user', content: prompt }]);
    const steps = result
      .split('\n')
      .filter((line) => /^\d+[.)]\s/.test(line.trim()))
      .map((line) => line.replace(/^\d+[.)]\s*/, '').trim())
      .filter((s) => s.length > 5);
    return steps.length >= 2 ? steps : null;
  } catch {
    return null;
  }
}
