'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Send, Cpu, Wrench, Square, ShieldAlert, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageBubble, TypingIndicator, WelcomeScreen, LearningSuggestions } from './MessageBubble';
import { consumeJsonEventStream, sanitizeAssistantContent } from './stream-client';
import { useAppStore } from '@/store/app-store';
import type { AgentStep, Message } from '@/store/app-store';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

interface SlashCommand {
  command: string;
  insert: string;
  description: string;
  example: string;
}

interface ModelMeta {
  model: string;
  provider: string;
  taskMode?: string;
  autonomyProfile?: string;
  routeSummary?: string;
  chatPowerMode?: 'safe' | 'builder' | 'power';
  chatSpeedMode?: 'simple' | 'balanced' | 'deep';
  contextPackTokens?: number;
  contextWindow?: number;
  historyBudget?: number;
  promptTokenBudget?: number;
  memoryScope?: string;
  memoryUsed?: Array<{ type: string; content: string; source?: string }>;
}

interface LlmPreset {
  id: string;
  label: string;
  description: string;
}

interface PendingAction {
  toolName: string;
  arguments: Record<string, unknown>;
  conversationId: string;
  reviewId?: string | null;
  createdAt: number;
  expiresAt: number;
}

interface TimelineEvent {
  id: string;
  label: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/commands', insert: '/commands', description: 'Show available commands', example: '/commands' },
  { command: '/new', insert: '/new', description: 'Start a new chat', example: '/new' },
  { command: '/skills', insert: '/skills', description: 'Open skills panel', example: '/skills' },
  { command: '/teach', insert: '/teach', description: 'Open teach panel', example: '/teach' },
  { command: '/memory', insert: '/memory', description: 'Open memory dashboard', example: '/memory' },
  { command: '/project create', insert: '/project create ', description: 'Create IDE project', example: '/project create React Dashboard' },
  { command: '/search', insert: '/search ', description: 'Web search', example: '/search latest AI coding agents' },
  { command: '/wiki', insert: '/wiki ', description: 'Wikipedia lookup', example: '/wiki transformers' },
  { command: '/weather', insert: '/weather ', description: 'Weather lookup', example: '/weather London' },
  { command: '/time', insert: '/time ', description: 'Time lookup', example: '/time Tokyo' },
  { command: '/read', insert: '/read ', description: 'Read webpage URL', example: '/read https://example.com' },
];

function createTempMessage(role: 'user' | 'assistant', content: string): Message {
  const salt = Math.random().toString(36).slice(2, 9);
  return {
    id: `${role}-${Date.now()}-${salt}`,
    role,
    content,
    skillsUsed: [],
    createdAt: new Date().toISOString(),
  };
}

