import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    
    const knowledge = await db.knowledge.findMany({
      orderBy: { createdAt: 'desc' },
    });
    
    let result = knowledge;
    if (search) {
      const searchLower = search.toLowerCase();
      result = knowledge.filter(
        (k) =>
          k.topic.toLowerCase().includes(searchLower) ||
          k.content.toLowerCase().includes(searchLower) ||
          k.tags.toLowerCase().includes(searchLower)
      );
    }
    
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('Error fetching knowledge:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, content, tags } = body;
    
    if (!topic || !content) {
      return NextResponse.json({ error: 'Topic and content are required' }, { status: 400 });
    }
    
    const knowledge = await db.knowledge.create({
      data: {
        topic,
        content,
        tags: tags ? JSON.stringify(tags) : '[]',
        source: 'user_teach',
      },
    });
    
    return NextResponse.json(knowledge, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating knowledge:', error);
    return NextResponse.json({ error: 'Failed to create knowledge' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Knowledge ID is required' }, { status: 400 });
    }
    
    await db.knowledge.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting knowledge:', error);
    return NextResponse.json({ error: 'Failed to delete knowledge' }, { status: 500 });
  }
}
