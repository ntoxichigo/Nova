import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';
import { deleteProjectWorkspace } from '@/lib/script-workspaces';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

/** GET /api/scripts/[id] — single project with all files + recent executions */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const project = await db.scriptProject.findUnique({
    where: { id },
    include: {
      files: { orderBy: { path: 'asc' } },
      folders: { orderBy: { path: 'asc' } },
      executions: { take: 20, orderBy: { createdAt: 'desc' } },
      commands: { take: 20, orderBy: { createdAt: 'desc' } },
      messages: { take: 40, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!project) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(project);
}

/** PUT /api/scripts/[id] — update project name / description */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const data: Record<string, string> = {};
  if (body.name !== undefined) data.name = String(body.name).slice(0, 120);
  if (body.description !== undefined) data.description = String(body.description).slice(0, 500);
  const project = await db.scriptProject.update({ where: { id }, data });

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'update_project',
    entityType: 'script_project',
    entityId: project.id,
    entityLabel: project.name,
    summary: `Updated script project "${project.name}"`,
    details: {
      keys: Object.keys(data),
    },
  });

  return Response.json(project);
}

/** DELETE /api/scripts/[id] — delete project and all files / executions (cascade) */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const existing = await db.scriptProject.findUnique({ where: { id } });
  await db.scriptProject.delete({ where: { id } });
  await deleteProjectWorkspace(id, existing?.name);

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'delete_project',
    entityType: 'script_project',
    entityId: id,
    entityLabel: existing?.name || 'Deleted Project',
    summary: `Deleted script project "${existing?.name || id}"`,
    details: {},
  });

  return Response.json({ ok: true });
}
