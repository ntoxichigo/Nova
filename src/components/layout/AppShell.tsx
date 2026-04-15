'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ActivitySquare,
  ArrowUpRight,
  Brain,
  Code2,
  Cpu,
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { ConversationSidebar } from '@/components/chat/ConversationSidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore, type AppView } from '@/store/app-store';
import { useShallow } from 'zustand/react/shallow';

const viewMeta: Record<AppView, {
  label: string;
  eyebrow: string;
  description: string;
  icon: typeof MessageSquare;
  accent: string;
  summary: string;
  flow: string[];
}> = {
  chat: {
    label: 'Assistant',
    eyebrow: 'Primary workspace',
    description: 'Keep one conversation in focus while history and controls stay available nearby instead of crowding the canvas.',
    icon: MessageSquare,
    accent: 'from-sky-500/22 via-cyan-400/10 to-transparent',
    summary: 'Focused conversational workspace with visible execution context and lightweight controls.',
    flow: ['Review chat history', 'Write prompt or command', 'Approve or refine actions'],
  },
  scripts: {
    label: 'Studio',
    eyebrow: 'Build workspace',
    description: 'Projects, files, previews, commands, and the IDE assistant live in one production-style environment.',
    icon: Code2,
    accent: 'from-emerald-500/18 via-cyan-400/10 to-transparent',
    summary: 'A proper build station for files, previews, execution logs, and project-level iteration.',
    flow: ['Select project', 'Edit and preview', 'Run commands or export'],
  },
  skills: {
    label: 'Capabilities',
    eyebrow: 'Skill library',
    description: 'Curate what the system knows how to do with a cleaner library view and more deliberate management states.',
    icon: Sparkles,
    accent: 'from-amber-500/18 via-orange-400/10 to-transparent',
    summary: 'Capability management for skills, profiles, and activation state without visual noise.',
    flow: ['Search capability', 'Audit activation state', 'Edit or create skill'],
  },
  teach: {
    label: 'Knowledge',
    eyebrow: 'Training input',
    description: 'Add knowledge, preferences, and new behaviors through a clearer guided learning surface.',
    icon: GraduationCap,
    accent: 'from-violet-500/18 via-sky-400/10 to-transparent',
    summary: 'Guided input for teaching preferences, knowledge, and system behaviors.',
    flow: ['Choose learning mode', 'Add structured content', 'Confirm memory or skill'],
  },
  dashboard: {
    label: 'Mission Control',
    eyebrow: 'Oversight',
    description: 'Track trust, intelligence, reviews, and operating posture from a cleaner command-center style dashboard.',
    icon: LayoutDashboard,
    accent: 'from-sky-500/18 via-slate-400/10 to-transparent',
    summary: 'Governance, reviews, and operating posture for the whole product.',
    flow: ['Check posture', 'Review flagged items', 'Open the next workspace'],
  },
  ops: {
    label: 'Operations',
    eyebrow: 'Live telemetry',
    description: 'Watch runtime, automation, command activity, and memory usage through a more structured operations lens.',
    icon: Radar,
    accent: 'from-cyan-500/20 via-blue-400/10 to-transparent',
    summary: 'Operational telemetry for live work, automation, and runtime status.',
    flow: ['Inspect health', 'Follow activity feed', 'Jump into remediation'],
  },
  doctor: {
    label: 'Doctor',
    eyebrow: 'Diagnostics',
    description: 'Run fast confidence checks on generation, tools, previews, and runtime posture before shipping changes.',
    icon: ActivitySquare,
    accent: 'from-emerald-500/20 via-lime-400/10 to-transparent',
    summary: 'Diagnostic checks for reliability across provider, tooling, and previews.',
    flow: ['Run diagnostics', 'Inspect failing checks', 'Resolve in settings or studio'],
  },
  settings: {
    label: 'Settings',
    eyebrow: 'Configuration',
    description: 'Model providers, connections, automation posture, and product controls are grouped into a calmer control room.',
    icon: Settings,
    accent: 'from-slate-400/16 via-sky-400/8 to-transparent',
    summary: 'System configuration for providers, connections, and operating behavior.',
    flow: ['Pick provider', 'Review integrations', 'Tune operating defaults'],
  },
};

