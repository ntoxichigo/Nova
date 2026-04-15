'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Send, SquareTerminal, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ScriptIDEMessage } from '@/store/app-store';

interface IDEAssistantPanelProps {
  projectId: string;
  projectName: string;
  activeFileId?: string | null;
  messages: ScriptIDEMessage[];
  onProjectRefresh: () => Promise<unknown> | unknown;
}

interface IDEThreadMessage {
  id: string;
  role: string;
  content: string;
  toolCalls: string[];
  toolEvents: string[];
  pending?: boolean;
  status?: string;
}

function createThreadMessageId(prefix: 'user' | 'pending'): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function parseToolCalls(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((item) => String(item)))]
      : [];
  } catch {
    return [];
  }
}

function mapStoredMessages(messages: ScriptIDEMessage[]): IDEThreadMessage[] {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const baseId = String(message.id || 'message');
    const count = seen.get(baseId) || 0;
    seen.set(baseId, count + 1);
    const stableId = count === 0 ? baseId : `${baseId}-dup-${count}`;
    return {
      id: stableId,
      role: message.role,
      content: message.content,
      toolCalls: parseToolCalls(message.toolCalls),
      toolEvents: [],
    };
  });
}

function appendSection(existing: string, next: string): string {
  const trimmed = next.trim();
  if (!trimmed) {
    return existing;
  }
  if (!existing.trim()) {
    return trimmed;
  }
  if (existing.includes(trimmed)) {
    return existing;
  }
  return `${existing.trim()}\n\n${trimmed}`;
}

function appendUniqueEvent(events: string[], next: string): string[] {
  const trimmed = next.trim();
  if (!trimmed) return events;
  if (events[events.length - 1] === trimmed) return events;
  return [...events, trimmed].slice(-30);
}

