import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';

// GET /api/scheduled-tasks — list all tasks
export async function GET() {
  try {
    const tasks = await db.scheduledTask.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(tasks);
  } catch (e) {
    console.error('scheduled-tasks GET:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/scheduled-tasks — create a new scheduled task
export async function POST(request: NextRequest) {
  try {
    const { name, prompt, cronExpr, channel } = (await request.json()) as {
      name?: string; prompt?: string; cronExpr?: string; channel?: string;
    };
    if (!name?.trim() || !prompt?.trim() || !cronExpr?.trim()) {
      return NextResponse.json({ error: 'name, prompt, cronExpr required' }, { status: 400 });
    }
    // Basic cron validation: 5 parts
    if (cronExpr.trim().split(/\s+/).length !== 5) {
      return NextResponse.json({ error: 'cronExpr must have 5 parts (min hour dom mon dow)' }, { status: 400 });
    }
    const task = await db.scheduledTask.create({
      data: { name: name.trim(), prompt: prompt.trim(), cronExpr: cronExpr.trim(), channel: channel || 'log' },
    });

    await tryRecordAuditEvent({
      source: 'automation',
      action: 'create_task',
      entityType: 'scheduled_task',
      entityId: task.id,
      entityLabel: task.name,
      summary: `Created scheduled task "${task.name}"`,
      details: {
        cronExpr: task.cronExpr,
        channel: task.channel,
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    console.error('scheduled-tasks POST:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// PUT /api/scheduled-tasks — toggle enabled or update
export async function PUT(request: NextRequest) {
  try {
    const { id, enabled, name, prompt, cronExpr, channel } = (await request.json()) as {
      id: string; enabled?: boolean; name?: string; prompt?: string; cronExpr?: string; channel?: string;
    };
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (enabled !== undefined) data.enabled = enabled;
    if (name !== undefined) data.name = name;
    if (prompt !== undefined) data.prompt = prompt;
    if (cronExpr !== undefined) data.cronExpr = cronExpr;
    if (channel !== undefined) data.channel = channel;
    const task = await db.scheduledTask.update({ where: { id }, data });

    await tryRecordAuditEvent({
      source: 'automation',
      action: 'update_task',
      entityType: 'scheduled_task',
      entityId: task.id,
      entityLabel: task.name,
      summary: `Updated scheduled task "${task.name}"`,
      details: {
        keys: Object.keys(data),
      },
    });

    return NextResponse.json(task);
  } catch (e) {
    console.error('scheduled-tasks PUT:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// DELETE /api/scheduled-tasks?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const existing = await db.scheduledTask.findUnique({ where: { id } });
    await db.scheduledTask.delete({ where: { id } });

    await tryRecordAuditEvent({
      source: 'automation',
      action: 'delete_task',
      entityType: 'scheduled_task',
      entityId: id,
      entityLabel: existing?.name || id,
      summary: `Deleted scheduled task "${existing?.name || id}"`,
      details: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('scheduled-tasks DELETE:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/scheduled-tasks/run — manually run a task now  
// (imported by the scheduler and by UI "Run now" button)
