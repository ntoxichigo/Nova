import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { feedback } = body;

    if (feedback !== 1 && feedback !== -1 && feedback !== 0) {
      return new Response(JSON.stringify({ error: 'feedback must be 1 (up), -1 (down), or 0 (clear)' }), { status: 400 });
    }

    const message = await db.message.findUnique({ where: { id } });
    if (!message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404 });
    }

    await db.message.update({
      where: { id },
      data: { feedback: feedback === 0 ? null : feedback },
    });

    // Negative feedback: store as a memory so future responses can improve
    if (feedback === -1) {
      const excerpt = message.content.slice(0, 200);
      await db.agentMemory.create({
        data: {
          type: 'feedback_negative',
          content: `User marked this response as unhelpful: "${excerpt}"`,
          importance: 7,
        },
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error('[feedback]', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
}
