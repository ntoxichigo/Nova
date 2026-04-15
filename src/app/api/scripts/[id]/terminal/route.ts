import { NextRequest } from 'next/server';
import { spawnProjectShellCommand } from '@/lib/script-executor';
import { ensureProjectWorkspace, syncWorkspaceBackToProject } from '@/lib/script-workspaces';
import { db } from '@/lib/db';
import { ensureScriptProjectExists } from '@/lib/script-projects';
import { tryRecordAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  await ensureScriptProjectExists(projectId);

  const body = await request.json();
  const command = String(body.command || '').trim();
  const timeoutMs = Math.min(60_000, Math.max(3_000, Number(body.timeoutMs) || 20_000));

  if (!command) {
    return Response.json({ error: 'Command is required.' }, { status: 400 });
  }

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

  const commandRun = await db.scriptCommandExecution.create({
    data: {
      projectId,
      command,
      status: 'running',
      output: '',
      error: '',
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const startedAt = Date.now();
      let workspaceDir = '';
      let child = null as ReturnType<typeof spawnProjectShellCommand> | null;
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

      const finalize = async (status: 'success' | 'error', message?: string, exitCode?: number | null) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        flushRemainders();

        if (message) {
          errorMessage = message;
          send({ type: 'error', message });
        }

        const durationMs = Date.now() - startedAt;
        await syncWorkspaceBackToProject(projectId, project.name).catch(() => {});

        await db.scriptCommandExecution.update({
          where: { id: commandRun.id },
          data: {
            status,
            output: combinedOutput.slice(0, 100_000),
            error: errorMessage.slice(0, 10_000),
            duration: durationMs,
            exitCode: typeof exitCode === 'number' ? exitCode : null,
          },
        }).catch(() => {});

        await db.scriptProject.update({
          where: { id: projectId },
          data: { updatedAt: new Date() },
        }).catch(() => {});

        await tryRecordAuditEvent({
          source: 'scripts',
          action: 'execute_command',
          entityType: 'script_command',
          entityId: commandRun.id,
          entityLabel: command,
          status,
          severity: status === 'error' ? 'warning' : 'info',
          summary: status === 'error' ? 'IDE command failed' : 'IDE command completed',
          details: {
            projectId,
            command,
            durationMs,
            exitCode,
            killedByTimeout,
            killedByClient,
            outputPreview: (combinedOutput || errorMessage).slice(0, 300),
          },
        }).catch(() => {});

        send({
          type: 'command_done',
          status,
          duration: durationMs,
          exitCode: typeof exitCode === 'number' ? exitCode : null,
          commandId: commandRun.id,
          killedByTimeout,
          killedByClient,
        });

        if (child && !child.killed) {
          child.kill();
        }
        controller.close();
      };

      request.signal.addEventListener('abort', () => {
        killedByClient = true;
        if (child && !child.killed) {
          child.kill();
        }
      });

      try {
        workspaceDir = await ensureProjectWorkspace({
          id: project.id,
          name: project.name,
          files: project.files.map((file) => ({ path: file.path, content: file.content })),
          folders: project.folders.map((folder) => ({ path: folder.path })),
        });

        send({ type: 'command_start', commandId: commandRun.id, command, workspaceDir });
        child = spawnProjectShellCommand({ command, workspaceDir });

        timeoutHandle = setTimeout(() => {
          killedByTimeout = true;
          if (child && !child.killed) {
            child.kill();
          }
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer | string) => appendOutput(String(chunk), false));
        child.stderr.on('data', (chunk: Buffer | string) => appendOutput(String(chunk), true));

        child.on('error', async (error) => {
          await finalize('error', error.message || 'Command failed to start.', null);
        });

        child.on('close', async (code, signal) => {
          if (settled) return;
          if (killedByClient) {
            await finalize('error', 'Command stopped by user.', code ?? null);
            return;
          }
          if (killedByTimeout) {
            await finalize('error', `Command timed out after ${timeoutMs}ms.`, code ?? null);
            return;
          }
          if (signal && signal !== 'SIGTERM') {
            await finalize('error', `Command stopped with signal ${signal}.`, code ?? null);
            return;
          }
          if (code && code !== 0 && !errorMessage) {
            errorMessage = `Command exited with code ${code}.`;
          }
          await finalize(code && code !== 0 ? 'error' : 'success', errorMessage || undefined, code ?? null);
        });
      } catch (error) {
        await finalize('error', error instanceof Error ? error.message : 'Command failed', null);
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
