import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { getLLMConfig } from '@/lib/settings';
import { createLLMProvider } from '@/lib/llm';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import type { LLMMessage } from '@/lib/llm/types';
import { buildRuntimeProfile, clipText, extractInlineToolCall, streamProviderText } from '@/lib/chat/stream-utils';
import { tryRecordAuditEvent } from '@/lib/audit';
import { detectExecutionRuntime, detectLanguage, resolveWorkspaceEntryPath, spawnProjectProcess, spawnProjectShellCommand } from '@/lib/script-executor';
import { getAutonomyProfile, getOrchestrationSettings } from '@/lib/orchestration/config';
import { buildContextPack, classifyTaskMode } from '@/lib/orchestration/context-engine';
import { routeStageModel, summarizeRoutes } from '@/lib/orchestration/model-router';
import { runPlannerSpecialist, runVerifierSpecialist } from '@/lib/orchestration/specialists';
import { recordOrchestrationTrace } from '@/lib/orchestration/telemetry';
import type { OrchestrationTraceStage, RoutedStage } from '@/lib/orchestration/types';
import {
  deleteWorkspaceFolder,
  deleteWorkspaceFile,
  ensureProjectWorkspace,
  ensureWorkspaceFolder,
  normalizeProjectPath,
  syncWorkspaceBackToProject,
  writeWorkspaceFile,
} from '@/lib/script-workspaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams { params: Promise<{ id: string }> }

interface ProjectSnapshot {
  id: string;
  name: string;
  description: string;
  files: Array<{ id: string; path: string; content: string; language: string }>;
  folders: Array<{ id: string; path: string }>;
  messages: Array<{ id: string; role: string; content: string; toolCalls: string; createdAt: Date }>;
}

interface ToolExecutionResult {
  content: string;
  error?: string;
}

interface BatchWorkspaceFileInput {
  path: string;
  content: string;
}

