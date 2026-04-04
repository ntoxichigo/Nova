import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
    
    const memory = await db.agentMemory.create({
      data: {
        type,
        content,
        importance: importance || 5,
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
    
    if (!id) {
      return NextResponse.json({ error: 'Memory ID is required' }, { status: 400 });
    }
    
    await db.agentMemory.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting memory:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
