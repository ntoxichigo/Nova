import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;
    
    if (!id) {
      return NextResponse.json({ error: 'Skill ID is required' }, { status: 400 });
    }
    
    const skill = await db.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }
    
    const updated = await db.skill.update({
      where: { id },
      data: { isActive: !skill.isActive },
    });

    await tryRecordAuditEvent({
      source: 'skills',
      action: 'toggle',
      entityType: 'skill',
      entityId: updated.id,
      entityLabel: updated.name,
      summary: `${updated.isActive ? 'Activated' : 'Deactivated'} skill "${updated.name}"`,
      details: {
        isActive: updated.isActive,
      },
    });
    
    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error('Error toggling skill:', error);
    return NextResponse.json({ error: 'Failed to toggle skill' }, { status: 500 });
  }
}
