import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getLLMConfig, getAgentName, getAgentPersonality } from '@/lib/settings';
import { classifyLLMError, createLLMProvider } from '@/lib/llm';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import { buildRuntimeProfile, estimateTokens } from '@/lib/chat/stream-utils';
import { buildSkillContext, selectRelevantSkill } from '@/lib/skills/router';
import { getAutonomyProfile, getOrchestrationSettings } from '@/lib/orchestration/config';
import { buildContextPack, classifyTaskMode } from '@/lib/orchestration/context-engine';
import { routeStageModel } from '@/lib/orchestration/model-router';
import { recordOrchestrationTrace } from '@/lib/orchestration/telemetry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Fetch agent identity early so BASE_PROMPT can use it
    const [agentName, agentPersonality, orchestrationSettings] = await Promise.all([
      getAgentName(),
      getAgentPersonality(),
      getOrchestrationSettings(),
    ]);
    const taskMode = classifyTaskMode(message);
    const autonomyProfile = getAutonomyProfile(orchestrationSettings.autonomyProfile);

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const conversation = await db.conversation.create({
        data: {
          title: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
        },
      });
      convId = conversation.id;
    } else {
      const existing = await db.conversation.findUnique({ where: { id: convId } });
      if (!existing) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
    }

    // Save user message
    await db.message.create({
      data: {
        conversationId: convId,
        role: 'user',
        content: message,
      },
    });

    // Retrieve ALL active skills
    const skills = await db.skill.findMany({
      where: { isActive: true },
    });

    // Retrieve relevant knowledge (keyword matching)
    const allKnowledge = await db.knowledge.findMany();
    const messageWords = message.toLowerCase().split(/\s+/);
    const relevantKnowledge = allKnowledge.filter((k) => {
      const topicLower = k.topic.toLowerCase();
      const contentLower = k.content.toLowerCase();
      const tags: string[] = JSON.parse(k.tags);
      return (
        messageWords.some((w) => w.length > 2 && (topicLower.includes(w) || contentLower.includes(w))) ||
        tags.some((t) => messageWords.some((w) => w.length > 2 && t.toLowerCase().includes(w)))
      );
    });

    // Retrieve recent memories
    const memories = await db.agentMemory.findMany({
      orderBy: [{ importance: 'desc' }, { lastAccessed: 'desc' }],
      take: 10,
    });

    // Update memory access count in a single batch
    if (memories.length > 0) {
      const memoryIds = memories.map((m) => m.id);
      await db.agentMemory.updateMany({
        where: { id: { in: memoryIds } },
        data: { accessCount: { increment: 1 }, lastAccessed: new Date() },
      });
    }

    // Get recent conversation messages for context — sliding window to prevent context overflow
    // Use 20 as a safe conservative limit; streaming route applies tighter per-provider limits
    const recentMessages = await db.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const recentRoutingContext = recentMessages
      .filter((m) => m.role === 'user')
      .slice(-4)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
    const selectedSkill = selectRelevantSkill(skills, message, recentRoutingContext);
    const selectedSkillContext = buildSkillContext(selectedSkill);

    // Build system prompt with overflow safety (cap at ~6000 chars)
    const BASE_PROMPT = `You are ${agentName}, a powerful personal AI agent that learns and grows with your user. You may receive one relevant skill for the current turn.

## Your Core Traits
- You are helpful, direct, and highly capable
- You proactively use your skills and tools when relevant
- You acknowledge when you don't know something and suggest learning it
- You reference your skills and knowledge naturally in responses
- Be concise but thorough — prefer lists and code blocks over walls of text
- Use markdown formatting for better readability
${agentPersonality ? `
## Custom Personality:\n${agentPersonality}\n` : ''}
`;
    const CONTEXT_FOOTER = `\n## Current Conversation Context:\nThe user's latest message and recent conversation history will follow. Respond helpfully and use your skills and knowledge when appropriate.\n`;

    let systemPrompt = BASE_PROMPT;

    // Build a single routed skill section only
    const skillsSection = selectedSkillContext ? `${selectedSkillContext}\n` : '';

    // Build knowledge section
    let knowledgeSection = '';
    if (relevantKnowledge.length > 0) {
      knowledgeSection += `## Your Knowledge Base:\n`;
      for (const k of relevantKnowledge) {
        const tags: string[] = JSON.parse(k.tags);
        knowledgeSection += `### ${k.topic} [${tags.join(', ')}]\n${k.content}\n\n`;
      }
    }

    // Build memories section (sorted by importance desc — most important first)
    let memoriesSection = '';
    if (memories.length > 0) {
      memoriesSection += `## Important Memories:\n`;
      for (const mem of memories) {
        memoriesSection += `- [${mem.type}, importance: ${mem.importance}/10] ${mem.content}\n`;
      }
    }

    const initialProfiled = applyModelStabilityProfile(await getLLMConfig()).config;
    const { config: routedMainConfig, route: mainRoute } = routeStageModel(
      initialProfiled,
      orchestrationSettings,
      'main',
      taskMode,
    );
    const { config: profiledLLMConfig, profile: modelProfile } = applyModelStabilityProfile(routedMainConfig);
    const routedProvider = createLLMProvider(profiledLLMConfig);
    const runtimeProfile = buildRuntimeProfile(profiledLLMConfig, routedProvider, false);

    const contextPack = buildContextPack({
      objective: message,
      taskMode,
      runtimeProfile,
      sections: [
        { label: 'Active Skill', content: skillsSection, priority: 1, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'Memories', content: memoriesSection, priority: 2, maxChars: runtimeProfile.summaryCharLimit },
        { label: 'Knowledge Base', content: knowledgeSection, priority: 3, maxChars: runtimeProfile.summaryCharLimit },
      ],
    });

    systemPrompt += `Current task mode: ${taskMode}\nAutonomy profile: ${autonomyProfile.label}\n\n${contextPack.combined}` + CONTEXT_FOOTER;

    // Build messages array for the AI
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...recentMessages.map((m) => ({
        role: (m.role as 'user' | 'assistant'),
        content: m.content,
      })),
    ];

    // Call configured LLM provider
    let assistantMessage: string;
    try {
      const response = await routedProvider.chat(aiMessages);
      assistantMessage = response.content || 'Sorry, I could not generate a response.';
      if (!assistantMessage.trim()) {
        const meta = routedProvider.getLastGenerationMeta?.();
        assistantMessage = meta?.reasoningOnly
          ? `Model returned reasoning but no visible answer. The selected ${modelProfile.label.toLowerCase()} is not reliable with Nova's current chat format. Switch to a stable model such as \`gemma-4-e4b-it\` and retry.`
          : 'Model returned an empty response. Switch to a stable model in Settings (for example `gemma-4-e4b-it`) and retry.';
      }
    } catch (llmError: unknown) {
      console.error('LLM call failed:', llmError);
      const classified = classifyLLMError(llmError);
      const providerHint = classified.statusCode === 402
        ? '\n\nProvider billing blocked generation (402 insufficient balance). Note: model listing checks can still pass while real chat fails.'
        : '';
      assistantMessage = `I'm having trouble connecting to my brain right now. Please check the LLM settings and try again.\n\n*(Error: ${classified.message})*${providerHint}`;
    }

    // Check for learning suggestions
    const learningSuggestions: string[] = [];
    const learningPatterns = [
      /I (don't|do not) (know|have information|understand) (about|how to|what is|what are)\s+(.+)/gi,
      /I('m| am) (not |un)aware of\s+(.+)/gi,
      /I (haven't|have not) been (taught|trained|informed) (about|on)\s+(.+)/gi,
    ];

    for (const pattern of learningPatterns) {
      const matches = assistantMessage.matchAll(pattern);
      for (const match of matches) {
        learningSuggestions.push(match[0]);
      }
    }

    // Determine which single skill was used
    const skillsUsed: string[] = selectedSkill ? [selectedSkill.name] : [];
    const usedSkillIds: string[] = selectedSkill ? [selectedSkill.id] : [];

    // Save assistant message
    await db.message.create({
      data: {
        conversationId: convId,
        role: 'assistant',
        content: assistantMessage,
        skillsUsed: JSON.stringify(usedSkillIds),
      },
    });

    await recordOrchestrationTrace({
      source: 'chat',
      entityId: convId,
      entityLabel: profiledLLMConfig.model || routedProvider.name || '',
      conversationId: convId,
      taskMode,
      autonomyProfile: autonomyProfile.id,
      provider: profiledLLMConfig.provider,
      model: profiledLLMConfig.model || routedProvider.name || '',
      promptTokens: aiMessages.reduce((sum, entry) => sum + estimateTokens(entry.content), 0),
      outputTokens: estimateTokens(assistantMessage),
      contextTokens: contextPack.estimatedTokens,
      toolsUsed: [],
      routes: [mainRoute],
      stages: [
        {
          stage: 'main',
          model: profiledLLMConfig.model || routedProvider.name || '',
          promptTokens: aiMessages.reduce((sum, entry) => sum + estimateTokens(entry.content), 0),
          outputTokens: estimateTokens(assistantMessage),
        },
      ],
    }).catch(() => {});

    return NextResponse.json({
      message: assistantMessage,
      conversationId: convId,
      skillsUsed,
      learningSuggestions: [...new Set(learningSuggestions)],
    });
  } catch (error: unknown) {
    console.error('Chat error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
