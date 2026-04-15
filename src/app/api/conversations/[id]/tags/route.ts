import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// PATCH /api/conversations/[id]/tags — update tags on a conversation
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { tags, pinned } = (await request.json()) as { tags?: string[]; pinned?: boolean };

    const data: Record<string, unknown> = {};
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (pinned !== undefined) data.pinned = pinned;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const conv = await db.conversation.update({ where: { id }, data });
    return NextResponse.json(conv);
  } catch (e) {
    console.error('tags PATCH:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