const primaryRailItems: AppView[] = ['chat', 'scripts', 'settings'];
const supportViews: AppView[] = ['teach', 'skills', 'dashboard', 'ops', 'doctor'];

function ViewGroup({
  title,
  caption,
  items,
  activeView,
  onSelect,
}: {
  title: string;
  caption: string;
  items: AppView[];
  activeView: AppView;
  onSelect: (view: AppView) => void;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{title}</p>
        <p className="text-[11px] text-slate-500">{caption}</p>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => {
          const meta = viewMeta[item];
          const ItemIcon = meta.icon;
          const isActive = item === activeView;
          return (
            <button
              key={item}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                'group flex w-full items-start gap-3 rounded-[22px] border px-3 py-3 text-left transition-all',
                isActive
                  ? 'border-black/15 bg-[#d8dfd0] text-slate-800'
                  : 'border-black/10 bg-transparent text-slate-600 hover:border-black/15 hover:bg-black/[0.03] hover:text-slate-800',
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors',
                  isActive
                    ? 'border-black/15 bg-black/[0.045] text-slate-800'
                    : 'border-black/10 bg-black/[0.04] text-slate-600 group-hover:text-slate-800',
                )}
              >
                <ItemIcon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{meta.label}</span>
                  <ArrowUpRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-opacity',
                      isActive ? 'opacity-100 text-slate-600' : 'opacity-0 group-hover:opacity-100 text-slate-500',
                    )}
                  />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{meta.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkspacePanel({
  modelLabel,
  connectionsLabel,
}: {
  modelLabel: string;
  connectionsLabel: string;
}) {
  const { activeView, setActiveView } = useAppStore(useShallow((state) => ({
    activeView: state.activeView,
    setActiveView: state.setActiveView,
  })));
  const active = viewMeta[activeView];
  const ActiveIcon = active.icon;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[24px] border border-black/10 bg-[#e8ecdf] p-3">
      <div className="space-y-3 rounded-[20px] border border-black/10 bg-[#f7f8f3] p-4">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="outline" className="border-black/15 bg-black/[0.03] text-[10px] uppercase tracking-[0.24em] text-slate-600">
            {active.eyebrow}
          </Badge>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 bg-black/[0.03] text-slate-700">
            <ActiveIcon className="h-4.5 w-4.5" />
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">{active.label}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">{active.summary}</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-[#dce5d2] px-3 py-3 text-xs leading-5 text-slate-700">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Alpha focus</p>
          <p className="mt-1">
            Nova is being narrowed into a local-first agent chat alpha for technical users. Studio and the support tools stay available, but chat is the main story.
          </p>
        </div>
        <div className="space-y-2 text-xs text-slate-600">
          <div className="rounded-2xl border border-black/10 bg-black/[0.03] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Active model</div>
            <div className="mt-1 font-medium text-slate-700">{modelLabel || 'Model unavailable'}</div>
          </div>
          <div className="rounded-2xl border border-black/10 bg-black/[0.03] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Connections</div>
            <div className="mt-1 font-medium text-slate-700">{connectionsLabel}</div>
          </div>
        </div>
      </div>

      <ViewGroup
        title="Core flow"
        caption="ship the alpha"
        items={primaryRailItems}
        activeView={activeView}
        onSelect={setActiveView}
      />

      <ViewGroup
        title="Support tools"
        caption="available, not primary"
        items={supportViews}
        activeView={activeView}
        onSelect={setActiveView}
      />

      <div className="mt-3 rounded-[20px] border border-black/10 bg-[#f7f8f3] p-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Suggested flow</p>
        <div className="mt-3 space-y-2">
          {active.flow.map((step, index) => (
            <div key={step} className="flex items-start gap-3 rounded-2xl border border-black/10 bg-black/[0.03] px-3 py-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[11px] font-medium text-slate-700">
                {index + 1}
              </div>
              <p className="text-sm leading-5 text-slate-600">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen } = useAppStore(useShallow((state) => ({
    activeView: state.activeView,
    setActiveView: state.setActiveView,
    sidebarOpen: state.sidebarOpen,
    setSidebarOpen: state.setSidebarOpen,
  })));
  const currentView = viewMeta[activeView];
  const CurrentIcon = currentView.icon;
  const isChatView = activeView === 'chat';
  const [modelLabel, setModelLabel] = useState('');
  const [connectionsLabel, setConnectionsLabel] = useState('No accounts connected');
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadShellData = async () => {
      try {
        const [statusRes, connectionsRes] = await Promise.all([
          fetch('/api/runtime/llm-status').catch(() => null),
          fetch('/api/connections').catch(() => null),
        ]);

        if (!cancelled && statusRes?.ok) {
          const status = await statusRes.json();
          const model = String(status.model || status.resolvedModel || '').trim().split('/').pop() || '';
          const provider = String(status.provider || '').trim();
          const connected = Boolean(status.connected);
          const label = model || provider || 'Model unavailable';
          setModelLabel(connected ? label : `${label} (offline)`);
        } else if (!cancelled) {
          const settingsRes = await fetch('/api/settings').catch(() => null);
          if (settingsRes?.ok) {
            const settings = await settingsRes.json();
            const provider = String(settings.llm_provider || '').trim();
            const model = String(settings.llm_model || '').trim().split('/').pop() || '';
            setModelLabel(model || provider || 'Model unavailable');
          }
        }

        if (!cancelled && connectionsRes?.ok) {
          const data: Array<{ service: string }> = await connectionsRes.json();
          if (data.length === 0) {
            setConnectionsLabel('No accounts connected');
          } else {
            const labels = data.map((entry) => entry.service).sort();
            setConnectionsLabel(labels.join(', '));
          }
        }
      } catch {
        if (!cancelled) {
          setModelLabel('Model unavailable');
          setConnectionsLabel('No accounts connected');
        }
      }
    };

    void loadShellData();
    const timer = window.setInterval(() => {
      void loadShellData();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const mobileNav = useMemo(() => primaryRailItems, []);

  const handleRailSelect = (target: AppView) => {
    if (activeView === target) {
      setDesktopPanelOpen((open) => !open);
      return;
    }
    setActiveView(target);
    setDesktopPanelOpen(true);
  };

  const renderPanelContent = () => (
    activeView === 'chat'
      ? <ConversationSidebar variant="panel" />
      : <WorkspacePanel modelLabel={modelLabel} connectionsLabel={connectionsLabel} />
  );

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[#f1f4ea] text-foreground">
      <aside className="hidden md:flex md:w-[72px] md:shrink-0 md:flex-col md:justify-between md:border-r md:border-black/10 md:bg-[#e8ecdf] md:px-2.5 md:py-3">
        <div className="space-y-3">
          <div className="flex items-center justify-center">
            <motion.button
              type="button"
              onClick={() => handleRailSelect('chat')}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              className="group flex h-11 w-11 items-center justify-center rounded-[16px] border border-black/10 bg-black/[0.04] transition-all hover:border-black/20 hover:bg-black/[0.06]"
              title="Open Assistant"
            >
              <Brain className="h-5 w-5 text-slate-700 transition-colors group-hover:text-slate-800" />
            </motion.button>
          </div>

          <div className="space-y-1.5 rounded-[20px] border border-black/10 bg-black/[0.02] px-1.5 py-2">
            {primaryRailItems.map((item) => {
              const meta = viewMeta[item];
              const Icon = meta.icon;
              const isActive = item === activeView;
              return (
                <motion.button
                  key={item}
                  type="button"
                  onClick={() => handleRailSelect(item)}
                  title={meta.label}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl text-slate-400 transition-colors',
                    isActive ? 'text-slate-800' : 'hover:text-slate-800',
                  )}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="nova-rail-active-pill"
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                      className="absolute inset-0 rounded-2xl border border-black/15 bg-[#d8dfd0]"
                    />
                  ) : null}
                  <Icon className="relative z-10 h-4.5 w-4.5" />
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="rounded-[16px] border border-black/10 bg-black/[0.02] px-2 py-2.5 text-center">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">System</div>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              Local-first alpha
            </div>
          </div>
          <motion.button
            type="button"
            onClick={() => handleRailSelect('settings')}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-black/[0.03] text-slate-600 transition-all hover:border-black/15 hover:bg-black/[0.05] hover:text-slate-800"
            title="Settings"
          >
            <Settings className="h-4.5 w-4.5" />
          </motion.button>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1">
        <AnimatePresence>
          {desktopPanelOpen ? (
            <motion.div
              initial={{ x: -26, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -26, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'pointer-events-none absolute inset-y-3 left-3 z-30 hidden md:block',
                isChatView ? 'w-[286px]' : 'w-[320px]',
              )}
            >
              <div className="pointer-events-auto flex h-full min-h-0 flex-col rounded-[24px] border border-black/10 bg-[#e8ecdf] p-3 shadow-[0_26px_70px_rgba(15,23,42,0.20)]">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Workspace panel</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{currentView.label}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-2xl text-slate-600 hover:bg-black/[0.04] hover:text-slate-800"
                    onClick={() => setDesktopPanelOpen(false)}
                  >
                    <X className="h-4.5 w-4.5" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {renderPanelContent()}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col bg-[#f1f4ea]">
          {isChatView ? (
            <div className="shrink-0 border-b border-black/10 px-3 py-2 lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-black/[0.03] text-slate-700 transition hover:border-black/15 hover:bg-black/[0.045]"
                  aria-label="Open conversation panel"
                >
                  <Menu className="h-4.5 w-4.5" />
                </button>
                <p className="text-sm font-medium text-slate-800">Assistant</p>
                <Badge variant="outline" className="border-black/10 bg-black/[0.02] px-2.5 py-1 text-[11px] text-slate-600">
                  <Cpu className="mr-1.5 h-3.5 w-3.5 text-cyan-300" />
                  {modelLabel || 'Model'}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="shrink-0 border-b border-black/10 px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 bg-black/[0.03] text-slate-700 transition hover:border-black/15 hover:bg-black/[0.045] lg:hidden"
                    aria-label="Open workspace panel"
                  >
                    <Menu className="h-4.5 w-4.5" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{currentView.eyebrow}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-black/10 bg-black/[0.04] text-slate-700">
                        <CurrentIcon className="h-4.5 w-4.5" />
                      </div>
                      <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">{currentView.label}</h1>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{currentView.description}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Badge variant="outline" className="border-black/10 bg-black/[0.02] px-3 py-1 text-slate-600">
                    <Cpu className="mr-1.5 h-3.5 w-3.5 text-cyan-300" />
                    {modelLabel || 'Model unavailable'}
                  </Badge>
                  <Badge variant="outline" className="border-black/10 bg-black/[0.02] px-3 py-1 text-slate-600">
                    <FolderKanban className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
                    {connectionsLabel}
                  </Badge>
                </div>
              </div>

              <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
                {mobileNav.map((item) => {
                  const meta = viewMeta[item];
                  const Icon = meta.icon;
                  const isActive = item === activeView;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setActiveView(item)}
                      className={cn(
                        'flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm transition-all',
                        isActive ? 'border-cyan-400/25 bg-cyan-400/12 text-slate-800' : 'border-black/10 bg-black/[0.02] text-slate-600',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="h-full overflow-hidden">
              {children}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {sidebarOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -32, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -32, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-y-3 left-3 z-50 w-[min(350px,calc(100vw-24px))] lg:hidden"
            >
              <div className="flex h-full min-h-0 flex-col rounded-[24px] border border-black/10 bg-[#e8ecdf] p-3 shadow-[0_30px_90px_rgba(15,23,42,0.24)]">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Workspace panel</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{currentView.label}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-2xl text-slate-600 hover:bg-black/[0.04] hover:text-slate-800" onClick={() => setSidebarOpen(false)}>
                    <X className="h-4.5 w-4.5" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {renderPanelContent()}
                </div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}


