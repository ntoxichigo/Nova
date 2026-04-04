import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active');
    
    const skills = await db.skill.findMany({
      where: activeOnly === 'true' ? { isActive: true } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    
    return NextResponse.json(skills);
  } catch (error: unknown) {
    console.error('Error fetching skills:', error);
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, instructions, category, icon } = body;
    
    if (!name || !description || !instructions) {
      return NextResponse.json({ error: 'Name, description, and instructions are required' }, { status: 400 });
    }
    
    const skill = await db.skill.create({
      data: {
        name,
        description,
        instructions,
        category: category || 'general',
        icon: icon || 'Zap',
      },
    });
    
    return NextResponse.json(skill, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating skill:', error);
    return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...fields } = body;
    
    if (!id) {
      return NextResponse.json({ error: 'Skill ID is required' }, { status: 400 });
    }
    
    const skill = await db.skill.update({
      where: { id },
      data: fields,
    });
    
    return NextResponse.json(skill);
  } catch (error: unknown) {
    console.error('Error updating skill:', error);
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Skill ID is required' }, { status: 400 });
    }
    
    await db.skill.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting skill:', error);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
