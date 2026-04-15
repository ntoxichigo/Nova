import { db } from '@/lib/db';

export async function ensureScriptProjectExists(projectId: string) {
  const project = await db.scriptProject.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  return project;
}

export async function findScriptFileInProject(projectId: string, fileId: string) {
  return db.scriptFile.findFirst({
    where: {
      id: fileId,
      projectId,
    },
  });
}

export async function findScriptFolderInProject(projectId: string, folderId: string) {
  return db.scriptFolder.findFirst({
    where: {
      id: folderId,
      projectId,
    },
  });
}
