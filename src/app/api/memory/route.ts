import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEmbedding, encodeEmbedding } from '@/lib/embeddings';
import { tryRecordAuditEvent } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    
    const memories = await db.agentMemory.findMany({
      where: type ? { type } : undefined,
      orderBy: [{ importance: 'desc' }, { lastAccessed: 'desc' }],
    });
    
    return NextResponse.json(memories);
  } catch (error: unknown) {
    console.error('Error fetching memories:', error);
    return NextResponse.json({ error: 'Failed to fetch memories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, content, importance } = body;
    
    if (!type || !content) {
      return NextResponse.json({ error: 'Type and content are required' }, { status: 400 });
    }
    
    const validTypes = ['preference', 'fact', 'instruction', 'context'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `Type must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }
    
    const embeddingVec = await getEmbedding(content).catch(() => null);
    const memory = await db.agentMemory.create({
      data: {
        type,
        content,
        importance: importance || 5,
        embedding: embeddingVec ? encodeEmbedding(embeddingVec) : null,
      },
    });

    await tryRecordAuditEvent({
      source: 'memory',
      action: 'create',
      entityType: 'memory',
      entityId: memory.id,
      entityLabel: memory.type,
      summary: `Created ${memory.type} memory`,
      details: {
        importance: memory.importance,
      },
    });
    
    return NextResponse.json(memory, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating memory:', error);
    return NextResponse.json({ error: 'Failed to create memory' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const scope = searchParams.get('scope');

    if (scope === 'all') {
      const [memoryResult, relationResult] = await db.$transaction([
        db.agentMemory.deleteMany(),
        db.memoryRelation.deleteMany(),
      ]);

      await tryRecordAuditEvent({
        source: 'memory',
        action: 'reset',
        entityType: 'memory',
        entityId: 'all',
        entityLabel: 'All Memories',
        summary: 'Reset all memory entries and relations',
        details: {
          deletedMemories: memoryResult.count,
          deletedRelations: relationResult.count,
        },
      });

      return NextResponse.json({
        success: true,
        deletedMemories: memoryResult.count,
        deletedRelations: relationResult.count,
      });
    }
    
    if (!id) {
      return NextResponse.json({ error: 'Memory ID is required' }, { status: 400 });
    }
    
    const existing = await db.agentMemory.findUnique({ where: { id } });
    await db.agentMemory.delete({ where: { id } });

    await tryRecordAuditEvent({
      source: 'memory',
      action: 'delete',
      entityType: 'memory',
      entityId: id,
      entityLabel: existing?.type || id,
      summary: `Deleted ${existing?.type || 'memory'} entry`,
      details: {},
    });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting memory:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
