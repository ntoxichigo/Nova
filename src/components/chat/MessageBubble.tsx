'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Brain, User, Copy, Check, Sparkles, GraduationCap, BookmarkPlus, ThumbsUp, ThumbsDown, Trash2, Wrench, ChevronDown, Play, X as XIcon, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message, AgentStep } from '@/store/app-store';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { applyResponsiveHtmlGuard } from '@/lib/html-preview';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

// Artifact iframe renderer
function ArtifactBlock({ code, language }: { code: string; language: string }) {
  const [rendered, setRendered] = useState(false);
  const isRenderable = ['html', 'svg'].includes(language.toLowerCase());
  const previewHtml = applyResponsiveHtmlGuard(code, 'Nova Artifact Preview');
  if (!isRenderable) return null;
  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-border/50">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-secondary/60 text-xs text-muted-foreground border-b border-border/40">
        <span className="font-mono">{language.toUpperCase()} artifact</span>
        <button
          onClick={() => setRendered((r) => !r)}
          className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-secondary transition-colors"
        >
          {rendered ? <><XIcon className="h-3 w-3" /> Close</> : <><Play className="h-3 w-3" /> Run</>}
        </button>
      </div>
      {rendered && (
        <iframe
          srcDoc={previewHtml}
          sandbox="allow-scripts"
          className="w-full min-w-0 border-0 bg-white"
          style={{ minHeight: '240px', height: '320px' }}
          title="Artifact preview"
        />
      )}
    </div>
  );
}

