import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data } = body;
    
    if (!type || !data) {
      return NextResponse.json({ error: 'Type and data are required' }, { status: 400 });
    }
    
    let result;
    
    switch (type) {
      case 'skill': {
        if (!data.name || !data.description || !data.instructions) {
          return NextResponse.json({ error: 'Skill requires name, description, and instructions' }, { status: 400 });
        }
        result = await db.skill.create({
          data: {
            name: data.name,
            description: data.description,
            instructions: data.instructions,
            category: data.category || 'general',
            icon: data.icon || 'Zap',
          },
        });
        break;
      }
      
      case 'knowledge': {
        if (!data.topic || !data.content) {
          return NextResponse.json({ error: 'Knowledge requires topic and content' }, { status: 400 });
        }
        result = await db.knowledge.create({
          data: {
            topic: data.topic,
            content: data.content,
            tags: data.tags ? JSON.stringify(data.tags) : '[]',
            source: 'user_teach',
          },
        });
        break;
      }
      
      case 'memory': {
        if (!data.type || !data.content) {
          return NextResponse.json({ error: 'Memory requires type and content' }, { status: 400 });
        }
        const validTypes = ['preference', 'fact', 'instruction', 'context'];
        if (!validTypes.includes(data.type)) {
          return NextResponse.json({ error: `Memory type must be one of: ${validTypes.join(', ')}` }, { status: 400 });
        }
        result = await db.agentMemory.create({
          data: {
            type: data.type,
            content: data.content,
            importance: data.importance || 5,
          },
        });
        break;
      }
      
      default:
        return NextResponse.json({ error: `Unknown teach type: ${type}` }, { status: 400 });
    }

    await tryRecordAuditEvent({
      source: 'teach',
      action: `create_${type}`,
      entityType: type,
      entityId: result.id,
      entityLabel:
        (typeof result === 'object' && result && 'name' in result && typeof result.name === 'string' && result.name) ||
        (typeof result === 'object' && result && 'topic' in result && typeof result.topic === 'string' && result.topic) ||
        type,
      summary: `Taught Nova new ${type}`,
      details: {
        type,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error('Error teaching agent:', error);
    return NextResponse.json({ error: 'Failed to teach agent' }, { status: 500 });
  }
}
