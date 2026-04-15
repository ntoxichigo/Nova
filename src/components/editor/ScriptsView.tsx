'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Plus,
  Trash2,
  Download,
  FolderPlus,
  FilePlus,
  FileCode,
  Folder,
  ChevronRight,
  ChevronDown,
  Square,
  Loader2,
  RotateCcw,
  Eye,
  Code2,
  X,
  TerminalSquare,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  useAppStore,
  type ScriptProject,
  type ScriptFileInfo,
  type ScriptFolderInfo,
  type ScriptCommandInfo,
  type ScriptExecutionInfo,
  type ScriptIDEMessage,
} from '@/store/app-store';
import { applyResponsiveHtmlGuard } from '@/lib/html-preview';
import { IDEAssistantPanel } from '@/components/editor/IDEAssistantPanel';
import { useShallow } from 'zustand/react/shallow';

/* ─── helpers ─────────────────────────────────────────────────── */

function langIcon(lang: string) {
  const map: Record<string, string> = { javascript: 'JS', typescript: 'TS', html: 'HTML', css: 'CSS', json: '{}', markdown: 'MD', python: 'PY' };
  return map[lang] || '?';
}

function extensionColor(lang: string) {
  const map: Record<string, string> = {
    javascript: 'text-yellow-400',
    typescript: 'text-blue-400',
    html: 'text-orange-400',
    css: 'text-cyan-400',
    json: 'text-green-400',
    markdown: 'text-gray-400',
    python: 'text-emerald-400',
  };
  return map[lang] || 'text-muted-foreground';
}

interface FolderNode {
  name: string;
  path: string;
  folderId?: string | null;
  children: Record<string, FolderNode>;
  files: ScriptFileInfo[];
}

function ensureFolderNode(root: FolderNode, folderPath: string, folderId?: string | null): FolderNode {
  const parts = folderPath.split('/').filter(Boolean);
  let node = root;
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!node.children[part]) {
      node.children[part] = {
        name: part,
        path: currentPath,
        folderId: null,
        children: {},
        files: [],
      };
    }
    node = node.children[part];
  }

  if (folderId) {
    node.folderId = folderId;
  }

  return node;
}

function buildTree(files: ScriptFileInfo[], folders: ScriptFolderInfo[] = []): FolderNode {
  const root: FolderNode = { name: '', path: '', folderId: null, children: {}, files: [] };

  for (const folder of folders) {
    ensureFolderNode(root, folder.path, folder.id);
  }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    const folderPath = parts.slice(0, -1).join('/');
    const node = folderPath ? ensureFolderNode(root, folderPath) : root;
    node.files.push(file);
  }

  return root;
}

interface ScriptProjectWithFiles extends ScriptProject {
  files: ScriptFileInfo[];
  folders?: ScriptFolderInfo[];
  executions?: ScriptExecutionInfo[];
  commands?: ScriptCommandInfo[];
  messages?: ScriptIDEMessage[];
}

function hasPreviewableFiles(files: ScriptFileInfo[]) {
  return files.some((file) =>
    file.language === 'html' || file.path.endsWith('.html') ||
    file.path.endsWith('.jsx') || file.path.endsWith('.tsx') ||
    (file.language === 'javascript' && (file.content || '').includes('React'))
  );
}

function formatExecutionDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── main component ──────────────────────────────────────────── */

