import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEmbedding, encodeEmbedding } from '@/lib/embeddings';
import { tryRecordAuditEvent } from '@/lib/audit';

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
    
    // Generate embedding asynchronously (non-blocking if Ollama unavailable)
    const embeddingVec = await getEmbedding(`${topic}\n${content}`);
    
    const knowledge = await db.knowledge.create({
      data: {
        topic,
        content,
        tags: tags ? JSON.stringify(tags) : '[]',
        source: 'user_teach',
        embedding: embeddingVec ? encodeEmbedding(embeddingVec) : null,
      },
    });

    await tryRecordAuditEvent({
      source: 'knowledge',
      action: 'create',
      entityType: 'knowledge',
      entityId: knowledge.id,
      entityLabel: knowledge.topic,
      summary: `Created knowledge entry "${knowledge.topic}"`,
      details: {
        tagCount: tags ? tags.length : 0,
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
    
    const existing = await db.knowledge.findUnique({ where: { id } });
    await db.knowledge.delete({ where: { id } });

    await tryRecordAuditEvent({
      source: 'knowledge',
      action: 'delete',
      entityType: 'knowledge',
      entityId: id,
      entityLabel: existing?.topic || id,
      summary: `Deleted knowledge entry "${existing?.topic || id}"`,
      details: {},
    });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting knowledge:', error);
    return NextResponse.json({ error: 'Failed to delete knowledge' }, { status: 500 });
  }
}