export function ChatView() {
  const {
    messages,
    activeConversationId,
    isLoading,
    learningSuggestions,
    addMessage,
    setActiveConversationId,
    setLoading,
    setLearningSuggestions,
    setAbortStream,
    setProjects,
    setActiveProjectId,
    bumpProjectRefreshKey,
  } = useAppStore(useShallow((state) => ({
    messages: state.messages,
    activeConversationId: state.activeConversationId,
    isLoading: state.isLoading,
    learningSuggestions: state.learningSuggestions,
    addMessage: state.addMessage,
    setActiveConversationId: state.setActiveConversationId,
    setLoading: state.setLoading,
    setLearningSuggestions: state.setLearningSuggestions,
    setAbortStream: state.setAbortStream,
    setProjects: state.setProjects,
    setActiveProjectId: state.setActiveProjectId,
    bumpProjectRefreshKey: state.bumpProjectRefreshKey,
  })));

  const [input, setInput] = useState('');
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [modelMeta, setModelMeta] = useState<ModelMeta | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [agentPlan, setAgentPlan] = useState<AgentStep[] | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [trustedToolsForSession, setTrustedToolsForSession] = useState<string[]>([]);
  const [chatPowerMode, setChatPowerMode] = useState<'safe' | 'builder' | 'power'>('builder');
  const [chatSpeedMode, setChatSpeedMode] = useState<'simple' | 'balanced' | 'deep'>('balanced');
  const [llmPresets, setLlmPresets] = useState<LlmPreset[]>([]);
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [taskObjective, setTaskObjective] = useState('');
  const [taskNotes, setTaskNotes] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingConversationTaskSeedRef = useRef(false);
  const taskObjectiveRef = useRef('');
  const taskNotesRef = useRef('');
  const streamStateRef = useRef<{ accumulated: string; suppressLiveCode: boolean }>({
    accumulated: '',
    suppressLiveCode: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const updateMessage = useCallback((id: string, updater: (message: Message) => Message) => {
    useAppStore.setState((state) => ({
      messages: state.messages.map((message) => (message.id === id ? updater(message) : message)),
    }));
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, statusLine, activeTool, agentPlan, scrollToBottom]);

  useEffect(() => {
    if (!isLoading) textareaRef.current?.focus();
  }, [isLoading]);

  useEffect(() => {
    const loadChatSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        if (!response.ok) return;
        const settings = await response.json();
        const mode = settings.chat_power_mode;
        if (mode === 'safe' || mode === 'builder' || mode === 'power') {
          setChatPowerMode(mode);
        }
        const speed = settings.chat_speed_mode;
        if (speed === 'simple' || speed === 'balanced' || speed === 'deep') {
          setChatSpeedMode(speed);
        }
      } catch {
        // ignore
      }
    };

    void loadChatSettings();
  }, []);

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const response = await fetch('/api/llm/presets');
        if (!response.ok) return;
        const payload = await response.json();
        const presets = Array.isArray(payload?.presets) ? payload.presets : [];
        setLlmPresets(presets.map((preset) => ({
          id: String(preset.id),
          label: String(preset.label),
          description: String(preset.description || ''),
        })));
      } catch {
        // ignore
      }
    };
    void loadPresets();
  }, []);

  useEffect(() => {
    taskObjectiveRef.current = taskObjective;
    taskNotesRef.current = taskNotes;
  }, [taskObjective, taskNotes]);

  useEffect(() => {
    if (!activeConversationId) {
      setTaskObjective('');
      setTaskNotes('');
      setTimelineEvents([]);
      return;
    }

    try {
      const novaKey = `nova-task-brief:${activeConversationId}`;
      const legacyKey = `ntox-task-brief:${activeConversationId}`;

      const raw = window.localStorage.getItem(novaKey) ?? window.localStorage.getItem(legacyKey);
      if (!raw) {
        if (pendingConversationTaskSeedRef.current) {
          window.localStorage.setItem(
            novaKey,
            JSON.stringify({ objective: taskObjectiveRef.current, notes: taskNotesRef.current }),
          );
          pendingConversationTaskSeedRef.current = false;
          return;
        }
        setTaskObjective('');
        setTaskNotes('');
        return;
      }
      const parsed = JSON.parse(raw) as { objective?: string; notes?: string };
      setTaskObjective(parsed.objective || '');
      setTaskNotes(parsed.notes || '');

      // Migrate forward if we loaded legacy storage.
      if (!window.localStorage.getItem(novaKey) && window.localStorage.getItem(legacyKey)) {
        window.localStorage.setItem(novaKey, raw);
      }
      pendingConversationTaskSeedRef.current = false;
    } catch {
      setTaskObjective('');
      setTaskNotes('');
    }
    setTimelineEvents([]);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) return;
    try {
      window.localStorage.setItem(
        `nova-task-brief:${activeConversationId}`,
        JSON.stringify({ objective: taskObjective, notes: taskNotes }),
      );
    } catch {
      // ignore persistence failures
    }
  }, [activeConversationId, taskObjective, taskNotes]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const expired: PendingAction[] = [];
      setPendingActions((current) => {
        if (current.length === 0) return current;
        const keep: PendingAction[] = [];
        for (const action of current) {
          if (action.expiresAt <= now) {
            expired.push(action);
          } else {
            keep.push(action);
          }
        }
        return keep;
      });

      if (expired.length > 0) {
        for (const action of expired) {
          if (!action.reviewId) continue;
          void fetch(`/api/audit/events/${action.reviewId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'reject' }),
          }).catch(() => {});
        }
        toast.info(`Approval request expired for ${expired[0].toolName}.`);
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
        (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        )
      );
      if (isEditable) return;

      event.preventDefault();
      setInput('/');
      setSlashFilter('/');
      setSlashOpen(true);
      textareaRef.current?.focus();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) return;
      const conversations = await response.json();
      useAppStore.getState().setConversations(conversations);
    } catch {
      // ignore
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/scripts');
      if (!response.ok) return;
      const projects = await response.json();
      setProjects(projects);
    } catch {
      // ignore
    }
  }, [setProjects]);

  const postLocalAssistantMessage = useCallback((userContent: string, assistantContent: string) => {
    addMessage(createTempMessage('user', userContent));
    addMessage(createTempMessage('assistant', assistantContent));
  }, [addMessage]);

  const pushTimeline = useCallback((label: string, tone: TimelineEvent['tone'] = 'info') => {
    setTimelineEvents((current) => {
      const next = [...current, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label,
        tone,
      }];
      return next.slice(-10);
    });
  }, []);

  const filteredCommands = useMemo(() => {
    const q = slashFilter.toLowerCase().trim();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((command) =>
      command.command.includes(q) ||
      command.description.toLowerCase().includes(q.replace('/', '')) ||
      command.example.toLowerCase().includes(q.replace('/', '')),
    );
  }, [slashFilter]);

  const applySlashCommand = useCallback((insert: string) => {
    setInput(insert);
    setSlashOpen(true);
    setSlashFilter(insert.toLowerCase());
    textareaRef.current?.focus();
  }, []);

  const getApprovedTools = useCallback(() => {
    return [...new Set(trustedToolsForSession)];
  }, [trustedToolsForSession]);

  const trustToolForSession = useCallback((toolName: string) => {
    if (!toolName) return;
    setTrustedToolsForSession((current) => (
      current.includes(toolName) ? current : [...current, toolName]
    ));
  }, []);

  const rejectReview = useCallback(async (reviewId?: string | null) => {
    if (!reviewId) return;
    try {
      await fetch(`/api/audit/events/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject' }),
      });
    } catch {
      // ignore reject logging failures
    }
  }, []);

  const openSettings = useCallback(() => {
    useAppStore.getState().setActiveView('settings');
  }, []);

  const openMissionControl = useCallback(() => {
    useAppStore.getState().setActiveView('dashboard');
  }, []);

  const showPolicyBlockedToast = useCallback((reason: string) => {
    toast.error(reason, {
      action: {
        label: 'Change policy',
        onClick: openMissionControl,
      },
    });
  }, [openMissionControl]);

  const showPolicyReviewToast = useCallback(() => {
    toast.info('Pending in Mission Control.', {
      action: {
        label: 'Open Mission Control',
        onClick: openMissionControl,
      },
    });
  }, [openMissionControl]);

  const showPowerModeBlockedToast = useCallback((reason: string) => {
    toast.error(reason, {
      action: {
        label: 'Open Settings',
        onClick: openSettings,
      },
    });
  }, [openSettings]);

  const updateChatPowerModeSetting = useCallback(async (nextMode: 'safe' | 'builder' | 'power') => {
    setChatPowerMode(nextMode);
    setModelMeta((current) => current ? { ...current, chatPowerMode: nextMode } : current);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_power_mode: nextMode }),
      });
      if (!response.ok) {
        throw new Error('Failed to save power mode');
      }
      toast.success(`Chat power mode set to ${nextMode}.`);
    } catch {
      toast.error('Could not update chat power mode.');
    }
  }, []);

  const updateChatSpeedModeSetting = useCallback(async (nextMode: 'simple' | 'balanced' | 'deep') => {
    setChatSpeedMode(nextMode);
    setModelMeta((current) => current ? { ...current, chatSpeedMode: nextMode } : current);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_speed_mode: nextMode }),
      });
      if (!response.ok) {
        throw new Error('Failed to save chat speed mode');
      }
      toast.success(`Chat speed set to ${nextMode}.`);
    } catch {
      toast.error('Could not update chat speed.');
    }
  }, []);

  const applyPreset = useCallback(async (presetId: string) => {
    if (!presetId) return;
    setApplyingPreset(presetId);
    try {
      const response = await fetch('/api/llm/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });
      if (!response.ok) throw new Error('Failed to apply model preset');
      toast.success('Model preset applied.');
      const settingsRes = await fetch('/api/settings');
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        const speed = settings.chat_speed_mode;
        if (speed === 'simple' || speed === 'balanced' || speed === 'deep') {
          setChatSpeedMode(speed);
        }
      }
    } catch {
      toast.error('Could not apply model preset.');
    } finally {
      setApplyingPreset(null);
    }
  }, []);

  const sendMessage = useCallback(async (explicitText?: string) => {
    const text = (explicitText ?? input).trim();
    if (!text || isLoading) return;

    const lower = text.toLowerCase();
    if (lower === '/commands') {
      const lines = SLASH_COMMANDS.map((command) => `- \`${command.command}\`: ${command.description}`).join('\n');
      postLocalAssistantMessage(text, `Available commands:\n${lines}`);
      setInput('');
      setSlashOpen(false);
      return;
    }
    if (lower === '/new') {
      useAppStore.getState().clearChat();
      setInput('');
      setSlashOpen(false);
      return;
    }
    if (lower === '/skills') {
      useAppStore.getState().setActiveView('skills');
      setInput('');
      setSlashOpen(false);
      return;
    }
    if (lower === '/teach') {
      useAppStore.getState().setActiveView('teach');
      setInput('');
      setSlashOpen(false);
      return;
    }
    if (lower === '/memory') {
      useAppStore.getState().setActiveView('dashboard');
      setInput('');
      setSlashOpen(false);
      return;
    }

    if (lower === '/project create' || lower === '/project create ') {
      toast.info('Usage: /project create <name>');
      return;
    }

    if (lower.startsWith('/project create ')) {
      const projectName = text.slice('/project create '.length).trim();
      if (!projectName) {
        toast.info('Usage: /project create <name>');
        return;
      }

      setInput('');
      setSlashOpen(false);

      const userCmd = text;
      setStatusLine('Creating IDE project...');
      setLoading(true);
      try {
        const response = await fetch('/api/scripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: projectName,
            description: `Scaffolded from chat command: ${projectName}`,
            folders: [{ path: 'src' }, { path: 'public' }, { path: 'styles' }, { path: 'tests' }],
            files: [
              {
                path: 'index.html',
                language: 'html',
                content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName}</title>
  <link rel="stylesheet" href="styles/style.css" />
</head>
<body>
  <main id="app">
    <h1>${projectName}</h1>
    <p>Project scaffold created by Nova.</p>
  </main>
  <script src="src/main.js"></script>
</body>
</html>`,
              },
              {
                path: 'styles/style.css',
                language: 'css',
                content: `:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", Tahoma, sans-serif;
  background: #f1f4ea;
  color: #1f2a21;
}
#app {
  max-width: 920px;
  margin: 48px auto;
  padding: 0 20px;
}`,
              },
              {
                path: 'src/main.js',
                language: 'javascript',
                content: `console.log("${projectName} ready");`,
              },
              {
                path: 'README.md',
                language: 'markdown',
                content: `# ${projectName}

Scaffolded from Nova chat command.

## Start

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Failed to create project');
          throw new Error(errorText);
        }

        const project = await response.json();
        await refreshProjects();
        setActiveProjectId(project.id);
        useAppStore.getState().setActiveView('scripts');

        const fileCount = Array.isArray(project.files) ? project.files.length : 0;
        const folderCount = Array.isArray(project.folders) ? project.folders.length : 0;
        postLocalAssistantMessage(
          userCmd,
          `Created IDE project **${project.name}** with ${fileCount} files and ${folderCount} folders. Opened in Scripts view.`,
        );
        toast.success(`Project "${project.name}" created`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Could not create project';
        postLocalAssistantMessage(userCmd, `Failed to create project: ${errorMessage}`);
        toast.error('Could not create project from slash command');
      } finally {
        setStatusLine(null);
        setLoading(false);
      }
      return;
    }

    if (lower.startsWith('/search ')) {
      const query = text.slice('/search '.length).trim();
      if (!query) {
        toast.info('Usage: /search <query>');
        return;
      }
      setInput('');
      setSlashOpen(false);
      await sendMessage(`Search the web for: ${query}`);
      return;
    }

    if (lower.startsWith('/wiki ')) {
      const query = text.slice('/wiki '.length).trim();
      if (!query) {
        toast.info('Usage: /wiki <topic>');
        return;
      }
      setInput('');
      setSlashOpen(false);
      await sendMessage(`Look up this topic on Wikipedia: ${query}`);
      return;
    }

    if (lower.startsWith('/weather ')) {
      const query = text.slice('/weather '.length).trim();
      if (!query) {
        toast.info('Usage: /weather <location>');
        return;
      }
      setInput('');
      setSlashOpen(false);
      await sendMessage(`What is the weather in ${query}?`);
      return;
    }

    if (lower.startsWith('/time ')) {
      const query = text.slice('/time '.length).trim();
      if (!query) {
        toast.info('Usage: /time <location>');
        return;
      }
      setInput('');
      setSlashOpen(false);
      await sendMessage(`What time is it in ${query}?`);
      return;
    }

    if (lower.startsWith('/read ')) {
      const url = text.slice('/read '.length).trim();
      if (!url) {
        toast.info('Usage: /read <url>');
        return;
      }
      setInput('');
      setSlashOpen(false);
      await sendMessage(`Read and summarize this webpage: ${url}`);
      return;
    }

    setInput('');
    setSlashOpen(false);
    if (!taskObjective && text.length > 12 && !text.startsWith('/')) {
      setTaskObjective(text.slice(0, 220));
    }
    setLoading(true);
    setStatusLine('Thinking...');
    setActiveTool(null);
    setAgentPlan(null);
    setTimelineEvents([
      {
        id: `${Date.now()}-start`,
        label: (taskObjective || text.length > 64) ? 'Starting task run' : `Starting: ${text.slice(0, 64)}`,
        tone: 'info',
      },
    ]);
    streamStateRef.current = { accumulated: '', suppressLiveCode: false };

    const userMessage = createTempMessage('user', text);
    const assistantMessage = createTempMessage('assistant', '');
    addMessage(userMessage);
    addMessage(assistantMessage);
    setStreamingAssistantId(assistantMessage.id);

    const controller = new AbortController();
    abortRef.current = controller;
    setAbortStream(() => controller.abort());
    pendingConversationTaskSeedRef.current = !activeConversationId;

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: activeConversationId,
          approvedTools: getApprovedTools(),
          runtimeHints: {
            chatSpeed: chatSpeedMode,
            taskBrief: [taskObjective.trim(), taskNotes.trim() ? `Notes: ${taskNotes.trim()}` : '']
              .filter(Boolean)
              .join('\n'),
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => 'Failed to send message');
        throw new Error(errorText || 'Failed to send message');
      }

      await consumeJsonEventStream(response.body, async (event) => {
        switch (event.type) {
          case 'meta': {
            const conversationId = typeof event.conversationId === 'string' ? event.conversationId : null;
            if (conversationId && !activeConversationId) {
              setActiveConversationId(conversationId);
            }
            setModelMeta({
              model: String(event.model || ''),
              provider: String(event.provider || ''),
              taskMode: event.taskMode ? String(event.taskMode) : undefined,
              autonomyProfile: event.autonomyProfile ? String(event.autonomyProfile) : undefined,
              routeSummary: event.routeSummary ? String(event.routeSummary) : undefined,
              chatSpeedMode:
                event.chatSpeedMode === 'simple' || event.chatSpeedMode === 'balanced' || event.chatSpeedMode === 'deep'
                  ? event.chatSpeedMode
                  : chatSpeedMode,
              chatPowerMode:
                event.chatPowerMode === 'safe' || event.chatPowerMode === 'builder' || event.chatPowerMode === 'power'
                  ? event.chatPowerMode
                  : undefined,
              contextPackTokens: Number.isFinite(Number(event.contextPackTokens)) ? Number(event.contextPackTokens) : undefined,
              contextWindow: Number.isFinite(Number(event.contextWindow)) ? Number(event.contextWindow) : undefined,
              historyBudget: Number.isFinite(Number(event.historyBudget)) ? Number(event.historyBudget) : undefined,
              promptTokenBudget: Number.isFinite(Number(event.promptTokenBudget)) ? Number(event.promptTokenBudget) : undefined,
              memoryScope: event.memoryScope ? String(event.memoryScope) : undefined,
              memoryUsed: Array.isArray(event.memoryUsed)
                ? event.memoryUsed
                  .filter((entry) => entry && typeof entry === 'object')
                  .map((entry) => ({
                    type: String((entry as Record<string, unknown>).type || 'memory'),
                    content: String((entry as Record<string, unknown>).content || ''),
                    source: (entry as Record<string, unknown>).source ? String((entry as Record<string, unknown>).source) : undefined,
                  }))
                  .slice(0, 8)
                : [],
            });
            if (event.chatPowerMode === 'safe' || event.chatPowerMode === 'builder' || event.chatPowerMode === 'power') {
              setChatPowerMode(event.chatPowerMode);
            }
            if (event.chatSpeedMode === 'simple' || event.chatSpeedMode === 'balanced' || event.chatSpeedMode === 'deep') {
              setChatSpeedMode(event.chatSpeedMode);
            }
            pushTimeline(
              `Using ${String(event.model || 'model')} via ${String(event.provider || 'provider')}${event.routeSummary ? ` - ${String(event.routeSummary)}` : ''}`,
              'info',
            );
            break;
          }
          case 'chunk': {
            const chunk = String(event.content || '');
            if (!chunk) break;
            streamStateRef.current.accumulated += chunk;
            const sanitized = sanitizeAssistantContent(streamStateRef.current.accumulated);
            if (!streamStateRef.current.suppressLiveCode && sanitized.includes('```') && sanitized.length > 220) {
              streamStateRef.current.suppressLiveCode = true;
              updateMessage(assistantMessage.id, (message) => ({ ...message, content: 'Generating response...' }));
              break;
            }
            if (!streamStateRef.current.suppressLiveCode) {
              updateMessage(assistantMessage.id, (message) => ({ ...message, content: sanitized }));
            }
            break;
          }
          case 'replace': {
            const replacement = String(event.content || '');
            streamStateRef.current.accumulated = replacement;
            const sanitized = sanitizeAssistantContent(replacement);
            if (streamStateRef.current.suppressLiveCode && sanitized.includes('```')) {
              updateMessage(assistantMessage.id, (message) => ({ ...message, content: 'Generating response...' }));
            } else {
              streamStateRef.current.suppressLiveCode = false;
              updateMessage(assistantMessage.id, (message) => ({ ...message, content: sanitized }));
            }
            break;
          }
          case 'tool_start': {
            const toolName = String(event.toolName || 'tool');
            setActiveTool(toolName);
            setStatusLine(`Running ${toolName}...`);
            pushTimeline(`Running tool: ${toolName}`, 'info');
            break;
          }
          case 'tool_done': {
            setActiveTool(null);
            setStatusLine('Finalizing response...');
            pushTimeline('Tool completed, preparing answer', 'success');
            break;
          }
          case 'tool_error': {
            const err = String(event.error || 'Tool failed');
            setActiveTool(null);
            setStatusLine('Tool failed');
            toast.error(err);
            pushTimeline(`Tool failed: ${err}`, 'error');
            break;
          }
          case 'agent_plan': {
            const steps = Array.isArray(event.steps) ? event.steps : [];
            setAgentPlan(steps.map((name, index) => ({
              id: index,
              name: String(name || `Step ${index + 1}`),
              done: false,
            })));
            setStatusLine('Planning execution...');
            pushTimeline(`Built ${steps.length} execution step${steps.length === 1 ? '' : 's'}`, 'info');
            break;
          }
          case 'agent_step_start': {
            const name = String(event.name || 'Step');
            setStatusLine(`Working on: ${name}`);
            pushTimeline(`Step started: ${name}`, 'info');
            break;
          }
          case 'agent_step_done': {
            const stepId = Number(event.stepId);
            const output = String(event.output || '');
            setAgentPlan((prev) => {
              if (!prev) return prev;
              return prev.map((step) => (step.id === stepId ? { ...step, done: true, output } : step));
            });
            pushTimeline(`Step completed: ${String(event.name || `Step ${stepId + 1}`)}`, 'success');
            break;
          }
          case 'verification': {
            const summary = String(event.summary || 'Verification complete');
            setStatusLine(`Verifier: ${summary}`);
            pushTimeline(`Verification: ${summary}`, 'success');
            break;
          }
          case 'pending_action': {
            const toolName = String(event.toolName || '');
            const args = event.arguments && typeof event.arguments === 'object'
              ? (event.arguments as Record<string, unknown>)
              : {};
            const convId = String(event.conversationId || activeConversationId || '');
            const reviewId = typeof event.reviewId === 'string' ? event.reviewId : null;
            const createdAt = event.createdAt ? Date.parse(String(event.createdAt)) : Date.now();
            const expiresAt = event.expiresAt ? Date.parse(String(event.expiresAt)) : (Date.now() + 5 * 60 * 1000);
            const next: PendingAction = {
              toolName,
              arguments: args,
              conversationId: convId,
              reviewId,
              createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
              expiresAt: Number.isFinite(expiresAt) ? expiresAt : (Date.now() + 5 * 60 * 1000),
            };
            setPendingActions((current) => {
              const duplicate = current.some((entry) =>
                entry.toolName === next.toolName &&
                entry.conversationId === next.conversationId &&
                JSON.stringify(entry.arguments) === JSON.stringify(next.arguments),
              );
              return duplicate ? current : [...current, next];
            });
            setStatusLine(null);
            setActiveTool(null);
            pushTimeline(`Approval required for ${toolName}`, 'warning');
            break;
          }
          case 'policy_blocked': {
            const reason = String(event.reason || 'Blocked by policy');
            showPolicyBlockedToast(reason);
            setStatusLine('Action blocked by policy');
            pushTimeline(`Blocked by policy: ${reason}`, 'error');
            break;
          }
          case 'policy_review_required': {
            showPolicyReviewToast();
            setStatusLine('Review required');
            pushTimeline('Mission Control review required', 'warning');
            break;
          }
          case 'power_mode_blocked': {
            const reason = String(event.reason || 'Blocked by chat power mode');
            showPowerModeBlockedToast(reason);
            setStatusLine('Blocked by chat power mode');
            pushTimeline(`Blocked by power mode: ${reason}`, 'warning');
            break;
          }
          case 'ide_open': {
            const projectId = String(event.projectId || '');
            if (projectId) {
              setActiveProjectId(projectId);
              bumpProjectRefreshKey();
              useAppStore.getState().setActiveView('scripts');
              void refreshProjects();
              toast.success('Project opened in IDE');
              pushTimeline('Project opened in IDE', 'success');
            }
            break;
          }
          case 'error_limit': {
            const message = String(event.message || 'Generation interrupted');
            setStatusLine('Generation interrupted');
            toast.error(message);
            pushTimeline(`Generation interrupted: ${message}`, 'error');
            break;
          }
          case 'done': {
            const toolsUsed = Array.isArray(event.toolsUsed) ? event.toolsUsed.map((tool) => String(tool)) : [];
            const learning = Array.isArray(event.learningSuggestions)
              ? event.learningSuggestions.map((item) => String(item))
              : [];
            const messageId = typeof event.messageId === 'string' ? event.messageId : undefined;
            const resolvedModel = typeof event.resolvedModel === 'string' ? event.resolvedModel.trim() : '';
            if (resolvedModel) {
              setModelMeta((current) => (
                current
                  ? { ...current, model: resolvedModel }
                  : { model: resolvedModel, provider: '' }
              ));
            }

            const finalContent = sanitizeAssistantContent(streamStateRef.current.accumulated || '');
            updateMessage(assistantMessage.id, (message) => ({
              ...message,
              content: finalContent || message.content || 'Done.',
              dbId: messageId,
              toolsUsed,
            }));
            if (toolsUsed.includes('create_script_project')) {
              bumpProjectRefreshKey();
            }
            setLearningSuggestions(learning);
            setStatusLine(null);
            setActiveTool(null);
            setAgentPlan(null);
            setLoading(false);
            setStreamingAssistantId(null);
            setAbortStream(null);
            abortRef.current = null;
            pushTimeline('Run completed', 'success');
            break;
          }
          default:
            break;
        }
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Generation stopped.'
        : error instanceof Error
          ? error.message
          : 'Failed to send message.';
      pushTimeline(message, controller.signal.aborted ? 'warning' : 'error');
      updateMessage(assistantMessage.id, (entry) => ({
        ...entry,
        content: message,
      }));
      if (!controller.signal.aborted) {
        toast.error('Failed to send message. Please try again.');
      }
    } finally {
      setLoading(false);
      setStreamingAssistantId(null);
      setStatusLine(null);
      setActiveTool(null);
      setAbortStream(null);
      abortRef.current = null;
      await refreshConversations();
    }
  }, [
    input,
    isLoading,
    postLocalAssistantMessage,
    setLoading,
    addMessage,
    setAbortStream,
    activeConversationId,
    setActiveConversationId,
    updateMessage,
    refreshConversations,
    setLearningSuggestions,
    setActiveProjectId,
    refreshProjects,
    getApprovedTools,
    chatSpeedMode,
    showPolicyBlockedToast,
    showPolicyReviewToast,
    showPowerModeBlockedToast,
  ]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const currentPendingAction = pendingActions.length > 0 ? pendingActions[0] : null;

  const sendResume = useCallback(async (action: PendingAction) => {
    if (isLoading) return;

    setLoading(true);
    setStatusLine(`Running ${action.toolName}...`);
    setActiveTool(action.toolName);
    setAgentPlan(null);
    setTimelineEvents((current) => [
      ...current.slice(-8),
      {
        id: `${Date.now()}-resume`,
        label: `Resuming approved action: ${action.toolName}`,
        tone: 'info',
      },
    ]);
    streamStateRef.current = { accumulated: '', suppressLiveCode: false };

    const assistantMessage = createTempMessage('assistant', '');
    addMessage(assistantMessage);
    setStreamingAssistantId(assistantMessage.id);

    const controller = new AbortController();
    abortRef.current = controller;
    setAbortStream(() => controller.abort());

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[resume:${action.toolName}]`,
          conversationId: action.conversationId,
          resumeToolCall: { name: action.toolName, arguments: action.arguments },
          approvedTools: [...new Set([...getApprovedTools(), action.toolName])],
          runtimeHints: {
            chatSpeed: chatSpeedMode,
            taskBrief: [taskObjective.trim(), taskNotes.trim() ? `Notes: ${taskNotes.trim()}` : '']
              .filter(Boolean)
              .join('\n'),
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to resume tool execution');
      }

      await consumeJsonEventStream(response.body, async (event) => {
        switch (event.type) {
          case 'chunk': {
            const chunk = String(event.content || '');
            if (!chunk) break;
            streamStateRef.current.accumulated += chunk;
            const sanitized = sanitizeAssistantContent(streamStateRef.current.accumulated);
            if (!streamStateRef.current.suppressLiveCode && sanitized.includes('```') && sanitized.length > 220) {
              streamStateRef.current.suppressLiveCode = true;
              updateMessage(assistantMessage.id, (m) => ({ ...m, content: 'Generating response...' }));
              break;
            }
            if (!streamStateRef.current.suppressLiveCode) {
              updateMessage(assistantMessage.id, (m) => ({ ...m, content: sanitized }));
            }
            break;
          }
          case 'replace': {
            const replacement = String(event.content || '');
            streamStateRef.current.accumulated = replacement;
            const sanitized = sanitizeAssistantContent(replacement);
            streamStateRef.current.suppressLiveCode = false;
            updateMessage(assistantMessage.id, (m) => ({ ...m, content: sanitized }));
            break;
          }
          case 'tool_start': {
            setActiveTool(String(event.toolName || 'tool'));
            setStatusLine(`Running ${String(event.toolName || 'tool')}...`);
            pushTimeline(`Running tool: ${String(event.toolName || 'tool')}`, 'info');
            break;
          }
          case 'tool_done': {
            setActiveTool(null);
            setStatusLine('Finalizing response...');
            pushTimeline('Tool completed, preparing answer', 'success');
            break;
          }
          case 'tool_error': {
            setActiveTool(null);
            setStatusLine('Tool failed');
            toast.error(String(event.error || 'Tool failed'));
            pushTimeline(`Tool failed: ${String(event.error || 'Tool failed')}`, 'error');
            break;
          }
          case 'policy_blocked': {
            const reason = String(event.reason || 'Blocked by policy');
            setActiveTool(null);
            setStatusLine('Action blocked by policy');
            showPolicyBlockedToast(reason);
            pushTimeline(`Blocked by policy: ${reason}`, 'error');
            break;
          }
          case 'policy_review_required': {
            setActiveTool(null);
            setStatusLine('Review required');
            showPolicyReviewToast();
            pushTimeline('Mission Control review required', 'warning');
            break;
          }
          case 'power_mode_blocked': {
            const reason = String(event.reason || 'Blocked by chat power mode');
            setActiveTool(null);
            setStatusLine('Blocked by chat power mode');
            showPowerModeBlockedToast(reason);
            pushTimeline(`Blocked by power mode: ${reason}`, 'warning');
            break;
          }
          case 'pending_action': {
            const toolName = String(event.toolName || '');
            const args = event.arguments && typeof event.arguments === 'object'
              ? (event.arguments as Record<string, unknown>)
              : {};
            const convId = String(event.conversationId || action.conversationId || '');
            const reviewId = typeof event.reviewId === 'string' ? event.reviewId : null;
            const createdAt = event.createdAt ? Date.parse(String(event.createdAt)) : Date.now();
            const expiresAt = event.expiresAt ? Date.parse(String(event.expiresAt)) : (Date.now() + 5 * 60 * 1000);
            const next: PendingAction = {
              toolName,
              arguments: args,
              conversationId: convId,
              reviewId,
              createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
              expiresAt: Number.isFinite(expiresAt) ? expiresAt : (Date.now() + 5 * 60 * 1000),
            };
            setPendingActions((current) => {
              const duplicate = current.some((entry) =>
                entry.toolName === next.toolName &&
                entry.conversationId === next.conversationId &&
                JSON.stringify(entry.arguments) === JSON.stringify(next.arguments),
              );
              return duplicate ? current : [...current, next];
            });
            setActiveTool(null);
            setStatusLine('Approval required');
            pushTimeline(`Approval required for ${toolName}`, 'warning');
            break;
          }
          case 'ide_open': {
            const projectId = String(event.projectId || '');
            if (projectId) {
              setActiveProjectId(projectId);
              bumpProjectRefreshKey();
              useAppStore.getState().setActiveView('scripts');
              void refreshProjects();
              toast.success('Project opened in IDE');
              pushTimeline('Project opened in IDE', 'success');
            }
            break;
          }
          case 'done': {
            const toolsUsed = Array.isArray(event.toolsUsed) ? event.toolsUsed.map((t) => String(t)) : [];
            const messageId = typeof event.messageId === 'string' ? event.messageId : undefined;
            const resolvedModel = typeof event.resolvedModel === 'string' ? event.resolvedModel.trim() : '';
            if (resolvedModel) {
              setModelMeta((current) => (
                current
                  ? { ...current, model: resolvedModel }
                  : { model: resolvedModel, provider: '' }
              ));
            }
            const finalContent = sanitizeAssistantContent(streamStateRef.current.accumulated || '');
            updateMessage(assistantMessage.id, (m) => ({
              ...m,
              content: finalContent || m.content || 'Done.',
              dbId: messageId,
              toolsUsed,
            }));
            if (toolsUsed.includes('create_script_project')) {
              bumpProjectRefreshKey();
            }
            setStatusLine(null);
            setActiveTool(null);
            setLoading(false);
            setStreamingAssistantId(null);
            setAbortStream(null);
            abortRef.current = null;
            pushTimeline('Approved action completed', 'success');
            break;
          }
          case 'error_limit': {
            setStatusLine('Generation interrupted');
            toast.error(String(event.message || 'Generation interrupted'));
            pushTimeline(`Generation interrupted: ${String(event.message || 'Generation interrupted')}`, 'error');
            break;
          }
          default:
            break;
        }
      });
    } catch (error) {
      const msg = controller.signal.aborted
        ? 'Execution stopped.'
        : error instanceof Error ? error.message : 'Failed to execute tool.';
      pushTimeline(msg, controller.signal.aborted ? 'warning' : 'error');
      updateMessage(assistantMessage.id, (m) => ({ ...m, content: msg }));
      if (!controller.signal.aborted) toast.error('Tool execution failed.');
    } finally {
      setLoading(false);
      setStreamingAssistantId(null);
      setStatusLine(null);
      setActiveTool(null);
      setAbortStream(null);
      abortRef.current = null;
      await refreshConversations();
    }
  }, [
    isLoading,
    addMessage,
    setLoading,
    setAbortStream,
    updateMessage,
    refreshConversations,
    setActiveProjectId,
    refreshProjects,
    getApprovedTools,
    chatSpeedMode,
    showPolicyBlockedToast,
    showPolicyReviewToast,
    showPowerModeBlockedToast,
  ]);

  const handleApprove = useCallback((rememberForSession = false) => {
    if (!currentPendingAction || isLoading) return;
    const action = { ...currentPendingAction };
    if (rememberForSession) {
      trustToolForSession(action.toolName);
    }
    setPendingActions((current) => current.slice(1));
    void sendResume(action);
  }, [currentPendingAction, isLoading, sendResume, trustToolForSession]);

  const handleDeny = useCallback(() => {
    if (!currentPendingAction) return;
    const action = { ...currentPendingAction };
    setPendingActions((current) => current.slice(1));
    setStatusLine(null);
    setLoading(false);
    void rejectReview(action.reviewId);
    toast.info(`Denied: ${action.toolName} was not executed.`);
  }, [currentPendingAction, rejectReview, setLoading]);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInput(value);
    if (value.startsWith('/')) {
      setSlashFilter(value.toLowerCase());
      setSlashOpen(true);
    } else {
      setSlashOpen(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
      return;
    }
    if (event.key === 'Escape') {
      setSlashOpen(false);
    }
  };

  const handleSuggestionClick = (text: string) => {
    void sendMessage(text);
  };

  const handleTeach = () => {
    useAppStore.getState().setActiveView('teach');
    toast.info('Navigate to Teach to add knowledge and skills.');
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#f1f4ea]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-black/10 bg-[#f1f4ea] px-3 py-2.5 sm:px-4">
          <div className="mx-auto flex w-full max-w-[52rem] flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-primary/70" />
              <span className="truncate font-medium text-slate-700">
                {modelMeta?.model || 'model not selected'}
              </span>
              {modelMeta?.provider ? <span className="hidden sm:inline">| {modelMeta.provider}</span> : null}
              <span className="hidden lg:inline">- {modelMeta?.routeSummary || 'Smart routing active'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Select value={chatPowerMode} onValueChange={(value) => void updateChatPowerModeSetting(value as 'safe' | 'builder' | 'power')}>
                <SelectTrigger className="h-8 w-[102px] border-black/10 bg-black/[0.02] text-[11px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe">Safe</SelectItem>
                  <SelectItem value="builder">Builder</SelectItem>
                  <SelectItem value="power">Power</SelectItem>
                </SelectContent>
              </Select>
              <Select value={chatSpeedMode} onValueChange={(value) => void updateChatSpeedModeSetting(value as 'simple' | 'balanced' | 'deep')}>
                <SelectTrigger className="h-8 w-[108px] border-black/10 bg-black/[0.02] text-[11px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="deep">Deep</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDetails((current) => !current)}
                className="h-8 border-black/10 bg-black/[0.02] px-3 text-[11px] shadow-none hover:bg-black/[0.04]"
              >
                {showDetails ? 'Hide controls' : 'Controls'}
              </Button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {showDetails ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mx-auto mt-2 grid w-full max-w-[52rem] gap-2 md:grid-cols-[1.2fr_1fr]">
                  <div className="space-y-2 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Task Brief</p>
                    <input
                      value={taskObjective}
                      onChange={(event) => setTaskObjective(event.target.value)}
                      placeholder="Pinned objective for this conversation"
                      className="h-9 w-full rounded-xl border border-black/10 bg-black/[0.03] px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                    />
                    <Textarea
                      value={taskNotes}
                      onChange={(event) => setTaskNotes(event.target.value)}
                      placeholder="Notes, constraints, quality bar"
                      rows={2}
                      className="resize-none border-black/10 bg-black/[0.03] text-xs shadow-none"
                    />
                    <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                      <span>History {modelMeta?.historyBudget || '-'}</span>
                      <span>Prompt budget {modelMeta?.promptTokenBudget || '-'}</span>
                      {modelMeta?.contextWindow ? (
                        <span>Context {modelMeta.contextPackTokens || 0}/{modelMeta.contextWindow}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Execution Timeline</p>
                    <div className="max-h-28 space-y-1 overflow-y-auto text-xs">
                      {timelineEvents.length === 0 ? (
                        <p className="text-muted-foreground">No execution steps yet.</p>
                      ) : (
                        timelineEvents.map((event) => (
                          <div key={event.id} className="rounded-md bg-secondary/40 px-2 py-1 text-foreground/80">
                            {event.label}
                          </div>
                        ))
                      )}
                    </div>

                    <Select onValueChange={(value) => void applyPreset(value)} disabled={Boolean(applyingPreset)}>
                      <SelectTrigger className="h-8 w-full border-black/10 bg-black/[0.03] text-[11px] shadow-none">
                        <SelectValue placeholder={applyingPreset ? 'Applying...' : 'Model preset'} />
                      </SelectTrigger>
                      <SelectContent>
                        {llmPresets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mx-auto mt-2 w-full max-w-[52rem] rounded-2xl border border-black/10 bg-black/[0.03] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Memory Used This Turn</p>
                    <span className="text-[10px] text-muted-foreground">{modelMeta?.memoryScope || 'conversation scope'}</span>
                  </div>
                  {modelMeta?.memoryUsed && modelMeta.memoryUsed.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {modelMeta.memoryUsed.map((entry, index) => (
                        <div key={`${entry.type}-${index}`} className="rounded-md bg-secondary/40 px-2 py-1">
                          <span className="mr-1 text-[10px] uppercase text-muted-foreground">{entry.type}</span>
                          <span className="text-foreground/85">{entry.content}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-muted-foreground">No long-term memory used in this turn.</p>
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-container">
          <div ref={scrollRef} className="mx-auto h-full max-w-[52rem] px-2 sm:px-4">
            {messages.length === 0 ? (
              <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
            ) : (
              <div className="py-5 sm:py-6">
                <AnimatePresence mode="popLayout">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isStreaming={Boolean(isLoading && streamingAssistantId === message.id)}
                    />
                  ))}
                </AnimatePresence>
                <TypingIndicator visible={Boolean(isLoading && !streamingAssistantId)} />
                <AnimatePresence>
                  <LearningSuggestions suggestions={learningSuggestions} onTeach={handleTeach} />
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {(isLoading || statusLine || activeTool || (agentPlan && agentPlan.length > 0)) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="shrink-0 border-t border-black/10 bg-black/[0.015] px-3 py-2.5 sm:px-4"
            >
              <div className="mx-auto max-w-[52rem] text-xs text-muted-foreground">
                {statusLine ? (
                  <div className="flex items-center gap-1.5">
                    {activeTool ? <Wrench className="h-3.5 w-3.5 text-primary" /> : <Cpu className="h-3.5 w-3.5 text-primary" />}
                    <span>{statusLine}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5 text-primary" />
                    <span>Working...</span>
                  </div>
                )}
                {agentPlan && agentPlan.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {agentPlan.map((step) => (
                      <span key={`${step.id}-${step.name}`} className={step.done ? 'text-muted-foreground/60' : 'text-foreground/80'}>
                        {step.done ? '[x]' : '[ ]'} {step.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {currentPendingAction && !isLoading ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="shrink-0 border-t border-black/10 bg-amber-500/[0.06] px-3 py-3 sm:px-4"
            >
              <div className="mx-auto max-w-[52rem]">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">
                      Approval required -{' '}
                      <code className="rounded bg-secondary/60 px-1 font-mono text-foreground">
                        {currentPendingAction.toolName}
                      </code>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {pendingActions.length > 1
                        ? `${pendingActions.length} actions are waiting in queue.`
                        : 'This action needs your confirmation.'}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Expires in {Math.max(0, Math.ceil((currentPendingAction.expiresAt - Date.now()) / 1000))}s
                    </p>
                    {Object.keys(currentPendingAction.arguments).length > 0 && (
                      <pre className="mt-1.5 max-h-28 overflow-auto rounded border border-border/30 bg-secondary/60 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {JSON.stringify(currentPendingAction.arguments, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDeny}
                      className="h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
                    >
                      <X className="h-3 w-3" />
                      Deny
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApprove(false)}
                      className="h-7 gap-1.5 text-xs font-semibold"
                    >
                      <Check className="h-3 w-3" />
                      Approve Once
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApprove(true)}
                      className="h-7 gap-1.5 text-xs font-semibold"
                    >
                      <Check className="h-3 w-3" />
                      Approve For Session
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="shrink-0 border-t border-black/10 bg-[#f1f4ea] px-3 pb-4 pt-3 sm:px-4">
          <div className="mx-auto max-w-[52rem]">
            <AnimatePresence>
              {slashOpen && filteredCommands.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.14 }}
                  className="mb-3 overflow-hidden rounded-2xl border border-black/10 bg-[#f8faf4] shadow-[0_20px_48px_rgba(15,23,42,0.12)]"
                >
                  {filteredCommands.map((command) => (
                    <button
                      key={command.command}
                      type="button"
                      onClick={() => applySlashCommand(command.insert)}
                      className="flex w-full items-start gap-3 border-b border-black/10 px-4 py-3 text-left transition-colors last:border-0 hover:bg-black/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <code className="text-xs font-semibold text-primary">{command.command}</code>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{command.description}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">{command.example}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="relative rounded-[26px] border border-black/10 bg-[#e3e8db] p-2">
              <div className="pr-20">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Message Nova... (/ for commands)"
                  disabled={isLoading}
                  className="max-h-[220px] min-h-[48px] resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  rows={1}
                />
              </div>

              <div className="absolute bottom-2 right-2">
                {isLoading ? (
                  <Button
                    onClick={stopStreaming}
                    size="icon"
                    variant="outline"
                    className="h-9 w-9 rounded-xl border-black/15 bg-black/[0.03] shadow-none hover:bg-black/[0.05]"
                    title="Stop generation"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => void sendMessage()}
                    disabled={!input.trim()}
                    size="icon"
                    className="h-9 w-9 rounded-xl bg-primary shadow-none hover:bg-primary/90"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


