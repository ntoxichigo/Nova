'use client';

import { motion } from 'framer-motion';
import { Brain, MessageSquare, Sparkles, LayoutDashboard, GraduationCap, Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore, type AppView } from '@/store/app-store';

const navItems: { id: AppView; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'skills', label: 'Skills', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'teach', label: 'Teach', icon: <GraduationCap className="h-4 w-4" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

export function Navbar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <nav className="sticky top-0 z-50 border-b border-border/50 bg-card/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-full items-center justify-between px-4">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 nova-glow">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <span className="text-lg font-bold tracking-tight nova-glow-text">
              Nova <span className="text-primary">AI</span>
            </span>
          </div>
        </div>

        {/* Center: Navigation */}
        <div className="hidden items-center gap-1 rounded-xl bg-secondary/50 p-1 md:flex">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              onClick={() => setActiveView(item.id)}
              className={`relative rounded-lg px-3 transition-all ${
                activeView === item.id
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {activeView === item.id && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg bg-primary/80"
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {item.icon}
                {item.label}
              </span>
            </Button>
          ))}
        </div>

        {/* Right: Mobile nav */}
        <div className="flex items-center gap-1 md:hidden">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={activeView === item.id ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setActiveView(item.id)}
            >
              {item.icon}
            </Button>
          ))}
        </div>
      </div>
    </nav>
  );
}
