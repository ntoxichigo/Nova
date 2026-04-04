import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ZAI from 'z-ai-web-dev-sdk';

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

    // Update memory access count
    for (const mem of memories) {
      await db.agentMemory.update({
        where: { id: mem.id },
        data: { accessCount: { increment: 1 }, lastAccessed: new Date() },
      });
    }

    // Get recent conversation messages for context
    const recentMessages = await db.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    // Build system prompt
    let systemPrompt = `You are Nova, an intelligent AI assistant that learns and grows with your user. You have been taught various skills and knowledge that you should actively use when relevant.

## Your Personality
- You are helpful, curious, and eager to learn
- You proactively use your skills when relevant
- You acknowledge when you don't know something and suggest learning it
- You reference your skills and knowledge naturally
- Be concise but thorough in your responses
- Use markdown formatting for better readability

`;

    if (skills.length > 0) {
      systemPrompt += `## Your Active Skills:\n`;
      for (const skill of skills) {
        systemPrompt += `### ${skill.name} (${skill.category})\n${skill.description}\nInstructions: ${skill.instructions}\n\n`;
      }
    }

    if (relevantKnowledge.length > 0) {
      systemPrompt += `## Your Knowledge Base:\n`;
      for (const k of relevantKnowledge) {
        const tags: string[] = JSON.parse(k.tags);
        systemPrompt += `### ${k.topic} [${tags.join(', ')}]\n${k.content}\n\n`;
      }
    }

    if (memories.length > 0) {
      systemPrompt += `## Important Memories:\n`;
      for (const mem of memories) {
        systemPrompt += `- [${mem.type}, importance: ${mem.importance}/10] ${mem.content}\n`;
      }
    }

    systemPrompt += `\n## Current Conversation Context:\nThe user's latest message and recent conversation history will follow. Respond helpfully and use your skills and knowledge when appropriate.\n`;

    // Build messages array for the AI
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...recentMessages.map((m) => ({
        role: (m.role as 'user' | 'assistant'),
        content: m.content,
      })),
    ];

    // Call z-ai-web-dev-sdk
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: aiMessages,
    });

    const assistantMessage = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

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