export function IDEAssistantPanel({
  projectId,
  projectName,
  activeFileId,
  messages,
  onProjectRefresh,
}: IDEAssistantPanelProps) {
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<IDEThreadMessage[]>(() => mapStoredMessages(messages));
  const [isSending, setIsSending] = useState(false);
  const [runtimeLabel, setRuntimeLabel] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSending) {
      setThread(mapStoredMessages(messages));
    }
  }, [isSending, messages, projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const canSend = draft.trim().length > 0 && !isSending;

  const updatePendingMessage = useCallback((pendingId: string, updater: (message: IDEThreadMessage) => IDEThreadMessage) => {
    setThread((current) => current.map((message) => (message.id === pendingId ? updater(message) : message)));
  }, []);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    const pendingId = createThreadMessageId('pending');
    const userMessage: IDEThreadMessage = {
      id: createThreadMessageId('user'),
      role: 'user',
      content,
      toolCalls: [],
      toolEvents: [],
    };
    const pendingMessage: IDEThreadMessage = {
      id: pendingId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      toolEvents: [],
      pending: true,
      status: 'Planning workspace actions',
    };

    setDraft('');
    setIsSending(true);
    setThread((current) => [...current, userMessage, pendingMessage]);
    setRuntimeLabel('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/scripts/${projectId}/assistant/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          activeFileId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to reach the IDE assistant.');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('IDE assistant stream was unavailable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
          switch (payload.type) {
            case 'meta':
              setRuntimeLabel([
                payload.provider,
                payload.model,
                payload.taskMode,
                payload.autonomyProfile,
              ].filter(Boolean).join(' - '));
              break;
            case 'assistant_status':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                status: payload.stage === 'planning'
                  ? 'Planning workspace actions'
                  : `Iterating on workspace step ${Number(payload.step ?? 0) + 1}`,
              }));
              break;
            case 'assistant_note':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                content: appendSection(message.content, String(payload.content || '')),
              }));
              break;
            case 'tool_start':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                toolEvents: appendUniqueEvent(message.toolEvents, `Running ${String(payload.toolName || 'tool')}`),
              }));
              break;
            case 'tool_done':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                toolEvents: appendUniqueEvent(
                  message.toolEvents,
                  `${String(payload.toolName || 'tool')} completed${payload.result ? `: ${String(payload.result)}` : ''}`,
                ),
              }));
              break;
            case 'tool_error':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                toolEvents: appendUniqueEvent(
                  message.toolEvents,
                  `${String(payload.toolName || 'tool')} failed: ${String(payload.error || 'Unknown error')}`,
                ),
              }));
              break;
            case 'replace':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                content: String(payload.content || ''),
                pending: false,
                status: 'Completed',
              }));
              break;
            case 'verification':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                toolEvents: appendUniqueEvent(
                  message.toolEvents,
                  `Verifier ${String(payload.verdict || 'pass')}: ${String(payload.summary || 'Workspace check complete')}`,
                ),
              }));
              break;
            case 'done':
              updatePendingMessage(pendingId, (message) => ({
                ...message,
                pending: false,
                status: 'Completed',
                toolCalls: Array.isArray(payload.toolsUsed)
                  ? [...new Set(payload.toolsUsed.map((tool) => String(tool)))]
                  : message.toolCalls,
              }));
              await onProjectRefresh();
              break;
            default:
              break;
          }
        }
      }
    } catch (error) {
      const message = controller.signal.aborted
        ? 'IDE assistant stopped.'
        : error instanceof Error
          ? error.message
          : 'IDE assistant failed.';

      updatePendingMessage(pendingId, (current) => ({
        ...current,
        content: message,
        pending: false,
        status: 'Error',
      }));
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  }, [activeFileId, draft, isSending, onProjectRefresh, projectId, updatePendingMessage]);

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const emptyState = useMemo(
    () => (
      <div className="rounded-xl border border-dashed border-border/50 bg-background/30 p-4 text-sm text-muted-foreground">
        This is the IDE-specific assistant, separate from normal chat. It stays project-aware and can plan, edit files, create folders, and run workspace commands.
      </div>
    ),
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border/40 bg-card/20">
      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">IDE Assistant</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {projectName}
              {runtimeLabel ? ` - ${runtimeLabel}` : ''}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <SquareTerminal className="h-3.5 w-3.5" />
          Managed workspace mode
          <Wrench className="ml-1 h-3.5 w-3.5" />
          Plan, edit, execute
        </div>
      </div>

      <div ref={scrollRef} className="scroll-container min-h-0 flex-1 space-y-3 px-4 py-4">
        {thread.length === 0 ? emptyState : null}

        {thread.map((message, messageIndex) => {
          const isUser = message.role === 'user';
          return (
            <div
              key={`${message.id}-${messageIndex}`}
              className={`rounded-2xl border px-3 py-3 text-sm ${
                isUser
                  ? 'ml-6 border-primary/20 bg-primary/10'
                  : 'mr-3 border-border/50 bg-background/60'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {isUser ? 'You' : 'Nova IDE'}
                </span>
                {message.status ? (
                  <span className="text-[11px] text-muted-foreground">
                    {message.pending ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {message.status}
                      </span>
                    ) : message.status}
                  </span>
                ) : null}
              </div>

              <div className="whitespace-pre-wrap break-words leading-relaxed">
                {message.content || (message.pending ? 'Thinking inside the workspace...' : '')}
              </div>

              {message.toolCalls.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {message.toolCalls.map((toolName, index) => (
                    <span
                      key={`${message.id}-tool-${toolName}-${index}`}
                      className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary"
                    >
                      {toolName}
                    </span>
                  ))}
                </div>
              ) : null}

              {message.toolEvents.length > 0 ? (
                <div className="mt-3 space-y-1 rounded-xl border border-border/40 bg-card/30 p-2">
                  {message.toolEvents.map((event, index) => (
                    <div key={`${message.id}-event-${index}-${event.slice(0, 24)}`} className="text-[11px] text-muted-foreground">
                      {event}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/40 bg-card/30 px-4 py-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Ask Nova IDE to inspect, plan, edit, or run inside this project..."
          className="min-h-[96px] resize-none text-sm"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            Ctrl+Enter to send
          </div>
          <div className="flex items-center gap-2">
            {isSending ? (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={stopRun}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Stop
              </Button>
            ) : null}
            <Button type="button" size="sm" className="gap-2" onClick={() => void sendMessage()} disabled={!canSend}>
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
