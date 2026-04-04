'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Brain,
  Sparkles,
  BookOpen,
  MessageSquare,
  GraduationCap,
  ArrowRight,
  Zap,
  TrendingUp,
  Layers,
  Activity,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';

interface DashboardStats {
  totalSkills: number;
  activeSkills: number;
  totalKnowledge: number;
  totalConversations: number;
  totalMessages: number;
  totalMemories: number;
  intelligenceLevel: number;
}

export function DashboardView() {
  const [stats, setStats] = useState<DashboardStats>({
    totalSkills: 0,
    activeSkills: 0,
    totalKnowledge: 0,
    totalConversations: 0,
    totalMessages: 0,
    totalMemories: 0,
    intelligenceLevel: 0,
  });
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const [skillsRes, knowledgeRes, conversationsRes, memoriesRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/knowledge'),
        fetch('/api/conversations'),
        fetch('/api/memory'),
      ]);

      const skills = skillsRes.ok ? await skillsRes.json() : [];
      const knowledge = knowledgeRes.ok ? await knowledgeRes.json() : [];
      const conversations = conversationsRes.ok ? await conversationsRes.json() : [];
      const memories = memoriesRes.ok ? await memoriesRes.json() : [];

      const totalMessages = conversations.reduce(
        (acc: number, c: { _count?: { messages: number } }) => acc + (c._count?.messages || 0),
        0
      );

      // Intelligence level: weighted sum of skills, knowledge, and memories
      const activeSkillsCount = skills.filter((s: { isActive: boolean }) => s.isActive).length;
      const intelligenceLevel = Math.min(
        100,
        Math.round(
          activeSkillsCount * 8 +
            knowledge.length * 3 +
            memories.length * 2 +
            totalMessages * 0.5
        )
      );

      setStats({
        totalSkills: skills.length,
        activeSkills: activeSkillsCount,
        totalKnowledge: knowledge.length,
        totalConversations: conversations.length,
        totalMessages,
        totalMemories: memories.length,
        intelligenceLevel,
      });
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh when switching to dashboard view
  const activeView = useAppStore((state) => state.activeView);
  useEffect(() => {
    if (activeView === 'dashboard') {
      setLoading(true);
      loadStats();
    }
  }, [activeView, loadStats]);

  const quickActions = [
    {
      label: 'New Skill',
      description: 'Teach Nova a new capability',
      icon: <Sparkles className="h-4 w-4" />,
      view: 'skills' as const,
      color: 'text-emerald-400 bg-emerald-500/10',
    },
    {
      label: 'Teach Knowledge',
      description: 'Share knowledge with Nova',
      icon: <BookOpen className="h-4 w-4" />,
      view: 'teach' as const,
      color: 'text-amber-400 bg-amber-500/10',
    },
    {
      label: 'Start Chat',
      description: 'Talk to Nova',
      icon: <MessageSquare className="h-4 w-4" />,
      view: 'chat' as const,
      color: 'text-primary bg-primary/10',
    },
    {
      label: 'Set Preferences',
      description: 'Customize Nova\'s behavior',
      icon: <Settings className="h-4 w-4" />,
      view: 'teach' as const,
      color: 'text-cyan-400 bg-cyan-500/10',
    },
  ];

  const statCards = [
    {
      label: 'Active Skills',
      value: stats.activeSkills,
      total: stats.totalSkills,
      icon: <Sparkles className="h-5 w-5 text-emerald-400" />,
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Knowledge Entries',
      value: stats.totalKnowledge,
      icon: <BookOpen className="h-5 w-5 text-amber-400" />,
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Conversations',
      value: stats.totalConversations,
      icon: <MessageSquare className="h-5 w-5 text-primary" />,
      bg: 'bg-primary/10',
    },
    {
      label: 'Memories',
      value: stats.totalMemories,
      icon: <Brain className="h-5 w-5 text-pink-400" />,
      bg: 'bg-pink-500/10',
    },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl bg-secondary/30" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl bg-secondary/30" />
      </div>
    );
  }

  const getLevelTitle = (level: number) => {
    if (level >= 80) return { title: 'Expert', color: 'text-emerald-400' };
    if (level >= 60) return { title: 'Advanced', color: 'text-blue-400' };
    if (level >= 40) return { title: 'Intermediate', color: 'text-amber-400' };
    if (level >= 20) return { title: 'Learning', color: 'text-orange-400' };
    return { title: 'Beginner', color: 'text-muted-foreground' };
  };

  const levelInfo = getLevelTitle(stats.intelligenceLevel);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <TrendingUp className="h-6 w-6 text-primary" />
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview of Nova&apos;s capabilities and your teaching progress.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setLoading(true); loadStats(); }}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Intelligence Level */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-6 nova-glow"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 3 }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20"
            >
              <Brain className="h-7 w-7 text-primary" />
            </motion.div>
            <div>
              <p className="text-sm text-muted-foreground">Nova&apos;s Intelligence Level</p>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold">{stats.intelligenceLevel}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
                <Badge variant="outline" className={levelInfo.color}>
                  {levelInfo.title}
                </Badge>
              </div>
            </div>
          </div>
          <div className="w-full sm:w-64">
            <Progress value={stats.intelligenceLevel} className="h-3 bg-secondary/50" />
            <p className="mt-1 text-xs text-muted-foreground text-right">
              {stats.intelligenceLevel < 20
                ? 'Teach Nova more to increase its intelligence!'
                : stats.intelligenceLevel < 50
                  ? 'Good progress! Keep teaching Nova.'
                  : stats.intelligenceLevel < 80
                    ? 'Nova is getting smart! Keep going.'
                    : 'Nova is highly intelligent!'}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="border-border/50 bg-card hover:border-primary/20 transition-colors">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 text-2xl font-bold">{stat.value}</p>
                    {stat.total !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {stat.total - stat.value} inactive
                      </p>
                    )}
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bg}`}>
                    {stat.icon}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="border-border/50 bg-card h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-primary" />
                Quick Actions
              </CardTitle>
              <CardDescription>Get started with these common tasks</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => useAppStore.getState().setActiveView(action.view)}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/30 p-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-all group"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${action.color}`}>
                    {action.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* Activity Feed / Tips */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="border-border/50 bg-card h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                Growth Tips
              </CardTitle>
              <CardDescription>Ways to make Nova even smarter</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  tip: 'Create coding skills with detailed instructions',
                  desc: 'The more specific your instructions, the better Nova performs.',
                  priority: stats.activeSkills < 3 ? 'high' : 'normal',
                },
                {
                  tip: 'Share knowledge about your domain',
                  desc: 'Help Nova understand your specific field and terminology.',
                  priority: stats.totalKnowledge < 5 ? 'high' : 'normal',
                },
                {
                  tip: 'Set your preferences',
                  desc: 'Tell Nova how you like responses formatted and what tone to use.',
                  priority: stats.totalMemories < 3 ? 'high' : 'normal',
                },
                {
                  tip: 'Have more conversations',
                  desc: 'Regular chat interactions help Nova understand your patterns.',
                  priority: stats.totalConversations < 5 ? 'normal' : 'low',
                },
                {
                  tip: 'Teach Nova specialized skills',
                  desc: 'Narrow, focused skills work better than broad, generic ones.',
                  priority: 'normal',
                },
              ]
                .filter((t) => t.priority !== 'low')
                .map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-border/50 bg-secondary/20 p-3"
                  >
                    <div
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                        item.priority === 'high' ? 'bg-amber-400' : 'bg-primary'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium">{item.tip}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
