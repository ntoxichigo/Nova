import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const conversations = await db.conversation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });
    
    return NextResponse.json(conversations);
  } catch (error: unknown) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
    }
    
    await db.conversation.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
