import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/conversations/search?q=term
export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams.get('q')?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ error: 'query must be at least 2 chars' }, { status: 400 });
    }

    const qLower = q.toLowerCase();

    // Search messages containing the query, newest first.
    const messages = await db.message.findMany({
      where: {
        content: { contains: q },
      },
      select: {
        id: true,
        content: true,
        role: true,
        conversationId: true,
        createdAt: true,
        conversation: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    // Deduplicate by conversation and keep the first match (newest).
    const seen = new Set<string>();
    const results: Array<{
      conversationId: string;
      conversationTitle: string;
      snippet: string;
      role: string;
      messageId: string;
      createdAt: Date;
    }> = [];

    for (const msg of messages) {
      if (seen.has(msg.conversationId)) continue;
      seen.add(msg.conversationId);

      const idx = msg.content.toLowerCase().indexOf(qLower);
      const start = Math.max(0, idx - 60);
      const end = Math.min(msg.content.length, idx + q.length + 60);
      const snippet = `${start > 0 ? '...' : ''}${msg.content.slice(start, end)}${end < msg.content.length ? '...' : ''}`;

      results.push({
        conversationId: msg.conversationId,
        conversationTitle: msg.conversation.title,
        snippet,
        role: msg.role,
        messageId: msg.id,
        createdAt: msg.createdAt,
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('conversation search:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

