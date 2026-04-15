import { NextRequest } from 'next/server';
import { detectLanguage } from '@/lib/script-executor';
import { db } from '@/lib/db';
import { ensureScriptProjectExists, findScriptFileInProject } from '@/lib/script-projects';
import { tryRecordAuditEvent } from '@/lib/audit';
import { deleteWorkspaceFile, writeWorkspaceFile } from '@/lib/script-workspaces';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

async function touchProject(projectId: string) {
  await db.scriptProject.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  });
}

async function ensureFolderChain(projectId: string, filePath: string) {
  const segments = String(filePath).replace(/\\/g, '/').split('/');
  segments.pop();
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!current) continue;
    await db.scriptFolder.upsert({
      where: {
        projectId_path: {
          projectId,
          path: current,
        },
      },
      update: {},
      create: {
        projectId,
        path: current,
      },
    }).catch(() => {});
  }
}

/** GET /api/scripts/[id]/files - list files for a project */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await ensureScriptProjectExists(id);

  const files = await db.scriptFile.findMany({
    where: { projectId: id },
    orderBy: { path: 'asc' },
  });
  return Response.json(files);
}

/** POST /api/scripts/[id]/files - create a new file in the project */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await ensureScriptProjectExists(id);

  const body = await request.json();
  const path = String(body.path || 'untitled.js').slice(0, 260);
  const content = String(body.content ?? '');
  const language = body.language || detectLanguage(path);

  const existing = await db.scriptFile.findFirst({
    where: { projectId: id, path },
    select: { id: true },
  });
  if (existing) {
    return Response.json({ error: 'A file with that path already exists in this project' }, { status: 409 });
  }

  const file = await db.scriptFile.create({
    data: { projectId: id, path, content, language },
  });
  const project = await db.scriptProject.findUnique({ where: { id }, select: { name: true } });
  if (project) {
    await ensureFolderChain(id, path);
    await writeWorkspaceFile(id, project.name, path, content);
  }

  await touchProject(id);

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'create_file',
    entityType: 'script_file',
    entityId: file.id,
    entityLabel: file.path,
    summary: `Created file "${file.path}"`,
    details: {
      projectId: id,
      language: file.language,
    },
  });

  return Response.json(file, { status: 201 });
}

/** PUT /api/scripts/[id]/files - update an existing file (body.fileId + content/path) */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await ensureScriptProjectExists(id);

  const body = await request.json();
  const fileId = String(body.fileId || '');
  if (!fileId) return Response.json({ error: 'fileId required' }, { status: 400 });

  const existingFile = await findScriptFileInProject(id, fileId);
  if (!existingFile) {
    return Response.json({ error: 'File not found in this project' }, { status: 404 });
  }

  const data: Record<string, string> = {};
  if (body.content !== undefined) data.content = String(body.content);
  if (body.path !== undefined) {
    data.path = String(body.path).slice(0, 260);
    data.language = detectLanguage(data.path);
  }
  if (body.language !== undefined) data.language = String(body.language);

  if (data.path && data.path !== existingFile.path) {
    const duplicate = await db.scriptFile.findFirst({
      where: {
        projectId: id,
        path: data.path,
        id: { not: fileId },
      },
      select: { id: true },
    });
    if (duplicate) {
      return Response.json({ error: 'A file with that path already exists in this project' }, { status: 409 });
    }
  }

  const file = await db.scriptFile.update({ where: { id: fileId }, data });
  const project = await db.scriptProject.findUnique({ where: { id }, select: { name: true } });
  if (project) {
    if (data.path && data.path !== existingFile.path) {
      await deleteWorkspaceFile(id, project.name, existingFile.path);
      await ensureFolderChain(id, data.path);
      await writeWorkspaceFile(id, project.name, data.path, data.content ?? existingFile.content);
    } else {
      await writeWorkspaceFile(id, project.name, existingFile.path, data.content ?? existingFile.content);
    }
  }

  await touchProject(id);

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'update_file',
    entityType: 'script_file',
    entityId: file.id,
    entityLabel: file.path,
    summary: `Updated file "${file.path}"`,
    details: {
      projectId: id,
      keys: Object.keys(data),
    },
  });

  return Response.json(file);
}

/** DELETE /api/scripts/[id]/files - delete a file (body.fileId) */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await ensureScriptProjectExists(id);

  const body = await request.json();
  const fileId = String(body.fileId || '');
  if (!fileId) return Response.json({ error: 'fileId required' }, { status: 400 });

  const existingFile = await findScriptFileInProject(id, fileId);
  if (!existingFile) {
    return Response.json({ error: 'File not found in this project' }, { status: 404 });
  }

  await db.scriptFile.delete({ where: { id: fileId } });
  const project = await db.scriptProject.findUnique({ where: { id }, select: { name: true } });
  if (project) {
    await deleteWorkspaceFile(id, project.name, existingFile.path);
  }
  await touchProject(id);

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'delete_file',
    entityType: 'script_file',
    entityId: existingFile.id,
    entityLabel: existingFile.path,
    summary: `Deleted file "${existingFile.path}"`,
    details: {
      projectId: id,
    },
  });

  return Response.json({ ok: true });
}
