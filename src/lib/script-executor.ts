import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

const BLOCKED_PATTERN =
  /\b(require|import\s*\(|fetch|XMLHttpRequest|child_process|exec|spawn|fs\b|path\b|os\b|net\b|eval|Function\s*\(|process\.exit|__dirname|__filename)\b/;

export interface ExecutionResult {
  output: string;
  error: string | null;
  durationMs: number;
}

export interface ProjectExecutionFile {
  path: string;
  content: string;
  language?: string;
}

export interface ProjectWorkspace {
  workspaceDir: string;
  cleanup: () => Promise<void>;
}

export interface ExecutionRuntime {
  runtime: 'node' | 'python' | 'preview-only' | 'unsupported';
  label: string;
  command?: string;
  args?: string[];
  reason?: string;
}

export interface ShellCommandProcessOptions {
  command: string;
  workspaceDir: string;
}

function resolveShellForCommandExecution(): string | true {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const powerShellPath = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (existsSync(powerShellPath)) {
      return powerShellPath;
    }

    const cmdPath = process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
    if (cmdPath && existsSync(cmdPath)) {
      return cmdPath;
    }

    return true;
  }

  const preferredShell = process.env.SHELL;
  if (preferredShell && existsSync(preferredShell)) {
    return preferredShell;
  }
  return '/bin/sh';
}

export async function executeJavaScript(
  code: string,
  timeout = 5000,
): Promise<ExecutionResult> {
  const start = Date.now();

  if (!code.trim()) {
    return { output: '', error: 'Empty code', durationMs: 0 };
  }

  if (BLOCKED_PATTERN.test(code)) {
    return {
      output: '',
      error:
        'Code uses restricted APIs. Only pure computation is allowed (Math, Array, String, Object, JSON, Date, Set, Map, RegExp, console.log).',
      durationMs: Date.now() - start,
    };
  }

  try {
    const vm = await import('vm');
    const output: string[] = [];

    const context = vm.createContext({
      console: {
        log: (...a: unknown[]) =>
          output.push(
            a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))).join(' '),
          ),
        error: (...a: unknown[]) =>
          output.push(
            '[stderr] ' +
              a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))).join(' '),
          ),
        warn: (...a: unknown[]) =>
          output.push(
            '[warn] ' +
              a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))).join(' '),
          ),
        info: (...a: unknown[]) =>
          output.push(
            a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))).join(' '),
          ),
      },
      Math,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Error,
      Set,
      Map,
      RegExp,
      Promise,
      setTimeout: (fn: () => void, ms: number) => {
        if (ms > timeout) throw new Error('setTimeout delay exceeds execution timeout');
        return globalThis.setTimeout(fn, ms);
      },
      clearTimeout: globalThis.clearTimeout,
    });

    vm.runInContext(code, context, { timeout });

    const result = output.join('\n') || '(no output - use console.log() to print results)';
    return { output: result.slice(0, 50_000), error: null, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Execution error';
    return { output: '', error: msg, durationMs: Date.now() - start };
  }
}

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    py: 'python',
    txt: 'plaintext',
  };
  return map[ext] || 'plaintext';
}

function normalizeProjectPath(filePath: string): string {
  const normalized = filePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim();

  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe project path: ${filePath}`);
  }

  return normalized;
}

export function detectExecutionRuntime(filePath: string): ExecutionRuntime {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'js':
    case 'cjs':
    case 'mjs':
      return {
        runtime: 'node',
        label: 'Node.js',
        command: 'node',
      };
    case 'py':
      return {
        runtime: 'python',
        label: 'Python',
        command: 'python',
      };
    case 'html':
    case 'css':
      return {
        runtime: 'preview-only',
        label: 'Preview',
        reason: 'HTML and CSS files are previewed in the IDE. Use the Preview panel instead of Run.',
      };
    case 'ts':
    case 'tsx':
    case 'jsx':
      return {
        runtime: 'unsupported',
        label: 'Unsupported',
        reason: 'TypeScript and JSX execution is not configured in the IDE yet. Use preview for frontend files or transpile to runnable JavaScript first.',
      };
    case 'json':
    case 'md':
    case 'txt':
      return {
        runtime: 'unsupported',
        label: 'Unsupported',
        reason: 'This file type is not executable.',
      };
    default:
      return {
        runtime: 'unsupported',
        label: 'Unsupported',
        reason: `No execution runtime is configured for .${ext || 'unknown'} files.`,
      };
  }
}

export async function materializeProjectWorkspace(
  projectName: string,
  files: ProjectExecutionFile[],
): Promise<ProjectWorkspace> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'nova-ide-'));
  const projectSlug = projectName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const workspaceDir = path.join(baseDir, projectSlug);
  await mkdir(workspaceDir, { recursive: true });

  try {
    for (const file of files) {
      const normalizedPath = normalizeProjectPath(file.path);
      const absolutePath = path.join(workspaceDir, normalizedPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content ?? '', 'utf8');
    }
  } catch (error) {
    await rm(baseDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    workspaceDir,
    cleanup: async () => {
      await rm(baseDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export function resolveWorkspaceEntryPath(workspaceDir: string, filePath: string): string {
  return path.join(workspaceDir, normalizeProjectPath(filePath));
}

export function spawnProjectProcess(
  runtime: ExecutionRuntime,
  workspaceDir: string,
  entryAbsolutePath: string,
): ChildProcessWithoutNullStreams {
  if (!runtime.command) {
    throw new Error(runtime.reason || 'No execution command is available for this file.');
  }

  const args = runtime.command === 'python'
    ? ['-u', entryAbsolutePath]
    : [entryAbsolutePath];

  return spawn(runtime.command, args, {
    cwd: workspaceDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      NODE_NO_WARNINGS: '1',
    },
    shell: false,
    windowsHide: true,
  });
}

export function spawnProjectShellCommand({
  command,
  workspaceDir,
}: ShellCommandProcessOptions): ChildProcessWithoutNullStreams {
  const trimmed = String(command || '').trim();
  if (!trimmed) {
    throw new Error('Command is required.');
  }

  const shell = resolveShellForCommandExecution();

  return spawn(trimmed, {
    cwd: workspaceDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      NODE_NO_WARNINGS: '1',
    },
    shell,
    windowsHide: true,
  });
}