export function ScriptsView() {
  const {
    projects, setProjects,
    activeProjectId, setActiveProjectId,
    activeFileId, setActiveFileId,
    editorCode, setEditorCode,
    isExecuting, setIsExecuting,
    executionOutput, appendExecutionOutput, clearExecutionOutput,
    projectRefreshKey,
  } = useAppStore(useShallow((state) => ({
    projects: state.projects,
    setProjects: state.setProjects,
    activeProjectId: state.activeProjectId,
    setActiveProjectId: state.setActiveProjectId,
    activeFileId: state.activeFileId,
    setActiveFileId: state.setActiveFileId,
    editorCode: state.editorCode,
    setEditorCode: state.setEditorCode,
    isExecuting: state.isExecuting,
    setIsExecuting: state.setIsExecuting,
    executionOutput: state.executionOutput,
    appendExecutionOutput: state.appendExecutionOutput,
    clearExecutionOutput: state.clearExecutionOutput,
    projectRefreshKey: state.projectRefreshKey,
  })));

  const [loading, setLoading] = useState(true);
  const [activeProject, setActiveProject] = useState<ScriptProjectWithFiles | null>(null);
  const [openFiles, setOpenFiles] = useState<ScriptFileInfo[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));
  const [createProjectPending, setCreateProjectPending] = useState(false);
  const [newProjectName, setNewProjectName] = useState('New Project');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectFolders, setNewProjectFolders] = useState('src\npublic');
  const [newProjectFiles, setNewProjectFiles] = useState('src/index.js\nREADME.md');
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('');
  const [projectSavePending, setProjectSavePending] = useState(false);
  const [filePathDraft, setFilePathDraft] = useState('');
  const [fileRenamePending, setFileRenamePending] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [executionMeta, setExecutionMeta] = useState<{
    status: 'idle' | 'running' | 'success' | 'error';
    runtime?: string;
    entryPath?: string;
    duration?: number;
    message?: string;
  }>({ status: 'idle' });
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null);
  const [showDesktopAssistant, setShowDesktopAssistant] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executionAbortRef = useRef<AbortController | null>(null);

  /* ─── Fetch projects ─── */
  const fetchProjects = useCallback(async (): Promise<ScriptProject[]> => {
    const res = await fetch('/api/scripts');
    if (!res.ok) {
      throw new Error('Failed to load projects');
    }

    return res.json();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      try {
        const data = await fetchProjects();
        if (!cancelled) {
          setProjects(data);
        }
      } catch {
        if (!cancelled) {
          setProjects([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void Promise.resolve().then(loadProjects);

    return () => {
      cancelled = true;
    };
  }, [fetchProjects, setProjects]);

  /* ─── Load full project when active changes ─── */
  const loadProject = useCallback(async (id: string): Promise<ScriptProjectWithFiles | null> => {
    try {
      const res = await fetch(`/api/scripts/${id}`);
      if (!res.ok) {
        return null;
      }

      return res.json();
    } catch {
      return null;
    }
  }, []);

  const refreshActiveProject = useCallback(async () => {
    if (!activeProjectId) {
      return null;
    }

    const full = await loadProject(activeProjectId);
    if (!full) {
      return null;
    }

    setActiveProject({
      ...full,
      files: full.files.map((file) =>
        file.id === activeFileId ? { ...file, content: editorCode } : file
      ),
    });
    setOpenFiles((prev) => {
      const openIds = new Set(prev.map((file) => file.id));
      return full.files
        .filter((file) => openIds.has(file.id))
        .map((file) => (file.id === activeFileId ? { ...file, content: editorCode } : file));
    });
    setShowPreview(hasPreviewableFiles(full.files));
    return full;
  }, [activeFileId, activeProjectId, editorCode, loadProject]);

  useEffect(() => {
    let cancelled = false;

    const syncActiveProject = async () => {
      if (!activeProjectId) {
        if (!cancelled) {
          setActiveProject(null);
          setOpenFiles([]);
          setActiveFileId(null);
          setEditorCode('');
          setShowPreview(false);
        }
        return;
      }

      const full = await loadProject(activeProjectId);
      if (!full || cancelled) {
        return;
      }

      const firstFile = full.files[0] ?? null;
      const folderPathsToExpand = new Set(['']);
      for (const folder of full.folders ?? []) {
        const segments = folder.path.split('/').filter(Boolean);
        let current = '';
        for (const segment of segments) {
          current = current ? `${current}/${segment}` : segment;
          folderPathsToExpand.add(current);
        }
      }
      setActiveProject(full);
      setExpandedFolders(folderPathsToExpand);
      setProjectNameDraft(full.name || '');
      setProjectDescriptionDraft(full.description || '');
      setOpenFiles(firstFile ? [firstFile] : []);
      setActiveFileId(firstFile?.id ?? null);
      setEditorCode(firstFile?.content || '');
      setShowPreview(hasPreviewableFiles(full.files));
      setShowNewFile(false);
      setNewFileName('');
      setShowNewFolder(false);
      setNewFolderName('');
      setCommandInput('');
      setExecutionMeta({ status: 'idle' });
      setSelectedExecutionId(null);
      setSelectedCommandId(null);
    };

    void Promise.resolve().then(syncActiveProject);

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, loadProject, setActiveFileId, setEditorCode]);

  useEffect(() => {
    if (!activeProjectId) return;
    void refreshActiveProject();
    void fetchProjects().then(setProjects).catch(() => {});
  }, [activeProjectId, projectRefreshKey, refreshActiveProject, fetchProjects, setProjects]);

  useEffect(() => {
    const activeFile = activeProject?.files.find((file) => file.id === activeFileId) ?? null;
    setFilePathDraft(activeFile?.path || '');
  }, [activeFileId, activeProject]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      executionAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = (event?: MediaQueryListEvent) => {
      setShowDesktopAssistant(event ? event.matches : query.matches);
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* ─── Auto-scroll output ─── */
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [executionOutput]);

  const parsePathList = (value: string) =>
    value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .filter((entry, index, list) => list.indexOf(entry) === index);

  /* ─── CRUD operations ─── */
  const createProject = async () => {
    if (createProjectPending) return;

    const folders = parsePathList(newProjectFolders);
    const filePaths = parsePathList(newProjectFiles);
    const files = (filePaths.length > 0 ? filePaths : ['index.js']).map((filePath) => ({
      path: filePath,
      content: filePath.endsWith('.md')
        ? `# ${newProjectName.trim() || 'New Project'}\n`
        : filePath.endsWith('.html')
          ? '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Nova Project</title>\n</head>\n<body>\n  <h1>Hello from Nova IDE</h1>\n</body>\n</html>\n'
          : filePath.endsWith('.py')
            ? 'def main():\n    print(\"Hello from Nova IDE\")\n\n\nif __name__ == \"__main__\":\n    main()\n'
            : '// Start building with Nova IDE\n',
    }));

    setCreateProjectPending(true);
    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName.trim() || 'New Project',
          description: newProjectDescription.trim(),
          folders,
          files,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to create project');
      }

      const proj = await res.json();
      const data = await fetchProjects();
      setProjects(data);
      setActiveProjectId(proj.id);
      setActiveFileId(null);
      clearExecutionOutput();
      setExecutionMeta({ status: 'idle' });
      setNewProjectName('New Project');
      setNewProjectDescription('');
      setNewProjectFolders('src\npublic');
      setNewProjectFiles('src/index.js\nREADME.md');
    } catch (error) {
      appendExecutionOutput(`[error] ${error instanceof Error ? error.message : 'Failed to create project'}\n`);
    } finally {
      setCreateProjectPending(false);
    }
  };

  const deleteProject = async (id: string) => {
    await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
    if (activeProjectId === id) {
      executionAbortRef.current?.abort();
      setIsExecuting(false);
      setActiveProjectId(null);
      setActiveFileId(null);
      setEditorCode('');
      clearExecutionOutput();
      setExecutionMeta({ status: 'idle' });
    }
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch {
      /* ignore */
    }
  };

  const createFile = async (path: string) => {
    if (!activeProjectId || !path.trim()) return;
    const res = await fetch(`/api/scripts/${activeProjectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.trim() }),
    });
    if (res.ok) {
      const file = await res.json();
      const full = await loadProject(activeProjectId);
      if (full) {
        setActiveProject(full);
        setShowPreview(hasPreviewableFiles(full.files));
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        const segments = path.trim().replace(/\\/g, '/').split('/').slice(0, -1);
        let current = '';
        for (const segment of segments) {
          current = current ? `${current}/${segment}` : segment;
          next.add(current);
        }
        return next;
      });
      setActiveFileId(file.id);
      setEditorCode(file.content || '');
      setOpenFiles((prev) => [...prev.filter((f) => f.id !== file.id), file]);
      setShowPreview(false);
    }
    setShowNewFile(false);
    setNewFileName('');
  };

  const createFolder = async (folderPath: string) => {
    if (!activeProjectId || !folderPath.trim()) return;
    try {
      const res = await fetch(`/api/scripts/${activeProjectId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath.trim() }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to create folder');
      }

      setExpandedFolders((prev) => {
        const next = new Set(prev);
        const segments = folderPath.trim().split('/').filter(Boolean);
        let current = '';
        for (const segment of segments) {
          current = current ? `${current}/${segment}` : segment;
          next.add(current);
        }
        return next;
      });
      setShowNewFolder(false);
      setNewFolderName('');
      await refreshActiveProject();
      setProjects(await fetchProjects());
    } catch (error) {
      appendExecutionOutput(`[error] ${error instanceof Error ? error.message : 'Could not create folder'}\n`);
    }
  };

  const deleteFolder = async (folderId: string) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/scripts/${activeProjectId}/folders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to delete folder');
      }

      await refreshActiveProject();
      setProjects(await fetchProjects());
    } catch (error) {
      appendExecutionOutput(`[error] ${error instanceof Error ? error.message : 'Could not delete folder'}\n`);
    }
  };

  const deleteFile = async (fileId: string) => {
    if (!activeProjectId) return;
    await fetch(`/api/scripts/${activeProjectId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    });
    setOpenFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (activeFileId === fileId) {
      setActiveFileId(null);
      setEditorCode('');
    }
    const full = await loadProject(activeProjectId);
    if (full) {
      const nextFile = full.files.find((file) => file.id !== fileId) ?? full.files[0] ?? null;
      setActiveProject(full);
      setShowPreview(hasPreviewableFiles(full.files));

      if (activeFileId === fileId && nextFile) {
        setActiveFileId(nextFile.id);
        setEditorCode(nextFile.content || '');
        setOpenFiles([nextFile, ...full.files.filter((file) => file.id !== nextFile.id && openFiles.some((openFile) => openFile.id === file.id))]);
      } else if (!nextFile) {
        setActiveFileId(null);
        setEditorCode('');
        setOpenFiles([]);
      }
    }
  };
  const saveProjectDetails = async () => {
    if (!activeProjectId || !activeProject || projectSavePending) return;

    const nextName = projectNameDraft.trim() || 'Untitled Project';
    const nextDescription = projectDescriptionDraft.trim();
    setProjectSavePending(true);

    try {
      const res = await fetch(`/api/scripts/${activeProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName, description: nextDescription }),
      });

      if (!res.ok) {
        throw new Error('Failed to save project details');
      }

      const updated = await res.json();
      setActiveProject((prev) => (prev ? { ...prev, ...updated } : prev));
      setProjectNameDraft(updated.name || nextName);
      setProjectDescriptionDraft(updated.description || nextDescription);
      setProjects(await fetchProjects());
    } catch (error) {
      appendExecutionOutput(`[error] ${error instanceof Error ? error.message : 'Could not save project details'}\n`);
    } finally {
      setProjectSavePending(false);
    }
  };

  const renameActiveFile = async () => {
    if (!activeProjectId || !activeFileId || !filePathDraft.trim() || fileRenamePending) return;

    setFileRenamePending(true);
    try {
      const res = await fetch(`/api/scripts/${activeProjectId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: activeFileId, path: filePathDraft.trim() }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to rename file');
      }

      const updated = await res.json();
      setOpenFiles((prev) => prev.map((file) => (file.id === updated.id ? { ...file, ...updated } : file)));
      await refreshActiveProject();
      setProjects(await fetchProjects());
      setFilePathDraft(updated.path);
    } catch (error) {
      appendExecutionOutput(`[error] ${error instanceof Error ? error.message : 'Could not rename file'}\n`);
    } finally {
      setFileRenamePending(false);
    }
  };

  /* ??? Save (debounced) ??? */
  const saveFile = useCallback(
    (code: string) => {
      if (!activeProjectId || !activeFileId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        await fetch(`/api/scripts/${activeProjectId}/files`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: activeFileId, content: code }),
        });
      }, 800);
    },
    [activeProjectId, activeFileId],
  );

  const stopExecution = () => {
    if (!isExecuting) return;
    executionAbortRef.current?.abort();
    appendExecutionOutput('\n[stopping] Attempting to stop execution...\n');
  };

  const showExecutionFromHistory = (execution: ScriptExecutionInfo) => {
    const filePath = activeProject?.files.find((file) => file.id === execution.fileId)?.path || 'Deleted file';
    const header = [
      `# ${filePath}`,
      `Status: ${execution.status}`,
      execution.duration ? `Duration: ${execution.duration}ms` : null,
      `Started: ${formatExecutionDate(execution.createdAt)}`,
      '',
    ].filter(Boolean).join('\n');

    const body = [
      execution.output?.trim() ? execution.output.trim() : null,
      execution.error?.trim() ? `\n[error]\n${execution.error.trim()}` : null,
    ].filter(Boolean).join('\n');

    clearExecutionOutput();
    appendExecutionOutput(`${header}${body ? `\n${body}` : '\n(no captured output)'}`);
    setExecutionMeta({
      status: execution.status === 'success' ? 'success' : 'error',
      entryPath: filePath,
      duration: execution.duration ?? undefined,
      message: execution.error || undefined,
    });
    setSelectedExecutionId(execution.id);
    setSelectedCommandId(null);
  };

  const showCommandFromHistory = (commandRun: ScriptCommandInfo) => {
    const header = [
      `$ ${commandRun.command}`,
      `Status: ${commandRun.status}`,
      commandRun.exitCode !== null && commandRun.exitCode !== undefined ? `Exit code: ${commandRun.exitCode}` : null,
      commandRun.duration ? `Duration: ${commandRun.duration}ms` : null,
      `Started: ${formatExecutionDate(commandRun.createdAt)}`,
      '',
    ].filter(Boolean).join('\n');

    const body = [
      commandRun.output?.trim() ? commandRun.output.trim() : null,
      commandRun.error?.trim() ? `\n[error]\n${commandRun.error.trim()}` : null,
    ].filter(Boolean).join('\n');

    clearExecutionOutput();
    appendExecutionOutput(`${header}${body ? `\n${body}` : '\n(no captured output)'}`);
    setExecutionMeta({
      status: commandRun.status === 'success' ? 'success' : 'error',
      entryPath: '$ terminal',
      duration: commandRun.duration ?? undefined,
      message: commandRun.error || `Last command: ${commandRun.command}`,
    });
    setSelectedCommandId(commandRun.id);
    setSelectedExecutionId(null);
  };

  /* ??? Execute ??? */
  const executeFile = async () => {
    if (!activeProjectId || !activeFileId || isExecuting) return;
    setIsExecuting(true);
    clearExecutionOutput();
    setSelectedExecutionId(null);
    setSelectedCommandId(null);
    setExecutionMeta({ status: 'running', message: 'Starting execution...' });
    const controller = new AbortController();
    executionAbortRef.current = controller;

    try {
      const res = await fetch(`/api/scripts/${activeProjectId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: activeFileId, code: editorCode }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Execution failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'exec_start') {
                setExecutionMeta({
                  status: 'running',
                  runtime: data.runtime,
                  entryPath: data.entryPath,
                  message: `Running ${data.entryPath} with ${data.runtime}`,
                });
                appendExecutionOutput(`[run] ${data.entryPath} (${data.runtime})\n\n`);
              } else if (data.type === 'output') {
                appendExecutionOutput(`${data.stream === 'stderr' ? '[stderr] ' : ''}${data.text}\n`);
              } else if (data.type === 'error') {
                setExecutionMeta((prev) => ({
                  ...prev,
                  status: 'error',
                  message: data.message,
                }));
                appendExecutionOutput(`[error] ${data.message}\n`);
              } else if (data.type === 'exec_done') {
                const status = data.status === 'success' ? 'success' : 'error';
                setExecutionMeta({
                  status,
                  runtime: data.runtime,
                  entryPath: data.entryPath,
                  duration: data.duration,
                  message:
                    status === 'success'
                      ? `Completed in ${data.duration}ms`
                      : data.killedByTimeout
                        ? `Timed out after ${data.duration}ms`
                        : 'Execution ended with errors',
                });
                setSelectedExecutionId(data.executionId || null);
                appendExecutionOutput(`\n[${status === 'success' ? 'done' : 'warning'}] ${status === 'success' ? 'Completed' : 'Finished with issues'} in ${data.duration}ms\n`);
              }
            } catch {
              /* ignore bad SSE line */
            }
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setExecutionMeta({
          status: 'error',
          message: 'Execution stopped by user.',
        });
        appendExecutionOutput('\n[stopped] Execution stopped by user.\n');
      } else {
        setExecutionMeta({
          status: 'error',
          message: err instanceof Error ? err.message : 'Execution failed',
        });
        appendExecutionOutput(`[error] ${err instanceof Error ? err.message : 'Execution failed'}\n`);
      }
    } finally {
      if (controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      executionAbortRef.current = null;
      setIsExecuting(false);
      await refreshActiveProject();
      try {
        setProjects(await fetchProjects());
      } catch {
        /* ignore */
      }
    }
  };

  const executeCommand = async () => {
    if (!activeProjectId || !commandInput.trim() || isExecuting) return;

    setIsExecuting(true);
    clearExecutionOutput();
    setSelectedExecutionId(null);
    setSelectedCommandId(null);
    setExecutionMeta({ status: 'running', entryPath: '$ terminal', message: `Running: ${commandInput.trim()}` });
    const controller = new AbortController();
    executionAbortRef.current = controller;

    try {
      const res = await fetch(`/api/scripts/${activeProjectId}/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: commandInput.trim() }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Command failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      appendExecutionOutput(`$ ${commandInput.trim()}\n\n`);

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'command_start') {
                setExecutionMeta({
                  status: 'running',
                  entryPath: '$ terminal',
                  message: `Running command in project workspace`,
                });
              } else if (data.type === 'output') {
                appendExecutionOutput(`${data.stream === 'stderr' ? '[stderr] ' : ''}${data.text}\n`);
              } else if (data.type === 'error') {
                setExecutionMeta({
                  status: 'error',
                  entryPath: '$ terminal',
                  message: data.message,
                });
                appendExecutionOutput(`[error] ${data.message}\n`);
              } else if (data.type === 'command_done') {
                const status = data.status === 'success' ? 'success' : 'error';
                setExecutionMeta({
                  status,
                  entryPath: '$ terminal',
                  duration: data.duration,
                  message:
                    status === 'success'
                      ? `Command completed in ${data.duration}ms`
                      : data.killedByTimeout
                        ? `Command timed out after ${data.duration}ms`
                        : 'Command finished with issues',
                });
                setSelectedCommandId(data.commandId || null);
                appendExecutionOutput(`\n[${status === 'success' ? 'done' : 'warning'}] ${status === 'success' ? 'Command completed' : 'Command finished with issues'} in ${data.duration}ms\n`);
              }
            } catch {
              /* ignore malformed event */
            }
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setExecutionMeta({ status: 'error', entryPath: '$ terminal', message: 'Command stopped by user.' });
        appendExecutionOutput('\n[stopped] Command stopped by user.\n');
      } else {
        setExecutionMeta({
          status: 'error',
          entryPath: '$ terminal',
          message: error instanceof Error ? error.message : 'Command failed',
        });
        appendExecutionOutput(`[error] ${error instanceof Error ? error.message : 'Command failed'}\n`);
      }
    } finally {
      executionAbortRef.current = null;
      setIsExecuting(false);
      await refreshActiveProject();
      try {
        setProjects(await fetchProjects());
      } catch {
        /* ignore */
      }
    }
  };


  /* ─── Download / Export ─── */
  const downloadProject = async () => {
    if (!activeProjectId || !activeProject) return;
    try {
      const res = await fetch(`/api/scripts/${activeProjectId}/download`);
      const data = await res.json();

      // Build a simple .zip using a Blob (no external lib needed)
      // We'll create a combined text manifest they can extract
      // Better approach: create individual file downloads or use JSZip if available
      const files = data.files as { path: string; content: string }[];

      // If single file, just download it directly
      if (files.length === 1) {
        const blob = new Blob([files[0].content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = files[0].path;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      // For multi-file: download as a JSON bundle (user can unpack)
      const bundle = JSON.stringify(data, null, 2);
      const blob = new Blob([bundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.projectName || 'project'}-bundle.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  /* ─── Switch to file ─── */
  const openFile = (file: ScriptFileInfo) => {
    // Save current first
    if (activeFileId && editorCode) saveFile(editorCode);

    setActiveFileId(file.id);
    const fullFile = activeProject?.files.find((f) => f.id === file.id);
    setEditorCode(fullFile?.content || '');
    setShowPreview(false);

    if (!openFiles.find((f) => f.id === file.id)) {
      setOpenFiles((prev) => [...prev, file]);
    }
  };

  const closeTab = (fileId: string) => {
    const newOpen = openFiles.filter((f) => f.id !== fileId);
    setOpenFiles(newOpen);
    if (activeFileId === fileId) {
      if (newOpen.length > 0) {
        openFile(newOpen[newOpen.length - 1]);
      } else {
        setActiveFileId(null);
        setEditorCode('');
      }
    }
  };

  /* ─── Handle code changes ─── */
  const handleCodeChange = (value: string) => {
    setEditorCode(value);
    if (activeFileId) {
      setActiveProject((prev) => (
        prev
          ? {
              ...prev,
              files: prev.files.map((file) => (file.id === activeFileId ? { ...file, content: value } : file)),
            }
          : prev
      ));
      setOpenFiles((prev) => prev.map((file) => (file.id === activeFileId ? { ...file, content: value } : file)));
    }
    saveFile(value);
  };

  /* ─────────────────────────────────────────────────────────────────
   * buildPreviewHTML — multi-mode preview builder
   *
   * Mode 1 (Vanilla): HTML + CSS files + plain JS files
   *   Injects all <style> and <script> tags into the HTML base.
   *
   * Mode 2 (React/JSX): any .jsx / .tsx file, or JS that contains
   *   React-specific syntax (import React / JSX angle brackets).
   *   Strategy:
   *     - Load React 18, ReactDOM 18, and Babel standalone from unpkg CDN.
   *     - Topologically sort JS/JSX/TSX files by their import statements.
   *     - For each file:  strip ES import/export statements, wrap in an
   *       IIFE that exposes the default export as window[ComponentName].
   *     - Inject all as <script type="text/babel"> so Babel transpiles JSX.
   *     - Append a mount script that calls ReactDOM.createRoot('#root').
   * ───────────────────────────────────────────────────────────────── */
  const buildPreviewHTML = useCallback((): string => {
    if (!activeProject?.files || activeProject.files.length === 0) {
      return applyResponsiveHtmlGuard('<p style=\"padding:16px;font-family:sans-serif\">No files</p>', 'Nova Preview');
    }

    const files = activeProject.files;
    const htmlFile = files.find((f) => f.language === 'html' || f.path.endsWith('.html'));
    const cssFiles = files.filter((f) => f.language === 'css' || f.path.endsWith('.css'));
    const jsxFiles = files.filter((f) =>
      f.path.endsWith('.jsx') || f.path.endsWith('.tsx') ||
      (f.language === 'javascript' && (f.content || '').includes('React')) ||
      (f.language === 'typescript' && (f.content || '').includes('React'))
    );
    const plainJsFiles = files.filter((f) =>
      (f.language === 'javascript' || f.path.endsWith('.js')) &&
      !jsxFiles.includes(f) &&
      !f.path.endsWith('.md')
    );

    const isReactProject = jsxFiles.length > 0;

    // ── shared helper: inject before tag ────────────────────────────
    const injectBefore = (html: string, tag: string, content: string) => {
      const idx = html.indexOf(tag);
      return idx !== -1
        ? html.slice(0, idx) + content + html.slice(idx)
        : html + content;
    };

    // ── CSS string ────────────────────────────────────────────────
    const cssContent = cssFiles.map((f) => f.content || '').join('\n');

    // ════════════════════════════════════════════════════════════════
    // MODE 2: React / JSX
    // ════════════════════════════════════════════════════════════════
    if (isReactProject) {
      // Build import-dependency map so we can sort leaves first
      const allJsLike = [...jsxFiles, ...plainJsFiles];

      // Map: file path (no leading ./) → file obj
      const pathMap: Record<string, typeof files[0]> = {};
      for (const f of allJsLike) {
        const key = f.path.replace(/^\.\//, '');
        pathMap[key] = f;
        // Also store without extension for bare import resolution
        const noExt = key.replace(/\.(jsx?|tsx?)$/, '');
        if (noExt !== key) pathMap[noExt] = f;
      }

      // Parse imports: return list of local deps for a file
      const getLocalDeps = (content: string): string[] => {
        const deps: string[] = [];
        const re = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          const dep = m[1];
          if (dep.startsWith('.')) {
            // Normalise: strip leading ./
            deps.push(dep.replace(/^\.\//, '').replace(/\.(jsx?|tsx?)$/, ''));
          }
        }
        return deps;
      };

      // Topological sort (Kahn's algorithm) → leaves first
      const visited = new Set<string>();
      const sorted: typeof files[0][] = [];
      const visit = (f: typeof files[0]) => {
        const key = f.path.replace(/^\.\//, '').replace(/\.(jsx?|tsx?)$/, '');
        if (visited.has(key)) return;
        visited.add(key);
        const deps = getLocalDeps(f.content || '');
        for (const d of deps) {
          const dep = pathMap[d];
          if (dep) visit(dep);
        }
        sorted.push(f);
      };
      for (const f of allJsLike) visit(f);

      // Guess the root component file (App.jsx / App.tsx / main.jsx / index.jsx)
      const rootFile = sorted.find((f) =>
        /^(App|main|index)\.(jsx?|tsx?)$/.test(f.path.split('/').pop() || '')
      ) ?? sorted[sorted.length - 1];

      const rootName = rootFile
        ? rootFile.path.split('/').pop()!.replace(/\.(jsx?|tsx?)$/, '')
        : 'App';

      // Transform each file:
      //  - strip all import/export statements
      //  - expose default export as window[Name]
      const transformFile = (f: typeof files[0]): string => {
        const name = f.path.split('/').pop()!.replace(/\.(jsx?|tsx?)$/, '');
        let code = f.content || '';

        // Replace: import Something from './something'  →  const Something = window['something']
        code = code.replace(
          /import\s+(\w+)\s+from\s+['"][./]+([^'"]+)['"]/g,
          (_m, imported: string, dep: string) => {
            const depName = dep.split('/').pop()!.replace(/\.(jsx?|tsx?)$/, '');
            return `const ${imported} = window['${depName}'];`;
          }
        );
        // Replace: import { A, B } from './something'  →  const { A, B } = window['something']
        code = code.replace(
          /import\s+\{([^}]+)\}\s+from\s+['"][./]+([^'"]+)['"]/g,
          (_m, imports: string, dep: string) => {
            const depName = dep.split('/').pop()!.replace(/\.(jsx?|tsx?)$/, '');
            return `const {${imports}} = window['${depName}'] || {};`;
          }
        );
        // Strip remaining bare imports (react, react-dom, etc. — loaded via CDN)
        code = code.replace(/^import\s+.*?from\s+['"][^.][^'"]*['"]\s*;?\s*$/gm, '');
        code = code.replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');

        // Expose default export
        code = code.replace(/^export\s+default\s+/m, `window['${name}'] = `);
        // Strip any remaining named exports (export function / export const)
        code = code.replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');
        code = code.replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '');

        return code;
      };

      // Mount script
      const mountScript = `
(function() {
  const Root = window['${rootName}'];
  if (!Root) { document.getElementById('root').innerHTML = '<p style="color:red">Could not find component: ${rootName}</p>'; return; }
  const container = document.getElementById('root');
  if (window.ReactDOM && window.ReactDOM.createRoot) {
    window.ReactDOM.createRoot(container).render(window.React.createElement(Root));
  } else if (window.ReactDOM) {
    window.ReactDOM.render(window.React.createElement(Root), container);
  }
})();
      `.trim();

      const cdnScripts = `
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
`.trim();

      const styleTag = cssContent ? `<style>\n${cssContent}\n</style>` : '';

      const componentScripts = sorted
        .map((f) => `<script type="text/babel">\n${transformFile(f)}\n</script>`)
        .join('\n');

      const mountScriptTag = `<script type="text/babel">\n${mountScript}\n</script>`;

      const base = htmlFile?.content || '';
      if (base) {
        // Inject into existing HTML
        let result = injectBefore(base, '</head>', styleTag + '\n' + cdnScripts);
        result = injectBefore(result, '</body>', '\n' + componentScripts + '\n' + mountScriptTag);
        // Ensure there's a #root div if not already present
        if (!result.includes('id="root"') && !result.includes("id='root'")) {
          result = injectBefore(result, '</body>', '<div id="root"></div>\n');
        }
        return applyResponsiveHtmlGuard(result, activeProject.name);
      }

      return applyResponsiveHtmlGuard(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeProject.name}</title>
  ${styleTag}
  ${cdnScripts}
</head>
<body>
  <div id="root"></div>
  ${componentScripts}
  ${mountScriptTag}
</body>
</html>`, activeProject.name);
    }

    // ════════════════════════════════════════════════════════════════
    // MODE 1: Vanilla HTML + CSS + JS
    // ════════════════════════════════════════════════════════════════

    // Single HTML file with no separate CSS/JS → return as-is
    const nonReadme = files.filter((f) => !f.path.endsWith('.md'));
    if (htmlFile && nonReadme.length === 1) {
      return applyResponsiveHtmlGuard(htmlFile.content || '', activeProject.name);
    }

    let baseHtml = htmlFile?.content || `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeProject.name}</title>
</head>
<body id="app"></body>
</html>`;

    if (cssContent) {
      baseHtml = injectBefore(baseHtml, '</head>', `<style>\n${cssContent}\n</style>`);
    }

    if (plainJsFiles.length > 0) {
      const jsContent = plainJsFiles.map((f) => f.content || '').join('\n\n/* --- next file --- */\n\n');
      baseHtml = injectBefore(baseHtml, '</body>', `<script>\n${jsContent}\n</script>`);
    }

    return applyResponsiveHtmlGuard(baseHtml, activeProject.name);
  }, [activeProject]);

  // Show preview for HTML projects AND React/JSX projects
  const hasPreviewableContent = activeProject ? hasPreviewableFiles(activeProject.files) : false;
  const hasHtmlFile = activeProject?.files?.some((f) => f.language === 'html' || f.path.endsWith('.html'));
  const previewHTML = buildPreviewHTML();
  const activeFile = activeProject?.files.find((file) => file.id === activeFileId) ?? null;
  const projectExecutions = activeProject?.executions ?? [];
  const projectCommands = activeProject?.commands ?? [];
  const projectMessages = activeProject?.messages ?? [];

  /* ─── Render tree recursively ─── */
  const renderTree = (node: FolderNode, prefix = '') => {
    const items: React.ReactNode[] = [];

    // Folders first
    for (const [name, child] of Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b))) {
      const fullPath = child.path || (prefix ? `${prefix}/${name}` : name);
      const isExpanded = expandedFolders.has(fullPath);
      items.push(
        <div key={`d-${fullPath}`} className="group flex items-center gap-1">
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60"
            onClick={() => {
              setExpandedFolders((prev) => {
                const next = new Set(prev);
                if (next.has(fullPath)) next.delete(fullPath); else next.add(fullPath);
                return next;
              });
            }}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Folder className="h-3.5 w-3.5 text-primary/60" />
            <span className="truncate">{name}</span>
          </button>
          {child.folderId ? (
            <button
              onClick={() => deleteFolder(child.folderId!)}
              className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-red-400 group-hover:flex"
              title="Delete folder"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>,
      );
      if (isExpanded) {
        items.push(
          <div key={`dc-${fullPath}`} className="ml-3">
            {renderTree(child, fullPath)}
          </div>,
        );
      }
    }

    // Files
    for (const file of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
      const fileName = file.path.split('/').pop() || file.path;
      items.push(
        <div key={file.id} className="group flex items-center">
          <button
            className={`flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-xs truncate transition-colors ${
              activeFileId === file.id
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            }`}
            onClick={() => openFile(file)}
          >
            <FileCode className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{fileName}</span>
            <span className={`ml-auto text-[10px] font-mono ${extensionColor(file.language)}`}>
              {langIcon(file.language)}
            </span>
          </button>
          <button
            onClick={() => deleteFile(file.id)}
            className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>,
      );
    }

    return <>{items}</>;
  };

  /* ??? RENDER ????????????????????????????????????????? */

  // No project selected -> project list
  if (!activeProjectId) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
            <div className="mb-6">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                <Bot className="h-3.5 w-3.5" />
                IDE Mode
              </div>
              <h1 className="text-2xl font-bold">Project Workspace</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                This is separate from normal chat. Build a real project, create folders up front, then use the IDE assistant to plan, edit, and execute inside the workspace.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Project name</label>
                <Input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Machine Learning Lab" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Input value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} placeholder="What this workspace is for" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Starter folders</label>
                <Textarea
                  value={newProjectFolders}
                  onChange={(event) => setNewProjectFolders(event.target.value)}
                  className="min-h-[150px] resize-none text-xs font-mono"
                  placeholder={'src\npublic\nstyles'}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Starter files</label>
                <Textarea
                  value={newProjectFiles}
                  onChange={(event) => setNewProjectFiles(event.target.value)}
                  className="min-h-[150px] resize-none text-xs font-mono"
                  placeholder={'src/index.js\nREADME.md'}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                Use one path per line. Empty folders are preserved in the workspace.
              </div>
              <Button onClick={createProject} className="gap-2" disabled={createProjectPending}>
                {createProjectPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                {createProjectPending ? 'Creating project...' : 'Create IDE Project'}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/40 p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Recent Workspaces</h2>
                <p className="text-sm text-muted-foreground">Jump back into any project and continue with the IDE assistant.</p>
              </div>
              <div className="rounded-full border border-border/40 px-2.5 py-1 text-xs text-muted-foreground">
                {projects.length} project{projects.length === 1 ? '' : 's'}
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-12 text-center">
                <Code2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">No projects yet</p>
                <p className="mt-2 text-xs text-muted-foreground/70">Create the first IDE workspace on the left to get started.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group flex cursor-pointer items-center justify-between rounded-xl border border-border/40 bg-card/60 p-4 transition-colors hover:bg-card/80"
                    onClick={() => {
                      executionAbortRef.current?.abort();
                      setIsExecuting(false);
                      setActiveProjectId(project.id);
                      setActiveFileId(null);
                      clearExecutionOutput();
                      setExecutionMeta({ status: 'idle' });
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Folder className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">{project.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {project.files?.length || 0} file{(project.files?.length || 0) !== 1 ? 's' : ''}
                          {project.folders?.length ? ` - ${project.folders.length} folder${project.folders.length === 1 ? '' : 's'}` : ''}
                        </p>
                        {project.executions?.[0] ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Last run:{' '}
                            <span className={project.executions[0].status === 'success' ? 'text-green-400' : 'text-red-400'}>
                              {project.executions[0].status}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-400"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteProject(project.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const tree = activeProject ? buildTree(activeProject.files, activeProject.folders ?? []) : null;
  const projectDirty = activeProject
    ? projectNameDraft.trim() !== activeProject.name || projectDescriptionDraft.trim() !== (activeProject.description || '')
    : false;
  const activeFileDirty = activeFile ? filePathDraft.trim() !== activeFile.path : false;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-card/60 px-3 py-1.5 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => {
            executionAbortRef.current?.abort();
            setIsExecuting(false);
            setActiveProjectId(null);
            setActiveFileId(null);
            clearExecutionOutput();
            setExecutionMeta({ status: 'idle' });
          }}
        >
          Back to Projects
        </Button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{activeProject?.name || 'Loading...'}</div>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              IDE
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {(activeProject?.files.length || 0)} files
            {activeProject?.folders?.length ? ` - ${activeProject.folders.length} folders` : ''}
            {executionMeta.entryPath ? ` - ${executionMeta.entryPath}` : ''}
          </div>
        </div>

        <div className="min-w-4 flex-1" />

        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setShowNewFile(true)}>
          <FilePlus className="h-3.5 w-3.5" />
          New File
        </Button>

        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setShowNewFolder(true)}>
          <FolderPlus className="h-3.5 w-3.5" />
          New Folder
        </Button>

        {hasPreviewableContent && (
          <Button
            variant={showPreview ? 'default' : 'ghost'}
            size="sm"
            className="gap-1 text-xs"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
        )}

        <Button size="sm" className="gap-1.5" disabled={!activeFileId || isExecuting} onClick={executeFile}>
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run
        </Button>

        {isExecuting && (
          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={stopExecution}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}

        <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={downloadProject}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>

      {showNewFile && (
        <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/40 px-3 py-2 shrink-0">
          <span className="text-xs text-muted-foreground">New file:</span>
          <Input
            autoFocus
            value={newFileName}
            onChange={(event) => setNewFileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') createFile(newFileName);
              if (event.key === 'Escape') {
                setShowNewFile(false);
                setNewFileName('');
              }
            }}
            placeholder="e.g. src/utils.js"
            className="h-8 flex-1 text-xs"
          />
          <Button size="sm" className="h-7 text-xs" onClick={() => createFile(newFileName)}>Create</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowNewFile(false); setNewFileName(''); }}>Cancel</Button>
        </div>
      )}

      {showNewFolder && (
        <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/30 px-3 py-2 shrink-0">
          <span className="text-xs text-muted-foreground">New folder:</span>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') createFolder(newFolderName);
              if (event.key === 'Escape') {
                setShowNewFolder(false);
                setNewFolderName('');
              }
            }}
            placeholder="e.g. src/components"
            className="h-8 flex-1 text-xs"
          />
          <Button size="sm" className="h-7 text-xs" onClick={() => createFolder(newFolderName)}>Create</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>Cancel</Button>
        </div>
      )}

      <div className="min-h-0 flex-1 p-2 sm:p-3">
        <div className="h-full overflow-hidden rounded-2xl border border-border/40 bg-card/20">
          <ResizablePanelGroup direction="horizontal" autoSaveId="nova-ide-shell-v1" className="h-full">
            <ResizablePanel defaultSize={18} minSize={12} maxSize={30}>
              <div className="scroll-container h-full border-r border-border/40 bg-card/30 p-3">
          <div className="mb-4 rounded-xl border border-border/40 bg-background/40 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Workspace</div>
            <div className="space-y-2">
              <Input
                value={projectNameDraft}
                onChange={(event) => setProjectNameDraft(event.target.value)}
                placeholder="Project name"
                className="h-8 text-sm"
              />
              <textarea
                value={projectDescriptionDraft}
                onChange={(event) => setProjectDescriptionDraft(event.target.value)}
                rows={3}
                placeholder="What this project is for"
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <Button size="sm" variant={projectDirty ? 'default' : 'outline'} className="w-full text-xs" disabled={!projectDirty || projectSavePending} onClick={saveProjectDetails}>
                {projectSavePending ? 'Saving...' : 'Save Project'}
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div className="rounded-md border border-border/30 bg-card/50 px-2 py-1.5">
                <div className="font-medium text-foreground">{activeProject?.files.length || 0}</div>
                <div>Files</div>
              </div>
              <div className="rounded-md border border-border/30 bg-card/50 px-2 py-1.5">
                <div className="font-medium text-foreground">{activeProject?.folders?.length || 0}</div>
                <div>Folders</div>
              </div>
              <div className="rounded-md border border-border/30 bg-card/50 px-2 py-1.5">
                <div className="font-medium text-foreground">{projectExecutions.length}</div>
                <div>Runs</div>
              </div>
              <div className="rounded-md border border-border/30 bg-card/50 px-2 py-1.5">
                <div className="font-medium text-foreground">{projectCommands.length}</div>
                <div>Commands</div>
              </div>
            </div>
          </div>

          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Workspace</div>
          {tree && renderTree(tree)}
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle className="bg-border/50" />

            <ResizablePanel defaultSize={showDesktopAssistant ? 57 : 82} minSize={36}>

        <div className="flex h-full min-w-0 flex-1 flex-col">
          {openFiles.length > 0 && (
            <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border/40 bg-card/40">
              {openFiles.map((file) => {
                const fileName = file.path.split('/').pop() || file.path;
                return (
                  <div
                    key={file.id}
                    className={`flex cursor-pointer items-center gap-1.5 border-r border-border/20 px-3 py-1.5 text-xs transition-colors ${
                      activeFileId === file.id
                        ? 'bg-background text-foreground'
                        : 'bg-card/20 text-muted-foreground hover:bg-card/40'
                    }`}
                    onClick={() => openFile(file)}
                  >
                    <span className={`font-mono text-[10px] ${extensionColor(file.language)}`}>{langIcon(file.language)}</span>
                    <span className="max-w-[120px] truncate">{fileName}</span>
                    <button
                      className="ml-1 rounded p-0.5 hover:bg-secondary/80"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(file.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-1 min-h-0">
            <div className={`flex min-w-0 flex-col ${showPreview ? 'w-[58%] min-w-[340px] resize-x overflow-auto' : 'flex-1'} border-r border-border/20`}>
              {activeFile ? (
                <>
                  <div className="border-b border-border/30 bg-card/30 px-3 py-2 shrink-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={filePathDraft}
                        onChange={(event) => setFilePathDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void renameActiveFile();
                          }
                          if (event.key === 'Escape') {
                            setFilePathDraft(activeFile.path);
                          }
                        }}
                        className="h-8 flex-1 min-w-[220px] text-xs font-mono"
                        placeholder="File path"
                      />
                      <Button size="sm" variant={activeFileDirty ? 'default' : 'outline'} className="h-8 text-xs" disabled={!activeFileDirty || fileRenamePending} onClick={renameActiveFile}>
                        {fileRenamePending ? 'Saving...' : 'Rename'}
                      </Button>
                      <span className={`rounded-md border border-border/30 px-2 py-1 text-[10px] font-mono ${extensionColor(activeFile.language)}`}>
                        {activeFile.language}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{activeFile.path}</span>
                      <span>Ctrl+S to save - Ctrl+Enter to run</span>
                    </div>
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={editorCode}
                    onChange={(event) => handleCodeChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Tab') {
                        event.preventDefault();
                        const startIndex = event.currentTarget.selectionStart;
                        const endIndex = event.currentTarget.selectionEnd;
                        const newValue = editorCode.slice(0, startIndex) + '  ' + editorCode.slice(endIndex);
                        handleCodeChange(newValue);
                        requestAnimationFrame(() => {
                          if (textareaRef.current) {
                            textareaRef.current.selectionStart = startIndex + 2;
                            textareaRef.current.selectionEnd = startIndex + 2;
                          }
                        });
                      }
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void executeFile();
                      }
                      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                        event.preventDefault();
                        saveFile(editorCode);
                      }
                    }}
                    spellCheck={false}
                    className="min-h-0 flex-1 resize-none bg-background/80 p-4 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40"
                    placeholder="// Start coding here..."
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-muted-foreground/40">
                  <div className="text-center">
                    <FileCode className="mx-auto mb-2 h-8 w-8" />
                    <p className="text-sm">Select a file to edit</p>
                  </div>
                </div>
              )}
            </div>

            {showPreview && hasPreviewableContent && (
              <div className="flex min-w-0 flex-1 flex-col border-l border-border/40">
                <div className="flex items-center gap-2 border-b border-border/40 bg-card/40 px-3 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live Preview</span>
                  {!hasHtmlFile && (
                    <span className="rounded bg-blue-500/20 px-1 py-0.5 text-[10px] font-mono text-blue-400">React</span>
                  )}
                </div>
                <iframe
                  srcDoc={previewHTML}
                  sandbox="allow-scripts"
                  className="min-w-0 flex-1 border-0 bg-white"
                  loading="lazy"
                  title="Preview"
                />
              </div>
            )}
          </div>

          <div className="h-[clamp(220px,32vh,520px)] shrink-0 resize-y overflow-hidden border-t border-border/40 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/20 bg-card/40 px-3 py-1.5 shrink-0">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Output</div>
                <div className="text-[11px] text-muted-foreground">
                  {executionMeta.message || 'Run the current file to see logs.'}
                  {executionMeta.duration ? ` - ${executionMeta.duration}ms` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isExecuting && (
                  <span className="flex items-center gap-1 text-[11px] text-yellow-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Running...
                  </span>
                )}
                {isExecuting && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={stopExecution}>
                    <Square className="h-3 w-3" />
                    Stop
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearExecutionOutput}>
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-border/20 bg-background/40 px-3 py-2">
              <TerminalSquare className="h-4 w-4 text-muted-foreground" />
              <Input
                value={commandInput}
                onChange={(event) => setCommandInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void executeCommand();
                  }
                }}
                className="h-8 flex-1 font-mono text-xs"
                placeholder="Run a workspace command, e.g. npm test or python main.py"
              />
              <Button size="sm" variant="outline" className="gap-1 text-xs" disabled={!commandInput.trim() || isExecuting} onClick={() => void executeCommand()}>
                <Play className="h-3.5 w-3.5" />
                Run Command
              </Button>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div
                ref={outputRef}
                className="scroll-container flex-1 bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
              >
                {executionOutput || (
                  <span className="text-muted-foreground/40">Click &quot;Run&quot; or press Ctrl+Enter to execute...</span>
                )}
              </div>

              <div className="w-[clamp(240px,26vw,520px)] shrink-0 resize-x overflow-auto border-l border-border/30 bg-card/20">
                <div className="grid h-full min-h-0 grid-rows-2">
                  <div className="min-h-0 border-b border-border/20">
                    <div className="border-b border-border/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recent Runs
                    </div>
                    <div className="scroll-container max-h-full p-2">
                      {projectExecutions.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-xs text-muted-foreground/60">
                          No runs yet.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {projectExecutions.map((execution) => {
                            const executionFile = activeProject?.files.find((file) => file.id === execution.fileId);
                            return (
                              <button
                                key={execution.id}
                                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                  selectedExecutionId === execution.id
                                    ? 'border-primary/50 bg-primary/10'
                                    : 'border-border/40 bg-background/40 hover:bg-background/70'
                                }`}
                                onClick={() => showExecutionFromHistory(execution)}
                              >
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="truncate font-medium text-foreground">{executionFile?.path || 'Deleted file'}</span>
                                  <span className={execution.status === 'success' ? 'text-green-400' : 'text-red-400'}>{execution.status}</span>
                                </div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  {formatExecutionDate(execution.createdAt)}
                                  {execution.duration ? ` - ${execution.duration}ms` : ''}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0">
                    <div className="border-b border-border/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recent Commands
                    </div>
                    <div className="scroll-container max-h-full p-2">
                      {projectCommands.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-xs text-muted-foreground/60">
                          No commands yet.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {projectCommands.map((commandRun) => (
                            <button
                              key={commandRun.id}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                selectedCommandId === commandRun.id
                                  ? 'border-primary/50 bg-primary/10'
                                  : 'border-border/40 bg-background/40 hover:bg-background/70'
                              }`}
                              onClick={() => showCommandFromHistory(commandRun)}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="truncate font-medium text-foreground">{commandRun.command}</span>
                                <span className={commandRun.status === 'success' ? 'text-green-400' : 'text-red-400'}>{commandRun.status}</span>
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {formatExecutionDate(commandRun.createdAt)}
                                {commandRun.duration ? ` - ${commandRun.duration}ms` : ''}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

            </ResizablePanel>

            {showDesktopAssistant ? (
              <>
                <ResizableHandle withHandle className="bg-border/50" />
                <ResizablePanel defaultSize={25} minSize={18} maxSize={36}>
                  <div className="h-full min-h-0">
                    <IDEAssistantPanel
                      projectId={activeProjectId}
                      projectName={activeProject?.name || 'Workspace'}
                      activeFileId={activeFileId}
                      messages={projectMessages}
                      onProjectRefresh={refreshActiveProject}
                    />
                  </div>
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </div>
      </div>

      <div className="h-[360px] border-t border-border/40 lg:hidden">
        <IDEAssistantPanel
          projectId={activeProjectId}
          projectName={activeProject?.name || 'Workspace'}
          activeFileId={activeFileId}
          messages={projectMessages}
          onProjectRefresh={refreshActiveProject}
        />
      </div>
    </div>
  );
}
