import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { db } from '@/lib/db';
import { detectLanguage } from '@/lib/script-executor';

function resolveWorkspaceRoot(): string {
  const explicit = (process.env.NOVA_WORKSPACE_ROOT || process.env.NTOX_WORKSPACE_ROOT || '').trim();
  if (explicit) return explicit;

  const novaDefault = path.join(os.homedir(), '.nova-workspaces');
  const legacyDefault = path.join(os.homedir(), '.ntox-workspaces');

  // Prefer the legacy folder if it already exists to avoid "losing" projects during rename.
  if (!existsSync(novaDefault) && existsSync(legacyDefault)) return legacyDefault;
  return novaDefault;
}

const WORKSPACE_ROOT = resolveWorkspaceRoot();
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.turbo',
  '.cache',
]);
const MAX_SYNC_FILE_BYTES = 512 * 1024;

export interface ScriptWorkspaceProjectShape {
  id: string;
  name: string;
  files: Array<{ path: string; content: string }>;
  folders?: Array<{ path: string }>;
}

export function normalizeProjectPath(projectPath: string): string {
  const normalized = String(projectPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();

  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe project path: ${projectPath}`);
  }

  return normalized;
}

function isIgnoredPath(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  return segments.some((segment) => IGNORED_DIRS.has(segment));
}

function isTextBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8');
  const replacementCount = (sample.match(/\uFFFD/g) || []).length;
  return replacementCount < 4;
}

export function getScriptWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

export function resolveProjectWorkspaceDir(projectId: string, _projectName?: string): string {
  return path.join(WORKSPACE_ROOT, projectId);
}

export async function ensureProjectWorkspace(project: ScriptWorkspaceProjectShape): Promise<string> {
  const workspaceDir = resolveProjectWorkspaceDir(project.id, project.name);
  await mkdir(workspaceDir, { recursive: true });

  for (const folder of project.folders ?? []) {
    const normalizedFolder = normalizeProjectPath(folder.path);
    await mkdir(path.join(workspaceDir, normalizedFolder), { recursive: true });
  }

  for (const file of project.files) {
    const normalizedPath = normalizeProjectPath(file.path);
    const absolutePath = path.join(workspaceDir, normalizedPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content ?? '', 'utf8');
  }

  return workspaceDir;
}

export async function ensureWorkspaceFolder(projectId: string, projectName: string, folderPath: string): Promise<string> {
  const workspaceDir = resolveProjectWorkspaceDir(projectId, projectName);
  const normalizedFolder = normalizeProjectPath(folderPath);
  await mkdir(path.join(workspaceDir, normalizedFolder), { recursive: true });
  return workspaceDir;
}

export async function writeWorkspaceFile(projectId: string, projectName: string, filePath: string, content: string): Promise<string> {
  const workspaceDir = resolveProjectWorkspaceDir(projectId, projectName);
  const normalizedPath = normalizeProjectPath(filePath);
  const absolutePath = path.join(workspaceDir, normalizedPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content ?? '', 'utf8');
  return workspaceDir;
}

export async function deleteWorkspaceFile(projectId: string, projectName: string, filePath: string): Promise<void> {
  const workspaceDir = resolveProjectWorkspaceDir(projectId, projectName);
  const normalizedPath = normalizeProjectPath(filePath);
  const absolutePath = path.join(workspaceDir, normalizedPath);
  await unlink(absolutePath).catch(() => {});
}

export async function deleteWorkspaceFolder(projectId: string, projectName: string, folderPath: string): Promise<void> {
  const workspaceDir = resolveProjectWorkspaceDir(projectId, projectName);
  const normalizedPath = normalizeProjectPath(folderPath);
  const absolutePath = path.join(workspaceDir, normalizedPath);
  await rm(absolutePath, { recursive: true, force: true }).catch(() => {});
}

export async function deleteProjectWorkspace(projectId: string, projectName?: string): Promise<void> {
  const workspaceDir = resolveProjectWorkspaceDir(projectId, projectName);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
}

async function scanWorkspaceEntries(baseDir: string, relativeDir = ''): Promise<{ folders: string[]; files: Array<{ path: string; content: string }> }> {
  const absoluteDir = relativeDir ? path.join(baseDir, relativeDir) : baseDir;
  const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
  const folders: string[] = [];
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of entries) {
    const relativePath = [relativeDir, entry.name].filter(Boolean).join('/');
    if (isIgnoredPath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(baseDir, relativePath);
    if (entry.isDirectory()) {
      folders.push(relativePath);
      const nested = await scanWorkspaceEntries(baseDir, relativePath);
      folders.push(...nested.folders);
      files.push(...nested.files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat || fileStat.size > MAX_SYNC_FILE_BYTES) {
      continue;
    }

    const buffer = await readFile(absolutePath).catch(() => null);
    if (!buffer || !isTextBuffer(buffer)) {
      continue;
    }

    files.push({ path: relativePath, content: buffer.toString('utf8') });
  }

  return { folders: [...new Set(folders)], files };
}

export async function syncWorkspaceBackToProject(projectId: string, projectName?: string): Promise<void> {
  const project = await db.scriptProject.findUnique({
    where: { id: projectId },
    include: {
      files: { select: { id: true, path: true } },
      folders: { select: { id: true, path: true } },
    },
  });

  if (!project) {
    return;
  }

  const workspaceDir = resolveProjectWorkspaceDir(projectId, projectName || project.name);
  const scan = await scanWorkspaceEntries(workspaceDir);
  const scannedFilePaths = new Set(scan.files.map((file) => file.path));
  const scannedFolderPaths = new Set(scan.folders);

  const existingFileByPath = new Map(project.files.map((file) => [file.path, file]));
  const existingFolderByPath = new Map(project.folders.map((folder) => [folder.path, folder]));

  for (const file of scan.files) {
    const existing = existingFileByPath.get(file.path);
    if (existing) {
      await db.scriptFile.update({
        where: { id: existing.id },
        data: { content: file.content },
      });
    } else {
      await db.scriptFile.create({
        data: {
          projectId,
          path: file.path,
          content: file.content,
          language: detectLanguage(file.path),
        },
      });
    }
  }

  const foldersFromFiles = new Set<string>();
  for (const filePath of scannedFilePaths) {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const segment of parts) {
      current = current ? `${current}/${segment}` : segment;
      foldersFromFiles.add(current);
    }
  }

  for (const folderPath of new Set([...scannedFolderPaths, ...foldersFromFiles])) {
    if (!existingFolderByPath.has(folderPath)) {
      await db.scriptFolder.create({ data: { projectId, path: folderPath } }).catch(() => {});
    }
  }

  for (const file of project.files) {
    if (!scannedFilePaths.has(file.path)) {
      await db.scriptFile.delete({ where: { id: file.id } }).catch(() => {});
    }
  }

  for (const folder of project.folders) {
    if (!scannedFolderPaths.has(folder.path) && !foldersFromFiles.has(folder.path)) {
      await db.scriptFolder.delete({ where: { id: folder.id } }).catch(() => {});
    }
  }

  await db.scriptProject.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  }).catch(() => {});
}