function MessageBubbleComponent({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<1 | -1 | null>(message.feedback ?? null);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveMemory = async () => {
    if (!message.content || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fact',
          content: message.content.slice(0, 500),
          importance: 6,
        }),
      });
      if (res.ok) {
        toast.success('Saved to memory');
      } else {
        toast.error('Failed to save');
      }
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const targetId = message.dbId || message.id;
    // Optimistic remove from store immediately
    useAppStore.getState().deleteMessage(message.id);
    // Best-effort persist delete
    if (targetId && !targetId.startsWith('user-') && !targetId.startsWith('assistant-')) {
      fetch(`/api/messages/${targetId}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  const handleSpeak = () => {
    if (!('speechSynthesis' in window)) { toast.error('TTS not supported'); return; }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = message.content.replace(/[#*_`~>\[\]()!]/g, '').slice(0, 5000);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const handleFeedback = async (value: 1 | -1) => {
    // Use dbId if available; otherwise fall back to the local id (won't persist, shows toast)
    const targetId = message.dbId || message.id;
    if (!targetId || isStreaming) return;

    const newValue = localFeedback === value ? 0 : value; // toggle off
    setLocalFeedback(newValue === 0 ? null : (newValue as 1 | -1));

    // Optimistic update in store
    useAppStore.setState((state) => ({
      messages: state.messages.map((m) =>
        m.id === message.id ? { ...m, feedback: newValue === 0 ? null : (newValue as 1 | -1) } : m
      ),
    }));

    try {
      await fetch(`/api/messages/${targetId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: newValue }),
      });
      if (value === -1 && newValue === -1) {
        toast.info('Feedback recorded - Nova will improve');
      }
    } catch {
      toast.error('Failed to submit feedback');
    }
  };

  // Handle skillsUsed being a JSON string (from DB) or array (from live chat)
  let skillsUsed: string[] = [];
  if (Array.isArray(message.skillsUsed)) {
    skillsUsed = message.skillsUsed;
  } else if (typeof message.skillsUsed === 'string') {
    try {
      const parsed = JSON.parse(message.skillsUsed);
      skillsUsed = Array.isArray(parsed) ? parsed : [];
    } catch {
      skillsUsed = [];
    }
  }

  const toolsUsed = Array.isArray(message.toolsUsed) ? message.toolsUsed : [];
  const agentSteps: AgentStep[] = Array.isArray(message.agentSteps) ? message.agentSteps : [];
  const [stepsOpen, setStepsOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('flex gap-3 px-4 py-3 sm:px-6', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border',
          isUser
            ? 'border-black/10 bg-black/[0.04]'
            : 'border-black/10 bg-black/[0.03]'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-slate-700" />
        ) : (
          <Brain className="h-4 w-4 text-primary" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn('group flex min-w-0 max-w-[84%] flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'relative rounded-[22px] px-4 py-3 text-sm leading-7 shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
            isUser
              ? 'rounded-tr-lg border border-black/15 bg-[#dfe6d7] text-slate-800'
              : 'rounded-tl-lg border border-black/10 bg-black/[0.03]'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="markdown-content">
              {isStreaming && !message.content ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                    className="h-2 w-2 rounded-full bg-primary inline-block"
                  />
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }}
                    className="h-2 w-2 rounded-full bg-primary inline-block"
                  />
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }}
                    className="h-2 w-2 rounded-full bg-primary inline-block"
                  />
                </span>
              ) : (
                <>
                  <ReactMarkdown
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const lang = match?.[1] || '';
                        const code = String(children).replace(/\n$/, '');
                        const isBlock = className?.includes('language-');
                        if (isBlock && ['html', 'svg'].includes(lang.toLowerCase())) {
                          return (
                            <>
                              <code className={className} {...props}>{children}</code>
                              <ArtifactBlock code={code} language={lang} />
                            </>
                          );
                        }
                        return <code className={className} {...props}>{children}</code>;
                      },
                    }}
                  >{message.content}</ReactMarkdown>
                  {isStreaming && <span className="nova-cursor">|</span>}
                </>
              )}
            </div>
          )}
        </div>

        {/* Agent steps accordion */}
        {!isUser && agentSteps.length > 0 && (
          <div className="w-full overflow-hidden rounded-2xl border border-black/10 bg-black/[0.02] text-xs">
            <button
              onClick={() => setStepsOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 bg-black/[0.03] px-3 py-2 text-muted-foreground transition-colors hover:bg-black/[0.05]"
            >
              <span>Worked through {agentSteps.length} steps</span>
              <ChevronDown className={cn('h-3 w-3 transition-transform', stepsOpen && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {stepsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2 px-3 py-2 bg-black/[0.03]">
                    {agentSteps.map((step) => (
                      <div key={step.id} className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-green-500">[x]</span>
                          <span className="font-medium text-foreground/80">{step.name}</span>
                        </div>
                        {step.output && (
                          <p className="ml-4 text-muted-foreground line-clamp-2">{step.output}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Skills used badges */}
        {!isUser && skillsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skillsUsed.map((skill, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                <Sparkles className="h-3 w-3" />
                {skill}
              </span>
            ))}
          </div>
        )}

        {!isUser && toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {toolsUsed.map((tool, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/70 px-2 py-0.5 text-xs text-muted-foreground"
              >
                <Wrench className="h-3 w-3" />
                {tool}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        {!isUser && message.content && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              title="Copy"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={handleSpeak}
              className={cn(
                "rounded-md p-1 transition-colors",
                speaking ? "text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={speaking ? 'Stop speaking' : 'Read aloud'}
            >
              {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={handleSaveMemory}
              disabled={saving || isStreaming}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary transition-colors disabled:opacity-40"
              title="Save to memory"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
            </button>
            {!isStreaming && (
              <>
                <button
                  onClick={() => handleFeedback(1)}
                  title="Good response"
                  className={cn(
                    "rounded-md p-1 transition-colors",
                    localFeedback === 1
                      ? "text-green-400"
                      : "text-muted-foreground hover:text-green-400"
                  )}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleFeedback(-1)}
                  title="Bad response"
                  className={cn(
                    "rounded-md p-1 transition-colors",
                    localFeedback === -1
                      ? "text-red-400"
                      : "text-muted-foreground hover:text-red-400"
                  )}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleDelete}
                  title="Delete message"
                  className="rounded-md p-1 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        )}

        {/* Delete button for user messages */}
        {isUser && !isStreaming && (
          <button
            onClick={handleDelete}
            title="Delete message"
            className="rounded-md p-1 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

export const MessageBubble = memo(
  MessageBubbleComponent,
  (prev, next) => prev.message === next.message && prev.isStreaming === next.isStreaming,
);

interface LearningSuggestionProps {
  suggestions: string[];
  onTeach: (suggestion: string) => void;
}

export function LearningSuggestions({ suggestions, onTeach }: LearningSuggestionProps) {
  if (suggestions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 px-4 py-2"
    >
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <GraduationCap className="h-3.5 w-3.5" />
        Nova wants to learn more
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onTeach(suggestion)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Teach this
            <span className="text-muted-foreground">{suggestion.length > 40 ? suggestion.slice(0, 40) + '...' : suggestion}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

interface TypingIndicatorProps {
  visible: boolean;
}

export function TypingIndicator({ visible }: TypingIndicatorProps) {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex gap-3 px-4 py-3 sm:px-6"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-black/10 bg-black/[0.03]">
        <Brain className="h-4 w-4 text-primary" />
      </div>
      <div className="flex items-center gap-1 rounded-[22px] rounded-tl-lg border border-black/10 bg-black/[0.03] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: 0 }}
          className="h-2 w-2 rounded-full bg-primary"
        />
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }}
          className="h-2 w-2 rounded-full bg-primary"
        />
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }}
          className="h-2 w-2 rounded-full bg-primary"
        />
      </div>
    </motion.div>
  );
}

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const suggestions = [
    'Help me debug a Node script',
    'Draft a plan for this coding task',
    'Turn this idea into a local prototype',
    'Review this approach before I build it',
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10"
    >
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <motion.div
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ repeat: Infinity, duration: 4 }}
          className="flex h-24 w-24 items-center justify-center rounded-[28px] border border-black/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] shadow-[0_28px_80px_rgba(8,145,178,0.18)]"
        >
          <Brain className="h-11 w-11 text-primary" />
        </motion.div>
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Local-first alpha</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-800 sm:text-4xl">Agent chat for technical users, with just enough build power nearby.</h1>
        </div>
        <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
          Start in chat, shape the task, and only drop into Studio or support tools when the work genuinely needs it. This alpha is optimized for focused technical workflows, not for being an everything app.
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-3 md:grid-cols-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={s}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => onSuggestionClick(s)}
            className="rounded-[22px] border border-black/10 bg-black/[0.03] px-4 py-4 text-left text-sm text-slate-600 transition-all hover:border-cyan-400/20 hover:bg-cyan-400/[0.06] hover:text-slate-800"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}