const EXECUTION_CONFIRMATION_PATTERN = /^(yes|yeah|yep|ok|okay|sure|do it|di it|go ahead|carry on|continue|proceed|execute|implement|build it|ship it|do it all|all of it|make it happen|finish it)$/i;
const ACTION_REQUEST_PATTERN = /\b(build|create|implement|execute|do it|carry on|continue|scaffold|set up|setup|add|update|fix|write|generate|finish)\b/i;
const PLAN_ONLY_PATTERN = /(\*\*plan\*\*|^plan\b|let me|i(?:'|â€™)ll|i will|i can start|i can begin|creating .* now|let me start|let me begin)/i;
const STEP_LIST_PATTERN = /(^|\n)\s*(\d+\.|-)\s+/;
const IDENTITY_QUERY_PATTERNS = [
  /^(what(?:'s| is)\s+my\s+name)\??$/i,
  /^(who\s+am\s+i)\??$/i,
  /^(do\s+you\s+know\s+my\s+name)\??$/i,
  /^(tell\s+me\s+my\s+name)\??$/i,
];
const NAME_DECLARATION_PATTERNS = [
  /\bmy name is\s+([a-z][a-z' -]{0,40})\b/i,
  /\bcall me\s+([a-z][a-z' -]{0,40})\b/i,
  /\bi am\s+([a-z][a-z' -]{0,40})\b/i,
  /\bi'm\s+([a-z][a-z' -]{0,40})\b/i,
];
const NAME_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'for',
  'working', 'building', 'coding', 'ready', 'fine', 'good', 'great', 'ok', 'okay', 'here',
  'trying', 'using', 'doing', 'back', 'new', 'old', 'sure', 'yes', 'no', 'unknown',
]);

async function loadProject(projectId: string): Promise<ProjectSnapshot | null> {
  return db.scriptProject.findUnique({
    where: { id: projectId },
    include: {
      files: { orderBy: { path: 'asc' } },
      folders: { orderBy: { path: 'asc' } },
      messages: { take: 30, orderBy: { createdAt: 'asc' } },
    },
  });
}

function normalizeToolCallPayload(
  parsed: unknown,
  toolNames: string[],
): { name: string; arguments: Record<string, unknown> } | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const candidateName = String(payload.name || payload.command || payload.tool || payload.action || '').trim();
  if (!candidateName || !toolNames.includes(candidateName)) {
    return null;
  }

  const candidateArgs = payload.arguments ?? payload.args ?? payload.params ?? payload.data ?? {};
  return {
    name: candidateName,
    arguments: candidateArgs && typeof candidateArgs === 'object' ? candidateArgs as Record<string, unknown> : {},
  };
}

function parseFencedToolPayload(
  rawPayload: string,
  toolNames: string[],
): { name: string; arguments: Record<string, unknown> } | null {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return normalizeToolCallPayload(JSON.parse(trimmed), toolNames);
  } catch {
    // fall through
  }

  const [firstLine, ...restLines] = trimmed.split(/\r?\n/);
  const toolName = firstLine.trim();
  if (!toolNames.includes(toolName)) {
    return null;
  }

  const rest = restLines.join('\n').trim();
  if (!rest) {
    return { name: toolName, arguments: {} };
  }

  try {
    const parsedArgs = JSON.parse(rest);
    return {
      name: toolName,
      arguments: parsedArgs && typeof parsedArgs === 'object' ? parsedArgs as Record<string, unknown> : {},
    };
  } catch {
    return { name: toolName, arguments: {} };
  }
}

function parseXmlToolPayload(
  content: string,
  toolNames: string[],
): { name: string; arguments: Record<string, unknown> } | null {
  const match = content.match(/<tool_call>\s*<tool_name>([^<]+)<\/tool_name>\s*<parameters>\s*([\s\S]*?)\s*<\/parameters>\s*<\/tool_call>/i);
  if (!match) {
    return null;
  }

  const toolName = match[1].trim();
  if (!toolNames.includes(toolName)) {
    return null;
  }

  try {
    const parsedArgs = JSON.parse(match[2].trim());
    return {
      name: toolName,
      arguments: parsedArgs && typeof parsedArgs === 'object' ? parsedArgs as Record<string, unknown> : {},
    };
  } catch {
    return { name: toolName, arguments: {} };
  }
}

function stripToolBlocks(content: string, toolNames: string[]): string {
  const stripFence = (source: string, pattern: RegExp) => source.replace(pattern, (block) => {
    const match = block.match(/```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)```/);
    if (!match) return block;
    return parseFencedToolPayload(match[1], toolNames) ? '' : block;
  });

  const stripped = stripFence(
    stripFence(content, /```tool\s*[\s\S]*?```/g),
    /```json\s*[\s\S]*?```/g,
  );

  return stripped.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, (block) => (
    parseXmlToolPayload(block, toolNames) ? '' : block
  )).trim();
}

function extractToolCall(content: string, toolNames: string[]) {
  const xmlToolCall = parseXmlToolPayload(content, toolNames);
  if (xmlToolCall) {
    return xmlToolCall;
  }

  const fencedMatches = content.matchAll(/```(?:tool|json)\s*\r?\n([\s\S]*?)```/g);
  for (const match of fencedMatches) {
    const normalized = parseFencedToolPayload(match[1], toolNames);
    if (normalized) {
      return normalized;
    }
  }

  const inline = extractInlineToolCall(content, toolNames);
  if (inline) {
    return { name: inline.name, arguments: inline.arguments };
  }

  return null;
}

function buildWorkspaceContext(project: ProjectSnapshot, activeFileId?: string): string {
  const activeFile = project.files.find((file) => file.id === activeFileId) ?? project.files[0] ?? null;
  const otherFiles = project.files.filter((file) => file.id !== activeFile?.id);
  const recentMessages = project.messages.slice(-8).map((entry) => `${entry.role.toUpperCase()}: ${clipText(entry.content, 500)}`).join('\n\n');

  return [
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : '',
    project.folders.length > 0 ? `Folders:\n${project.folders.map((folder) => `- ${folder.path}`).join('\n')}` : 'Folders:\n- (none yet)',
    `Files:\n${project.files.map((file) => `- ${file.path} [${file.language}]`).join('\n')}`,
    activeFile ? `Active File: ${activeFile.path}\n\n${clipText(activeFile.content, 9000)}` : 'Active File: none selected',
    otherFiles.length > 0 ? `Other File Previews:\n${otherFiles.slice(0, 6).map((file) => `## ${file.path}\n${clipText(file.content, 700)}`).join('\n\n')}` : '',
    recentMessages ? `Recent IDE Messages:\n${recentMessages}` : '',
  ].filter(Boolean).join('\n\n');
}

function isExecutionConfirmation(message: string): boolean {
  return EXECUTION_CONFIRMATION_PATTERN.test(message.trim());
}

function isActionRequest(message: string): boolean {
  return ACTION_REQUEST_PATTERN.test(message);
}

function findLatestConcreteObjective(project: ProjectSnapshot, currentMessage: string): string | null {
  const priorUserMessages = project.messages
    .filter((entry) => entry.role === 'user')
    .map((entry) => entry.content.trim())
    .filter((entry) => entry && !isExecutionConfirmation(entry))
    .filter((entry) => entry !== currentMessage.trim());

  return priorUserMessages.at(-1) ?? null;
}

function buildEffectiveUserRequest(project: ProjectSnapshot, message: string): string {
  if (!isExecutionConfirmation(message)) {
    return `User request: ${message}`;
  }

  const objective = findLatestConcreteObjective(project, message) || 'the most recent planned workspace task';
  return [
    `User request: ${message}`,
    `This is explicit confirmation to execute the previously discussed task.`,
    `Primary objective: ${objective}`,
    `Do not restate the plan unless the objective changed.`,
    `Start taking IDE actions immediately and keep going until you have made meaningful implementation progress.`,
  ].join('\n');
}

function looksLikePlanWithoutAction(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return PLAN_ONLY_PATTERN.test(trimmed) && (STEP_LIST_PATTERN.test(trimmed) || trimmed.length < 1200);
}

function isIdentityRecallMessage(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 120) return false;
  return IDENTITY_QUERY_PATTERNS.some((pattern) => pattern.test(text));
}

function toDisplayName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeNameCandidate(candidate: string): string | null {
  const cleaned = candidate
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[.,!?;:()[\]{}\"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!cleaned) return null;
  const parts = cleaned.split(' ').filter(Boolean).slice(0, 3);
  if (parts.length === 0) return null;
  if (parts.every((part) => NAME_STOPWORDS.has(part))) return null;
  if (parts.some((part) => part.length < 2 || part.length > 24)) return null;
  if (parts.some((part) => /\d/.test(part))) return null;
  return toDisplayName(parts.join(' '));
}

function extractNameFromText(content: string): string | null {
  for (const pattern of NAME_DECLARATION_PATTERNS) {
    const match = content.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeNameCandidate(match[1]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

async function resolveKnownUserName(projectId: string, projectMessages: ProjectSnapshot['messages']): Promise<string | null> {
  const [relations, memories, latestScriptMessages] = await Promise.all([
    db.memoryRelation.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
    db.agentMemory.findMany({ orderBy: [{ importance: 'desc' }, { lastAccessed: 'desc' }], take: 50 }),
    db.scriptMessage.findMany({
      where: { projectId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
  ]);

  for (const relation of relations) {
    if (!/user/i.test(relation.subject)) continue;
    if (!/(name|named|call)/i.test(relation.relation)) continue;
    const normalized = normalizeNameCandidate(relation.object);
    if (normalized) return normalized;
  }

  for (const memory of memories) {
    const parsed = extractNameFromText(memory.content);
    if (parsed) return parsed;
  }

  for (const entry of latestScriptMessages) {
    const parsed = extractNameFromText(entry.content);
    if (parsed) return parsed;
  }

  for (const entry of [...projectMessages].reverse()) {
    if (entry.role !== 'user') continue;
    const parsed = extractNameFromText(entry.content);
    if (parsed) return parsed;
  }

  return null;
}

async function ensureFolderChain(projectId: string, filePath: string) {
  const parts = normalizeProjectPath(filePath).split('/');
  parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!current) continue;
    await db.scriptFolder.upsert({
      where: {
        projectId_path: {
          projectId,
          path: current,
        },
      },
      update: {},
      create: { projectId, path: current },
    }).catch(() => {});
  }
}

async function upsertProjectFile(projectId: string, projectName: string, file: BatchWorkspaceFileInput) {
  const targetPath = normalizeProjectPath(file.path);
  const existing = await db.scriptFile.findFirst({
    where: { projectId, path: targetPath },
    select: { id: true },
  });

  if (existing) {
    await db.scriptFile.update({
      where: { id: existing.id },
      data: {
        content: file.content,
        language: detectLanguage(targetPath),
      },
    });
  } else {
    await db.scriptFile.create({
      data: {
        projectId,
        path: targetPath,
        content: file.content,
        language: detectLanguage(targetPath),
      },
    });
  }

  await ensureFolderChain(projectId, targetPath);
  await writeWorkspaceFile(projectId, projectName, targetPath, file.content);
}

async function createProjectFolder(projectId: string, projectName: string, folderPath: string) {
  const normalizedFolderPath = normalizeProjectPath(folderPath);
  await db.scriptFolder.upsert({
    where: { projectId_path: { projectId, path: normalizedFolderPath } },
    update: {},
    create: { projectId, path: normalizedFolderPath },
  });
  await ensureWorkspaceFolder(projectId, projectName, normalizedFolderPath);
}

async function deleteProjectFileByPath(projectId: string, projectName: string, filePath: string) {
  const normalizedPath = normalizeProjectPath(filePath);
  const existing = await db.scriptFile.findFirst({
    where: { projectId, path: normalizedPath },
    select: { id: true },
  });
  if (!existing) {
    return false;
  }

  await db.scriptFile.delete({ where: { id: existing.id } });
  await deleteWorkspaceFile(projectId, projectName, normalizedPath);
  return true;
}

async function deleteProjectFolderByPath(projectId: string, projectName: string, folderPath: string) {
  const normalizedFolderPath = normalizeProjectPath(folderPath);
  const folder = await db.scriptFolder.findFirst({
    where: { projectId, path: normalizedFolderPath },
    select: { id: true },
  });
  if (!folder) {
    return false;
  }

  await db.scriptFolder.delete({ where: { id: folder.id } });
  await deleteWorkspaceFolder(projectId, projectName, normalizedFolderPath);
  return true;
}

async function applyBatchWorkspaceChanges(
  project: ProjectSnapshot,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const operationInputs = [
    ...(Array.isArray(args.operations)
      ? args.operations.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      : []),
    ...(Array.isArray(args.actions)
      ? args.actions.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      : []),
  ];

  const folderInputs = [
    ...(Array.isArray(args.folders)
    ? args.folders.map((folder) => String(folder)).filter(Boolean)
    : []),
    ...operationInputs
      .filter((entry) => {
        const type = String(entry.type || entry.action || '').toLowerCase();
        return type === 'create_folder' || type === 'ensure_folder' || type === 'mkdir';
      })
      .map((entry) => String(entry.path || entry.folderPath || ''))
      .filter(Boolean),
  ];
  const fileInputs = [
    ...(Array.isArray(args.files)
    ? args.files
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
          path: String(entry.path || ''),
          content: String(entry.content ?? ''),
        }))
        .filter((entry) => entry.path)
    : []),
    ...operationInputs
      .filter((entry) => {
        const type = String(entry.type || entry.action || '').toLowerCase();
        return type === 'write_file' || type === 'create_file' || type === 'update_file';
      })
      .map((entry) => ({
        path: String(entry.path || ''),
        content: String(entry.content ?? ''),
      }))
      .filter((entry) => entry.path),
  ];
  const deleteFileInputs = [
    ...(Array.isArray(args.deleteFiles)
    ? args.deleteFiles.map((filePath) => String(filePath)).filter(Boolean)
    : []),
    ...operationInputs
      .filter((entry) => String(entry.type || entry.action || '').toLowerCase() === 'delete_file')
      .map((entry) => String(entry.path || ''))
      .filter(Boolean),
  ];
  const deleteFolderInputs = [
    ...(Array.isArray(args.deleteFolders)
    ? args.deleteFolders.map((folderPath) => String(folderPath)).filter(Boolean)
    : []),
    ...operationInputs
      .filter((entry) => String(entry.type || entry.action || '').toLowerCase() === 'delete_folder')
      .map((entry) => String(entry.path || entry.folderPath || ''))
      .filter(Boolean),
  ];

  const projectUpdates: Record<string, string> = {};
  if (args.projectName !== undefined) {
    projectUpdates.name = String(args.projectName).slice(0, 120);
  }
  if (args.projectDescription !== undefined) {
    projectUpdates.description = String(args.projectDescription).slice(0, 500);
  }
  for (const operation of operationInputs) {
    if (String(operation.type || operation.action || '').toLowerCase() !== 'update_project') continue;
    if (operation.name !== undefined || operation.projectName !== undefined) {
      projectUpdates.name = String(operation.name || operation.projectName).slice(0, 120);
    }
    if (operation.description !== undefined || operation.projectDescription !== undefined) {
      projectUpdates.description = String(operation.description || operation.projectDescription).slice(0, 500);
    }
  }

  if (
    folderInputs.length === 0 &&
    fileInputs.length === 0 &&
    deleteFileInputs.length === 0 &&
    deleteFolderInputs.length === 0 &&
    Object.keys(projectUpdates).length === 0
  ) {
    return { content: '', error: 'Batch apply needs folders, files, deleteFiles, deleteFolders, or project updates.' };
  }

  try {
    const nextProjectName = projectUpdates.name || project.name;

    for (const folderPath of folderInputs) {
      await createProjectFolder(project.id, nextProjectName, folderPath);
    }

    for (const file of fileInputs) {
      await upsertProjectFile(project.id, nextProjectName, file);
    }

    let deletedFiles = 0;
    for (const filePath of deleteFileInputs) {
      if (await deleteProjectFileByPath(project.id, nextProjectName, filePath)) {
        deletedFiles += 1;
      }
    }

    let deletedFolders = 0;
    for (const folderPath of deleteFolderInputs) {
      if (await deleteProjectFolderByPath(project.id, nextProjectName, folderPath)) {
        deletedFolders += 1;
      }
    }

    if (Object.keys(projectUpdates).length > 0) {
      await db.scriptProject.update({
        where: { id: project.id },
        data: projectUpdates,
      });
    }

    return {
      content: [
        folderInputs.length > 0 ? `Created or ensured ${folderInputs.length} folder(s)` : null,
        fileInputs.length > 0 ? `Wrote ${fileInputs.length} file(s)` : null,
        deletedFiles > 0 ? `Deleted ${deletedFiles} file(s)` : null,
        deletedFolders > 0 ? `Deleted ${deletedFolders} folder(s)` : null,
        Object.keys(projectUpdates).length > 0 ? `Updated project fields: ${Object.keys(projectUpdates).join(', ')}` : null,
      ].filter(Boolean).join('; ') + '.',
    };
  } catch (error) {
    return {
      content: '',
      error: error instanceof Error ? error.message : 'Batch workspace update failed.',
    };
  }
}

async function executeProjectFile(project: ProjectSnapshot, filePath: string, timeoutMs: number): Promise<ToolExecutionResult> {
  const normalizedPath = normalizeProjectPath(filePath);
  const targetFile = project.files.find((file) => file.path === normalizedPath);
  if (!targetFile) {
    return { content: '', error: `File not found: ${normalizedPath}` };
  }

  const runtimeInfo = detectExecutionRuntime(targetFile.path);
  if (runtimeInfo.runtime === 'preview-only' || runtimeInfo.runtime === 'unsupported') {
    return { content: '', error: runtimeInfo.reason || 'This file is not executable in the IDE yet.' };
  }

  const execution = await db.scriptExecution.create({
    data: {
      projectId: project.id,
      fileId: targetFile.id,
      status: 'running',
      output: '',
      error: '',
    },
  });

  const workspaceDir = await ensureProjectWorkspace({
    id: project.id,
    name: project.name,
    files: project.files.map((file) => ({ path: file.path, content: file.content })),
    folders: project.folders.map((folder) => ({ path: folder.path })),
  });
  const entryAbsolutePath = resolveWorkspaceEntryPath(workspaceDir, targetFile.path);
  const child = spawnProjectProcess(runtimeInfo, workspaceDir, entryAbsolutePath);

  const startedAt = Date.now();
  let output = '';
  let errorOutput = '';
  let killedByTimeout = false;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const result = await new Promise<ToolExecutionResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ content: output.trim(), error: error.message || 'Execution failed to start.' });
    });
    child.on('close', (code) => {
      if (killedByTimeout) {
        resolve({ content: output.trim(), error: `Execution timed out after ${timeoutMs}ms.` });
        return;
      }
      if (code && code !== 0) {
        resolve({ content: output.trim(), error: errorOutput.trim() || `Process exited with code ${code}.` });
        return;
      }
      resolve({ content: (output || '(no output)').trim() });
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  const durationMs = Date.now() - startedAt;

  await syncWorkspaceBackToProject(project.id, project.name).catch(() => {});
  await db.scriptExecution.update({
    where: { id: execution.id },
    data: {
      status: result.error ? 'error' : 'success',
      output: output.slice(0, 100_000),
      error: (result.error || errorOutput).slice(0, 10_000),
      duration: durationMs,
    },
  }).catch(() => {});

  return result.error
    ? { content: output.trim(), error: result.error }
    : { content: `${result.content}\n\n[finished in ${durationMs}ms]` };
}

async function runProjectCommand(project: ProjectSnapshot, command: string, timeoutMs: number): Promise<ToolExecutionResult> {
  const trimmed = String(command || '').trim();
  if (!trimmed) {
    return { content: '', error: 'Command is required.' };
  }

  const commandRun = await db.scriptCommandExecution.create({
    data: {
      projectId: project.id,
      command: trimmed,
      status: 'running',
      output: '',
      error: '',
    },
  });

  const workspaceDir = await ensureProjectWorkspace({
    id: project.id,
    name: project.name,
    files: project.files.map((file) => ({ path: file.path, content: file.content })),
    folders: project.folders.map((folder) => ({ path: folder.path })),
  });
  const child = spawnProjectShellCommand({ command: trimmed, workspaceDir });

  const startedAt = Date.now();
  let output = '';
  let errorOutput = '';
  let killedByTimeout = false;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const result = await new Promise<ToolExecutionResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ content: output.trim(), error: error.message || 'Command failed to start.' });
    });
    child.on('close', (code) => {
      if (killedByTimeout) {
        resolve({ content: output.trim(), error: `Command timed out after ${timeoutMs}ms.` });
        return;
      }
      if (code && code !== 0) {
        resolve({ content: output.trim(), error: errorOutput.trim() || `Command exited with code ${code}.` });
        return;
      }
      resolve({ content: (output || '(no output)').trim() });
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  const durationMs = Date.now() - startedAt;

  await syncWorkspaceBackToProject(project.id, project.name).catch(() => {});
  await db.scriptCommandExecution.update({
    where: { id: commandRun.id },
    data: {
      status: result.error ? 'error' : 'success',
      output: output.slice(0, 100_000),
      error: (result.error || errorOutput).slice(0, 10_000),
      duration: durationMs,
      exitCode: result.error ? 1 : 0,
    },
  }).catch(() => {});

  return result.error
    ? { content: output.trim(), error: result.error }
    : { content: `${result.content}\n\n[command finished in ${durationMs}ms]` };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const body = await request.json();
  const message = String(body.message || '').trim();
  const activeFileId = body.activeFileId ? String(body.activeFileId) : undefined;

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 });
  }

  const initialProject = await loadProject(projectId);
  if (!initialProject) {
    return new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 });
  }
  let project: ProjectSnapshot = initialProject;

  await db.scriptMessage.create({
    data: {
      projectId,
      role: 'user',
      content: message,
    },
  });

  if (isIdentityRecallMessage(message)) {
    const knownName = await resolveKnownUserName(projectId, project.messages);
    const quickReply = knownName
      ? `Your name is ${knownName}.`
      : `I don't have your name saved yet. Tell me "my name is <name>" and I will remember it.`;

    const savedAssistant = await db.scriptMessage.create({
      data: {
        projectId,
        role: 'assistant',
        content: quickReply,
        toolCalls: JSON.stringify([]),
      },
    });

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        send({
          type: 'meta',
          model: 'fast-identity',
          provider: 'system',
          mode: 'ide-assistant',
          taskMode: 'chat',
          autonomyProfile: 'shortcut',
          autonomyLabel: 'Shortcut',
          routeSummary: 'Identity shortcut (no planner)',
        });
        send({ type: 'replace', content: quickReply });
        send({ type: 'done', messageId: savedAssistant.id, toolsUsed: [] });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  const [rawConfig, orchestrationSettings] = await Promise.all([
    getLLMConfig(),
    getOrchestrationSettings(),
  ]);
  const taskMode = classifyTaskMode(message, { workspaceAware: true });
  const autonomyProfile = getAutonomyProfile(orchestrationSettings.autonomyProfile);
  const normalizedBaseConfig = {
    ...rawConfig,
    qualityMode: rawConfig.qualityMode === 'high-quality' ? 'high-quality' : 'high-context',
  } as const;
  const initialProfiledConfig = applyModelStabilityProfile(normalizedBaseConfig).config;
  const { config: routedMainConfig, route: mainRoute } = routeStageModel(
    initialProfiledConfig,
    orchestrationSettings,
    'main',
    taskMode,
  );
  const { config: profiledConfig, profile } = applyModelStabilityProfile(routedMainConfig);
  const bootstrapProvider = createLLMProvider(profiledConfig);
  const bootstrapRuntimeProfile = buildRuntimeProfile(profiledConfig, bootstrapProvider, false);
  const config = {
    ...profiledConfig,
    maxTokens: Math.min(
      profiledConfig.maxTokens ?? bootstrapRuntimeProfile.responseTokens,
      bootstrapRuntimeProfile.responseTokens,
      profiledConfig.provider === 'openrouter' ? 6_000 : 32_768,
    ),
    contextWindow: Math.min(
      profiledConfig.contextWindow ?? bootstrapRuntimeProfile.contextWindow,
      bootstrapRuntimeProfile.contextWindow,
    ),
    historyBudget: Math.min(
      profiledConfig.historyBudget ?? bootstrapRuntimeProfile.historyBudget,
      bootstrapRuntimeProfile.historyBudget,
    ),
  };
  const provider = createLLMProvider(config);
  const runtimeProfile = buildRuntimeProfile(config, provider, false);
  const orchestrationRoutes: RoutedStage[] = [mainRoute];
  const orchestrationStageTraces: OrchestrationTraceStage[] = [];

  const encoder = new TextEncoder();
  const toolCallsUsed: string[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
      const toolHandlers = {
        ide_list_workspace: async (): Promise<ToolExecutionResult> => ({
          content: buildWorkspaceContext(project, activeFileId),
        }),
        ide_read_file: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const targetPath = normalizeProjectPath(String(args.path || ''));
          const file = project.files.find((entry) => entry.path === targetPath);
          if (!file) return { content: '', error: `File not found: ${targetPath}` };
          return { content: `${file.path}\n\n${file.content}` };
        },
        ide_write_file: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const targetPath = normalizeProjectPath(String(args.path || ''));
          const content = String(args.content ?? '');
          const existing = project.files.find((entry) => entry.path === targetPath);
          if (existing) {
            await db.scriptFile.update({ where: { id: existing.id }, data: { content } });
          } else {
            await db.scriptFile.create({
              data: {
                projectId,
                path: targetPath,
                content,
                language: detectLanguage(targetPath),
              },
            });
          }
          await ensureFolderChain(projectId, targetPath);
          await writeWorkspaceFile(projectId, project.name, targetPath, content);
          project = (await loadProject(projectId)) ?? project;
          return { content: `Saved ${targetPath}.` };
        },
        ide_create_folder: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const folderPath = normalizeProjectPath(String(args.path || args.folderPath || ''));
          await db.scriptFolder.upsert({
            where: { projectId_path: { projectId, path: folderPath } },
            update: {},
            create: { projectId, path: folderPath },
          });
          await ensureWorkspaceFolder(projectId, project.name, folderPath);
          project = (await loadProject(projectId)) ?? project;
          return { content: `Created folder ${folderPath}.` };
        },
        ide_delete_folder: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const folderPath = normalizeProjectPath(String(args.path || args.folderPath || ''));
          const folder = project.folders.find((entry) => entry.path === folderPath);
          if (!folder) {
            return { content: '', error: `Folder not found: ${folderPath}` };
          }

          const nestedFile = project.files.find((entry) => entry.path.startsWith(`${folderPath}/`));
          const nestedFolder = project.folders.find((entry) => entry.path !== folderPath && entry.path.startsWith(`${folderPath}/`));
          if (nestedFile || nestedFolder) {
            return { content: '', error: `Folder ${folderPath} is not empty.` };
          }

          await db.scriptFolder.delete({ where: { id: folder.id } });
          await deleteWorkspaceFolder(projectId, project.name, folderPath);
          project = (await loadProject(projectId)) ?? project;
          return { content: `Deleted folder ${folderPath}.` };
        },
        ide_delete_file: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const targetPath = normalizeProjectPath(String(args.path || ''));
          const existing = project.files.find((entry) => entry.path === targetPath);
          if (!existing) return { content: '', error: `File not found: ${targetPath}` };
          await db.scriptFile.delete({ where: { id: existing.id } });
          await deleteWorkspaceFile(projectId, project.name, targetPath);
          project = (await loadProject(projectId)) ?? project;
          return { content: `Deleted ${targetPath}.` };
        },
        ide_execute_file: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const targetPath = normalizeProjectPath(String(args.path || ''));
          const latestProject = await loadProject(projectId);
          if (!latestProject) return { content: '', error: 'Project no longer exists.' };
          project = latestProject;
          return executeProjectFile(project, targetPath, Math.min(20_000, Math.max(3_000, Number(args.timeoutMs) || 12_000)));
        },
        ide_run_command: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const latestProject = await loadProject(projectId);
          if (!latestProject) return { content: '', error: 'Project no longer exists.' };
          project = latestProject;
          return runProjectCommand(project, String(args.command || ''), Math.min(45_000, Math.max(3_000, Number(args.timeoutMs) || 20_000)));
        },
        ide_update_project: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const data: Record<string, string> = {};
          if (args.name !== undefined) data.name = String(args.name).slice(0, 120);
          if (args.description !== undefined) data.description = String(args.description).slice(0, 500);
          await db.scriptProject.update({ where: { id: projectId }, data });
          project = (await loadProject(projectId)) ?? project;
          return { content: `Updated project metadata (${Object.keys(data).join(', ') || 'no fields'}).` };
        },
        ide_batch_apply: async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
          const result = await applyBatchWorkspaceChanges(project, args);
          project = (await loadProject(projectId)) ?? project;
          return result;
        },
      } satisfies Record<string, (args: Record<string, unknown>) => Promise<ToolExecutionResult>>;

      const toolNames = Object.keys(toolHandlers);
      const workspaceSnapshot = buildWorkspaceContext(project, activeFileId);
      let contextPack = buildContextPack({
        objective: message,
        taskMode,
        runtimeProfile,
        sections: [
          { label: 'Workspace Snapshot', content: workspaceSnapshot, priority: 1, maxChars: Math.max(2800, runtimeProfile.contextCharBudget) },
          {
            label: 'Recent IDE Messages',
            content: project.messages.slice(-8).map((entry) => `${entry.role.toUpperCase()}: ${clipText(entry.content, 400)}`).join('\n\n'),
            priority: 2,
            maxChars: runtimeProfile.summaryCharLimit,
          },
          {
            label: 'Execution Intent',
            content: buildEffectiveUserRequest(project, message),
            priority: 0,
            maxChars: runtimeProfile.summaryCharLimit,
          },
        ],
      });

      let plannerPlan: Awaited<ReturnType<typeof runPlannerSpecialist>> = null;
      if (orchestrationSettings.scopedAgentsEnabled && autonomyProfile.autoPlan && taskMode !== 'chat') {
        plannerPlan = await runPlannerSpecialist(config, orchestrationSettings, taskMode, contextPack);
        if (plannerPlan) {
          orchestrationRoutes.push(plannerPlan.route);
          orchestrationStageTraces.push(plannerPlan.trace);
        }
      }

      const baseSystemPrompt = [
        `You are Nova IDE Assistant. This is NOT the normal chat.`,
        `You are embedded inside a live project workspace and should act like a senior coding pair.`,
        `Be concise, grounded, and action-oriented.`,
        `Current task mode: ${taskMode}.`,
        `Autonomy profile: ${autonomyProfile.label} (${autonomyProfile.description})`,
        `When changes or execution are needed, give at most a very short PLAN section, then emit exactly one tool call in a fenced tool block.`,
        `After each tool result, continue iterating until the task is complete.`,
        `If the user confirms with messages like "yes", "ok", "do it", "continue", or "carry on", treat that as approval to execute the most recent concrete workspace objective immediately.`,
        `Do not restate the same plan after execution has been confirmed. Start taking IDE actions right away.`,
        `For multi-file scaffolds or broad project setup, prefer ide_batch_apply so you can create folders and many files in one action.`,
        `Never dump raw tool JSON outside a tool block.`,
        `Prefer reading or writing files over vague advice.`,
        `Available IDE tools:`,
        ...toolNames.map((toolName) => `- ${toolName}`),
      ].join('\n');

      const historyMessages: LLMMessage[] = project.messages
        .slice(-10)
        .filter((entry) => !(entry.role === 'user' && entry.content === message))
        .map((entry) => ({
          role: entry.role === 'assistant' ? 'assistant' : 'user',
          content: clipText(entry.content, runtimeProfile.compactMode ? 1200 : 2200),
        }));

      let conversation: LLMMessage[] = [
        { role: 'system', content: baseSystemPrompt },
        ...historyMessages,
        {
          role: 'user',
          content: contextPack.combined,
        },
      ];
      if (plannerPlan?.steps?.length) {
        conversation.push({
          role: 'user',
          content: `Execution plan:\n${plannerPlan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}${plannerPlan.risks.length ? `\nRisks:\n${plannerPlan.risks.map((risk) => `- ${risk}`).join('\n')}` : ''}`,
        });
      }

      send({
        type: 'meta',
        model: config.model || profile.label,
        provider: provider.name,
        mode: 'ide-assistant',
        taskMode,
        autonomyProfile: autonomyProfile.id,
        autonomyLabel: autonomyProfile.label,
        routeSummary: summarizeRoutes(orchestrationRoutes),
        contextPackTokens: contextPack.estimatedTokens,
        droppedContextSections: contextPack.droppedSections,
      });

      let finalContent = '';
      const requiresImmediateAction = isExecutionConfirmation(message) || isActionRequest(message);
      const collectedToolResults: string[] = [];
      const orchestrationNotes: string[] = [];
      for (let step = 0; step < 12; step += 1) {
        send({ type: 'assistant_status', stage: step === 0 ? 'planning' : 'iterating', step });
        const result = await streamProviderText(provider, conversation);
        const rawContent = result.content || '';
        const toolCall = extractToolCall(rawContent, toolNames);
        const cleanContent = stripToolBlocks(rawContent, toolNames);
        const shouldForceActionRetry = requiresImmediateAction && !toolCall && looksLikePlanWithoutAction(cleanContent);

        if (cleanContent && !shouldForceActionRetry) {
          send({ type: 'assistant_note', content: cleanContent, step });
        }

        if (!toolCall) {
          if (shouldForceActionRetry) {
            conversation = [
              ...conversation,
              { role: 'assistant', content: rawContent },
              {
                role: 'user',
                content: [
                  `Stop restating the plan.`,
                  `Take the next concrete IDE action now.`,
                  `Use ide_batch_apply for multi-file scaffolding when appropriate.`,
                  `Respond with exactly one tool block.`,
                ].join(' '),
              },
            ];
            continue;
          }
          finalContent = cleanContent || rawContent.trim();
          break;
        }

        const toolHandler = toolHandlers[toolCall.name as keyof typeof toolHandlers];
        if (!toolHandler) {
          conversation = [
            ...conversation,
            { role: 'assistant', content: rawContent },
            { role: 'user', content: `Tool ${toolCall.name} is not available. Finish without it or choose another tool.` },
          ];
          continue;
        }

        toolCallsUsed.push(toolCall.name);
        send({ type: 'tool_start', toolName: toolCall.name, step });
        const toolResult = await toolHandler(toolCall.arguments || {});
        collectedToolResults.push(
          toolResult.error
            ? `[${toolCall.name}] ERROR: ${toolResult.error}`
            : `[${toolCall.name}] ${toolResult.content}`,
        );
        if (toolResult.error) {
          send({ type: 'tool_error', toolName: toolCall.name, error: toolResult.error, step });
        } else {
          send({ type: 'tool_done', toolName: toolCall.name, result: clipText(toolResult.content, 1200), step });
        }

        const latestProject = await loadProject(projectId);
        if (latestProject) {
          project = latestProject;
        }

        contextPack = buildContextPack({
          objective: message,
          taskMode,
          runtimeProfile,
          sections: [
            { label: 'Workspace Snapshot', content: buildWorkspaceContext(project, activeFileId), priority: 1, maxChars: Math.max(2800, runtimeProfile.contextCharBudget) },
            {
              label: 'Recent IDE Messages',
              content: project.messages.slice(-8).map((entry) => `${entry.role.toUpperCase()}: ${clipText(entry.content, 400)}`).join('\n\n'),
              priority: 2,
              maxChars: runtimeProfile.summaryCharLimit,
            },
            {
              label: 'Execution Intent',
              content: buildEffectiveUserRequest(project, message),
              priority: 0,
              maxChars: runtimeProfile.summaryCharLimit,
            },
          ],
        });

        conversation = [
          ...conversation,
          { role: 'assistant', content: rawContent },
          {
            role: 'user',
            content: `Tool result for ${toolCall.name}:\n${toolResult.error ? `ERROR: ${toolResult.error}` : toolResult.content}\n\nUpdated context pack:\n\n${contextPack.combined}`,
          },
        ];
      }

      if (!finalContent.trim()) {
        if (toolCallsUsed.length > 0) {
          finalContent = `Completed ${toolCallsUsed.length} IDE action${toolCallsUsed.length === 1 ? '' : 's'} in the workspace.`;
        } else {
          finalContent = 'I reviewed the workspace but did not produce a final answer. Please retry or make the task more specific.';
        }
      }

      if (orchestrationSettings.scopedAgentsEnabled && autonomyProfile.autoVerify && finalContent.trim()) {
        const verification = await runVerifierSpecialist(
          config,
          orchestrationSettings,
          taskMode,
          contextPack,
          finalContent,
          collectedToolResults,
        );
        if (verification) {
          orchestrationRoutes.push(verification.route);
          orchestrationStageTraces.push(verification.trace);
          orchestrationNotes.push(`Verifier ${verification.verdict} (${verification.confidence})`);
          send({
            type: 'verification',
            verdict: verification.verdict,
            summary: verification.summary,
            followUp: verification.followUp || null,
            confidence: verification.confidence,
          });
          if (verification.verdict === 'revise' && verification.followUp) {
            finalContent = `${finalContent}\n\nVerification follow-up: ${verification.followUp}`;
            send({ type: 'replace', content: finalContent });
          }
        }
      }

      const promptTokens = conversation.reduce((sum, entry) => sum + Math.ceil(entry.content.length / 4), 0);
      const outputTokens = Math.ceil(finalContent.length / 4);
      orchestrationStageTraces.unshift({
        stage: 'main',
        model: config.model || provider.name || '',
        promptTokens,
        outputTokens,
      });

      const savedAssistant = await db.scriptMessage.create({
        data: {
          projectId,
          role: 'assistant',
          content: finalContent,
          toolCalls: JSON.stringify(toolCallsUsed),
        },
      });

      await recordOrchestrationTrace({
        source: 'scripts',
        entityId: savedAssistant.id,
        entityLabel: project.name,
        taskMode,
        autonomyProfile: autonomyProfile.id,
        provider: config.provider,
        model: config.model || provider.name || '',
        promptTokens,
        outputTokens,
        contextTokens: contextPack.estimatedTokens,
        toolsUsed: toolCallsUsed,
        routes: orchestrationRoutes,
        stages: orchestrationStageTraces,
        notes: [
          ...orchestrationNotes,
          ...(contextPack.droppedSections.length > 0
            ? [`Dropped context sections: ${contextPack.droppedSections.join(', ')}`]
            : []),
        ],
      }).catch(() => {});

      await tryRecordAuditEvent({
        source: 'scripts',
        action: 'assistant_turn',
        entityType: 'script_project',
        entityId: projectId,
        entityLabel: project.name,
        summary: 'IDE assistant completed a workspace-aware turn',
        details: {
          projectId,
          toolsUsed: toolCallsUsed,
          messagePreview: message.slice(0, 200),
          responsePreview: finalContent.slice(0, 300),
        },
      }).catch(() => {});

      send({ type: 'replace', content: finalContent });
      send({ type: 'done', messageId: savedAssistant.id, toolsUsed: toolCallsUsed });
      controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'IDE assistant stream failed.';
        const fallbackContent = `IDE assistant hit an internal error: ${errorMessage}`;
        await recordOrchestrationTrace({
          source: 'scripts',
          entityId: projectId,
          entityLabel: project.name,
          taskMode,
          autonomyProfile: autonomyProfile.id,
          provider: config.provider,
          model: config.model || provider.name || '',
          promptTokens: 0,
          outputTokens: Math.ceil(fallbackContent.length / 4),
          contextTokens: 0,
          toolsUsed: toolCallsUsed,
          routes: orchestrationRoutes,
          stages: orchestrationStageTraces,
          error: errorMessage,
        }).catch(() => {});
        try {
          send({ type: 'error', error: errorMessage });
          send({ type: 'replace', content: fallbackContent });
        } catch {
          // ignore secondary stream errors
        }
        await db.scriptMessage.create({
          data: {
            projectId,
            role: 'assistant',
            content: fallbackContent,
            toolCalls: JSON.stringify(toolCallsUsed),
          },
        }).catch(() => {});
        try {
          send({ type: 'done', toolsUsed: toolCallsUsed });
        } catch {
          // ignore secondary stream errors
        }
        try {
          controller.close();
        } catch {
          // ignore close failures
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}



