import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ensureScriptProjectExists, findScriptFolderInProject } from '@/lib/script-projects';
import { tryRecordAuditEvent } from '@/lib/audit';
import { deleteWorkspaceFolder, ensureWorkspaceFolder } from '@/lib/script-workspaces';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

async function touchProject(projectId: string) {
  await db.scriptProject.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  }).catch(() => {});
}

function normalizeFolderPath(folderPath: string): string {
  const normalized = String(folderPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();

  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error('Invalid folder path');
  }

  return normalized;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await ensureScriptProjectExists(id);
  const folders = await db.scriptFolder.findMany({
    where: { projectId: id },
    orderBy: { path: 'asc' },
  });
  return Response.json(folders);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const project = await db.scriptProject.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  const body = await request.json();
  let folderPath = '';
  try {
    folderPath = normalizeFolderPath(body.path || body.folderPath || '');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid folder path' }, { status: 400 });
  }

  const folder = await db.scriptFolder.upsert({
    where: {
      projectId_path: {
        projectId: id,
        path: folderPath,
      },
    },
    update: {},
    create: {
      projectId: id,
      path: folderPath,
    },
  });

  await ensureWorkspaceFolder(id, project.name, folderPath);
  await touchProject(id);

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'create_folder',
    entityType: 'script_folder',
    entityId: folder.id,
    entityLabel: folder.path,
    summary: `Created folder "${folder.path}"`,
    details: { projectId: id },
  });

  return Response.json(folder, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await ensureScriptProjectExists(id);

  const body = await request.json();
  const folderId = String(body.folderId || '');
  if (!folderId) {
    return Response.json({ error: 'folderId required' }, { status: 400 });
  }

  const folder = await findScriptFolderInProject(id, folderId);
  if (!folder) {
    return Response.json({ error: 'Folder not found in this project' }, { status: 404 });
  }

  const nestedFile = await db.scriptFile.findFirst({
    where: {
      projectId: id,
      path: {
        startsWith: `${folder.path}/`,
      },
    },
    select: { id: true },
  });

  const nestedFolder = await db.scriptFolder.findFirst({
    where: {
      projectId: id,
      id: { not: folderId },
      path: {
        startsWith: `${folder.path}/`,
      },
    },
    select: { id: true },
  });

  if (nestedFile || nestedFolder) {
    return Response.json({ error: 'Folder is not empty. Remove nested files and folders first.' }, { status: 409 });
  }

  const project = await db.scriptProject.findUnique({ where: { id }, select: { name: true } });
  await db.scriptFolder.delete({ where: { id: folderId } });
  if (project) {
    await deleteWorkspaceFolder(id, project.name, folder.path);
  }
  await touchProject(id);

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'delete_folder',
    entityType: 'script_folder',
    entityId: folder.id,
    entityLabel: folder.path,
    summary: `Deleted folder "${folder.path}"`,
    details: { projectId: id },
  });

  return Response.json({ ok: true });
}
