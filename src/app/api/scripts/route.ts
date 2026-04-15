import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';
import { detectLanguage } from '@/lib/script-executor';
import { ensureProjectWorkspace } from '@/lib/script-workspaces';

export const runtime = 'nodejs';

/** GET /api/scripts — list all projects (with latest execution + file count) */
export async function GET() {
  const projects = await db.scriptProject.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      files: { select: { id: true, path: true, language: true } },
      folders: { select: { id: true, path: true } },
      executions: { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true } },
    },
  });
  return Response.json(projects);
}

/** POST /api/scripts — create a new project */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = String(body.name || 'Untitled Project').slice(0, 120);
  const description = String(body.description || '').slice(0, 500);
  const requestedFiles = Array.isArray(body.files) ? body.files : [];
  const requestedFolders = Array.isArray(body.folders) ? body.folders : [];

  const files = requestedFiles.length > 0
    ? requestedFiles
        .map((file) => ({
          path: String(file.path || file.name || '').trim().replace(/\\/g, '/'),
          content: String(file.content ?? ''),
          language: String(file.language || detectLanguage(String(file.path || file.name || 'index.js'))),
        }))
        .filter((file) => file.path)
    : [{
        path: 'index.js',
        language: 'javascript',
        content: '// Welcome to your new project\nconsole.log("Hello from NOVA IDE!");\n',
      }];

  const folders = requestedFolders
    .map((folder) => String(folder.path || folder).trim().replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter(Boolean)
    .filter((folder, index, list) => list.indexOf(folder) === index);

  const project = await db.scriptProject.create({
    data: {
      name,
      description,
      files: {
        create: files,
      },
      folders: folders.length > 0 ? {
        create: folders.map((folderPath) => ({ path: folderPath })),
      } : undefined,
    },
    include: { files: true, folders: true },
  });

  await ensureProjectWorkspace({
    id: project.id,
    name: project.name,
    files: project.files.map((file) => ({ path: file.path, content: file.content })),
    folders: project.folders.map((folder) => ({ path: folder.path })),
  });

  await tryRecordAuditEvent({
    source: 'scripts',
    action: 'create_project',
    entityType: 'script_project',
    entityId: project.id,
    entityLabel: project.name,
    summary: `Created script project "${project.name}"`,
    details: {
      fileCount: project.files.length,
      folderCount: project.folders.length,
    },
  });

  return Response.json(project, { status: 201 });
}
