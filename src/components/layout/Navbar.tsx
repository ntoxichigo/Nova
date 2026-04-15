'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ActivitySquare, Brain, Code2, Cpu, Github, GraduationCap, Link2, Lock, Menu, MessageSquare, Radar, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore, type AppView } from '@/store/app-store';
import { useShallow } from 'zustand/react/shallow';

const navItems: { id: AppView; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'scripts', label: 'Scripts', icon: <Code2 className="h-4 w-4" /> },
  { id: 'skills', label: 'Skills', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'teach', label: 'Teach', icon: <GraduationCap className="h-4 w-4" /> },
  { id: 'dashboard', label: 'Mission', icon: <Lock className="h-4 w-4" /> },
  { id: 'ops', label: 'Ops', icon: <Radar className="h-4 w-4" /> },
  { id: 'doctor', label: 'Doctor', icon: <ActivitySquare className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

export function Navbar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen } = useAppStore(useShallow((state) => ({
    activeView: state.activeView,
    setActiveView: state.setActiveView,
    sidebarOpen: state.sidebarOpen,
    setSidebarOpen: state.setSidebarOpen,
  })));
  const [modelLabel, setModelLabel] = useState('');
  const [connections, setConnections] = useState<{ github: boolean; google: boolean }>({ github: false, google: false });

  useEffect(() => {
    let cancelled = false;

    async function loadNavbarData() {
      try {
        const [statusRes, connectionsRes] = await Promise.all([
          fetch('/api/runtime/llm-status').catch(() => null),
          fetch('/api/connections').catch(() => null),
        ]);

        if (!cancelled && statusRes?.ok) {
          const status = await statusRes.json();
          if (!cancelled) {
            const model = String(status.model || status.resolvedModel || '').trim().split('/').pop() || '';
            const provider = String(status.provider || '').trim();
            const connected = Boolean(status.connected);
            const label = model || provider || 'Model unavailable';
            setModelLabel(connected ? label : `${label} (offline)`);
          }
        } else if (!cancelled) {
          const settingsRes = await fetch('/api/settings').catch(() => null);
          if (!cancelled && settingsRes?.ok) {
            const settings = await settingsRes.json();
            const provider = settings.llm_provider || '';
            const model = (settings.llm_model || '').split('/').pop() || '';
            setModelLabel(model || provider || 'Model unavailable');
          }
        }

        if (!cancelled && connectionsRes?.ok) {
          const data: Array<{ service: string }> = await connectionsRes.json();
          if (cancelled) return;
          setConnections({
            github: data.some((connection) => connection.service === 'github'),
            google: data.some((connection) => connection.service === 'google'),
          });
        }
      } catch {
        // Ignore navbar refresh failures and keep the current UI state.
      }
    }

    void loadNavbarData();
    const timer = window.setInterval(() => {
      void loadNavbarData();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const connectedCount = [connections.github, connections.google].filter(Boolean).length;

  return (
    <nav className="sticky top-0 z-50 border-b border-border/40 bg-card/90 backdrop-blur-2xl">
      <div className="mx-auto flex h-13 max-w-full items-center justify-between px-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu className="h-4.5 w-4.5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 nova-glow">
              <Brain className="h-4.5 w-4.5 text-primary" />
            </div>
            <span className="select-none text-base font-bold tracking-tight nova-glow-text">
              Nova<span className="text-primary">AI</span>
            </span>
          </div>
          {modelLabel && (
            <span className="hidden items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground sm:inline-flex">
              <Cpu className="h-2.5 w-2.5 text-primary/70" />
              {modelLabel}
            </span>
          )}
        </div>

        <div className="hidden items-center rounded-xl border border-border/40 bg-secondary/40 p-0.5 md:flex">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`relative flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-all ${
                activeView === item.id
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {activeView === item.id && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-[10px] bg-primary shadow-md"
                  style={{ boxShadow: '0 0 10px oklch(0.68 0.26 290 / 35%)' }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {item.icon}
                {item.label}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView('settings')}
            className="hidden items-center gap-1.5 rounded-full border border-border/40 bg-secondary/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground sm:flex"
            title="Manage connections"
          >
            <Link2 className="h-3 w-3" />
            {connectedCount > 0 ? (
              <span className="flex items-center gap-1">
                {connections.github && <Github className="h-3 w-3 text-foreground/70" />}
                {connections.google && (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                )}
                <span className="text-green-400/80">.</span>
                <span>{connectedCount} connected</span>
              </span>
            ) : (
              <span>Connect accounts</span>
            )}
          </button>

          <div className="flex items-center gap-0.5 md:hidden">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${activeView === item.id ? 'text-primary' : 'text-muted-foreground'}`}
                onClick={() => setActiveView(item.id)}
              >
                {item.icon}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
