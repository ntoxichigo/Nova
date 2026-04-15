import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/prompts — list all prompt templates
export async function GET() {
  try {
    const prompts = await db.promptTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
    return NextResponse.json(prompts);
  } catch (e) {
    console.error('prompts GET:', e);
    return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 });
  }
}

// POST /api/prompts — create new prompt template
export async function POST(request: NextRequest) {
  try {
    const { name, content, category, isDefault } = (await request.json()) as {
      name?: string;
      content?: string;
      category?: string;
      isDefault?: boolean;
    };
    if (!name?.trim() || !content?.trim()) {
      return NextResponse.json({ error: 'name and content required' }, { status: 400 });
    }

    // If setting as default, unset any existing default first
    if (isDefault) {
      await db.promptTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const prompt = await db.promptTemplate.create({
      data: { name: name.trim(), content: content.trim(), category: category?.trim() || 'general', isDefault: !!isDefault },
    });
    return NextResponse.json(prompt, { status: 201 });
  } catch (e) {
    console.error('prompts POST:', e);
    return NextResponse.json({ error: 'Failed to create prompt' }, { status: 500 });
  }
}

// PUT /api/prompts — update existing prompt template
export async function PUT(request: NextRequest) {
  try {
    const { id, name, content, category, isDefault } = (await request.json()) as {
      id: string;
      name?: string;
      content?: string;
      category?: string;
      isDefault?: boolean;
    };
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (isDefault) {
      await db.promptTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const prompt = await db.promptTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(content !== undefined && { content: content.trim() }),
        ...(category !== undefined && { category: category.trim() }),
        ...(isDefault !== undefined && { isDefault }),
      },
    });
    return NextResponse.json(prompt);
  } catch (e) {
    console.error('prompts PUT:', e);
    return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
  }
}

// DELETE /api/prompts?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await db.promptTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('prompts DELETE:', e);
    return NextResponse.json({ error: 'Failed to delete prompt' }, { status: 500 });
  }
}
