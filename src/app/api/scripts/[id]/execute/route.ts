import { NextRequest } from 'next/server';
import {
  detectExecutionRuntime,
  resolveWorkspaceEntryPath,
  spawnProjectProcess,
} from '@/lib/script-executor';
import { db } from '@/lib/db';
import { ensureScriptProjectExists, findScriptFileInProject } from '@/lib/script-projects';
import { tryRecordAuditEvent } from '@/lib/audit';
import { ensureProjectWorkspace, syncWorkspaceBackToProject } from '@/lib/script-workspaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  await ensureScriptProjectExists(projectId);

  const body = await request.json();
  const fileId = body.fileId as string | undefined;
  const inlineCode = body.code !== undefined ? String(body.code) : undefined;
  const timeoutMs = Math.min(20_000, Math.max(3_000, Number(body.timeoutMs) || 12_000));

  const project = await db.scriptProject.findUnique({
    where: { id: projectId },
    include: {
      files: { orderBy: { path: 'asc' } },
      folders: { orderBy: { path: 'asc' } },
    },
  });

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  let targetFile = fileId ? await findScriptFileInProject(projectId, fileId) : project.files[0] ?? null;
  if (!targetFile) {
    return Response.json({ error: 'No file selected to execute' }, { status: 400 });
  }

  const runtimeInfo = detectExecutionRuntime(targetFile.path);
  if (runtimeInfo.runtime === 'preview-only' || runtimeInfo.runtime === 'unsupported') {
    return Response.json({ error: runtimeInfo.reason || 'This file is not executable in the IDE yet.' }, { status: 400 });
  }

  const projectFiles = project.files.map((file) => ({
    path: file.path,
    content: file.id === targetFile?.id && inlineCode !== undefined ? inlineCode : file.content,
    language: file.language,
  }));

  const execution = await db.scriptExecution.create({
    data: { projectId, fileId: targetFile.id, status: 'running', output: '', error: '' },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const startedAt = Date.now();
      let workspaceDir = '';
      let child = null as ReturnType<typeof spawnProjectProcess> | null;
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let combinedOutput = '';
      let errorMessage = '';
      let settled = false;
      let killedByTimeout = false;
      let killedByClient = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const appendOutput = (chunk: string, isError = false) => {
        const text = chunk.replace(/\r\n/g, '\n');
        combinedOutput += isError ? `[stderr] ${text}` : text;
        const bufferName = isError ? 'stderrBuffer' : 'stdoutBuffer';
        if (isError) {
          stderrBuffer += text;
          const parts = stderrBuffer.split('\n');
          stderrBuffer = parts.pop() ?? '';
          for (const part of parts) {
            send({ type: 'output', stream: 'stderr', text: part });
          }
        } else {
          stdoutBuffer += text;
          const parts = stdoutBuffer.split('\n');
          stdoutBuffer = parts.pop() ?? '';
          for (const part of parts) {
            send({ type: 'output', stream: 'stdout', text: part });
          }
        }
      };

      const flushRemainders = () => {
        if (stdoutBuffer) {
          send({ type: 'output', stream: 'stdout', text: stdoutBuffer });
          stdoutBuffer = '';
        }
        if (stderrBuffer) {
          send({ type: 'output', stream: 'stderr', text: stderrBuffer });
          stderrBuffer = '';
        }
      };

      const finalize = async (status: 'success' | 'error', message?: string) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        flushRemainders();

        if (message) {
          errorMessage = message;
          send({ type: 'error', message });
        }

        const durationMs = Date.now() - startedAt;

        await db.scriptExecution.update({
          where: { id: execution.id },
          data: {
            status,
            output: combinedOutput.slice(0, 100_000),
            error: errorMessage.slice(0, 10_000),
            duration: durationMs,
          },
        }).catch(() => {});

        await db.scriptProject.update({
          where: { id: projectId },
          data: { updatedAt: new Date() },
        }).catch(() => {});

        await tryRecordAuditEvent({
          source: 'scripts',
          action: 'execute_project',
          entityType: 'script_execution',
          entityId: execution.id,
          entityLabel: targetFile?.path || projectId,
          status,
          severity: status === 'error' ? 'warning' : 'info',
          summary: status === 'error' ? 'Project execution failed' : 'Project execution completed',
          details: {
            projectId,
            fileId: targetFile?.id || null,
            runtime: runtimeInfo.label,
            entryPath: targetFile?.path || '',
            durationMs,
            outputPreview: (combinedOutput || errorMessage).slice(0, 300),
            killedByTimeout,
          },
        }).catch(() => {});

        send({
          type: 'exec_done',
          duration: durationMs,
          status,
          runtime: runtimeInfo.label,
          entryPath: targetFile?.path || '',
          executionId: execution.id,
          killedByTimeout,
        });

        if (child && !child.killed) {
          child.kill();
        }
        await syncWorkspaceBackToProject(projectId, project.name).catch(() => {});
        controller.close();
      };

      request.signal.addEventListener('abort', () => {
        killedByClient = true;
        if (child && !child.killed) {
          child.kill();
        }
      });

      try {
        send({ type: 'exec_start', executionId: execution.id, runtime: runtimeInfo.label, entryPath: targetFile.path });

        workspaceDir = await ensureProjectWorkspace({
          id: project.id,
          name: project.name,
          files: projectFiles,
          folders: project.folders.map((folder) => ({ path: folder.path })),
        });
        const entryAbsolutePath = resolveWorkspaceEntryPath(workspaceDir, targetFile.path);
        child = spawnProjectProcess(runtimeInfo, workspaceDir, entryAbsolutePath);

        timeoutHandle = setTimeout(() => {
          killedByTimeout = true;
          if (child && !child.killed) {
            child.kill();
          }
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer | string) => appendOutput(String(chunk), false));
        child.stderr.on('data', (chunk: Buffer | string) => appendOutput(String(chunk), true));

        child.on('error', async (error) => {
          await finalize('error', error.message || 'Execution process failed to start.');
        });

        child.on('close', async (code, signal) => {
          if (settled) return;
          if (killedByClient) {
            await finalize('error', 'Execution stopped by user.');
            return;
          }
          if (killedByTimeout) {
            await finalize('error', `Execution timed out after ${timeoutMs}ms.`);
            return;
          }
          if (signal && signal !== 'SIGTERM') {
            await finalize('error', `Execution stopped with signal ${signal}.`);
            return;
          }
          if (code && code !== 0 && !errorMessage) {
            errorMessage = `Process exited with code ${code}.`;
          }
          await finalize(code && code !== 0 ? 'error' : 'success', errorMessage || undefined);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Execution failed';
        await finalize('error', message);
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
