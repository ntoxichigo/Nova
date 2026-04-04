import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getLLMConfig, getAgentName, getAgentPersonality } from '@/lib/settings';
import { createLLMProvider } from '@/lib/llm';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

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

    // Get recent conversation messages for context
    const recentMessages = await db.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    // Build system prompt with overflow safety (cap at ~6000 chars)
    const BASE_PROMPT = `You are Nova, an intelligent AI assistant that learns and grows with your user. You have been taught various skills and knowledge that you should actively use when relevant.

## Your Personality
- You are helpful, curious, and eager to learn
- You proactively use your skills when relevant
- You acknowledge when you don't know something and suggest learning it
- You reference your skills and knowledge naturally
- Be concise but thorough in your responses
- Use markdown formatting for better readability

`;
    const CONTEXT_FOOTER = `\n## Current Conversation Context:\nThe user's latest message and recent conversation history will follow. Respond helpfully and use your skills and knowledge when appropriate.\n`;
    const MAX_SYSTEM_PROMPT_LENGTH = 6000;
    const availableSpace = MAX_SYSTEM_PROMPT_LENGTH - BASE_PROMPT.length - CONTEXT_FOOTER.length;

    let systemPrompt = BASE_PROMPT;

    // Build skills section
    let skillsSection = '';
    if (skills.length > 0) {
      skillsSection += `## Your Active Skills:\n`;
      for (const skill of skills) {
        skillsSection += `### ${skill.name} (${skill.category})\n${skill.description}\nInstructions: ${skill.instructions}\n\n`;
      }
    }

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

    // Truncate to fit within available space, prioritizing skills > memories > knowledge
    let combinedSections = skillsSection + memoriesSection + knowledgeSection;
    if (combinedSections.length > availableSpace) {
      combinedSections = combinedSections.slice(0, availableSpace);
      // Truncate at last newline to avoid cutting mid-sentence
      const lastNewline = combinedSections.lastIndexOf('\n');
      if (lastNewline > availableSpace * 0.7) {
        combinedSections = combinedSections.slice(0, lastNewline);
      }
      combinedSections += '\n[System prompt truncated to fit context window]\n';
    }

    systemPrompt += combinedSections + CONTEXT_FOOTER;

    // Build messages array for the AI
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...recentMessages.map((m) => ({
        role: (m.role as 'user' | 'assistant'),
        content: m.content,
      })),
    ];

    // Get LLM config and create provider
    const llmConfig = await getLLMConfig();
    const agentName = await getAgentName();
    const agentPersonality = await getAgentPersonality();

    // Inject agent name and personality into system prompt
    if (agentName !== 'Nova' || agentPersonality) {
      aiMessages[0].content = aiMessages[0].content.replace('You are Nova', `You are ${agentName}`);
      if (agentPersonality) {
        aiMessages[0].content += `\n\n## Custom Personality:\n${agentPersonality}\n`;
      }
    }

    // Call configured LLM provider
    let assistantMessage: string;
    try {
      const provider = createLLMProvider(llmConfig);
      const response = await provider.chat(aiMessages);
      assistantMessage = response.content || 'Sorry, I could not generate a response.';
    } catch (llmError: unknown) {
      console.error('LLM call failed:', llmError);
      const errorMsg = llmError instanceof Error ? llmError.message : 'Unknown error';
      assistantMessage = `I'm having trouble connecting to my brain right now. Please check the LLM settings and try again.\n\n*(Error: ${errorMsg})*`;
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

    // Determine which skills were used
    const skillsUsed: string[] = [];
    const usedSkillIds: string[] = [];
    for (const skill of skills) {
      const skillWords = [
        skill.name.toLowerCase(),
        skill.category.toLowerCase(),
        ...skill.description.toLowerCase().split(/\s+/),
      ].filter((w) => w.length > 3);
      const matchCount = skillWords.filter((w) => message.toLowerCase().includes(w)).length;
      if (matchCount >= 1) {
        skillsUsed.push(skill.name);
        usedSkillIds.push(skill.id);
      }
    }

    // Save assistant message
    await db.message.create({
      data: {
        conversationId: convId,
        role: 'assistant',
        content: assistantMessage,
        skillsUsed: JSON.stringify(usedSkillIds),
      },
    });

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
