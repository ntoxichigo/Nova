import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/export/finetune — export all conversations with feedback as JSONL
// Format: OpenAI fine-tuning format {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const feedbackOnly = searchParams.get('feedbackOnly') === 'true';
    const positiveOnly = searchParams.get('positiveOnly') === 'true';

    const conversations = await db.conversation.findMany({
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get a default system prompt if one exists
    const defaultPrompt = await db.promptTemplate.findFirst({ where: { isDefault: true } });
    const systemContent = defaultPrompt?.content || 'You are Nova, a helpful AI assistant.';

    const lines: string[] = [];

    for (const conv of conversations) {
      const msgs = conv.messages;
      if (msgs.length < 2) continue; // Need at least 1 user + 1 assistant message

      // If feedbackOnly, only include conversations that have feedback
      if (feedbackOnly) {
        const hasFeedback = msgs.some((m) => m.feedback !== null);
        if (!hasFeedback) continue;
      }

      // Build message pairs: for each user → assistant exchange
      for (let i = 0; i < msgs.length - 1; i++) {
        const userMsg = msgs[i];
        const assistantMsg = msgs[i + 1];
        if (userMsg.role !== 'user' || assistantMsg.role !== 'assistant') continue;

        // Skip if filtering by positive feedback only
        if (positiveOnly && assistantMsg.feedback !== 1) continue;
        if (feedbackOnly && assistantMsg.feedback === null) continue;

        // For negative feedback, skip the pair (don't train on bad examples)
        if (assistantMsg.feedback === -1) continue;

        const entry = {
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userMsg.content },
            { role: 'assistant', content: assistantMsg.content },
          ],
        };
        lines.push(JSON.stringify(entry));
      }
    }

    const body = lines.join('\n');
    return new Response(body, {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="nova-finetune-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      },
    });
  } catch (e) {
    console.error('finetune export:', e);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
