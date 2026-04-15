'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Cpu,
  FileCode2,
  Lock,
  Radar,
  RefreshCw,
  Settings2,
  TerminalSquare,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';

interface CountItem {
  name: string;
  count: number;
}

interface OpsResponse {
  snapshotAt: string;
  runtime: {
    provider: string;
    model: string;
    operatingProfile: string;
    automationMode: string;
    workspaceRootConfigured: boolean;
    chatPowerMode: string;
    chatPermissionMode: string;
    chatSpeedMode: string;
    autonomyProfile: string;
    routerEnabled: boolean;
    scopedAgentsEnabled: boolean;
    tokenTelemetryEnabled: boolean;
    connections: string[];
  };
  live: {
    activeCommands: number;
    activeExecutions: number;
    pendingReviews: number;
    blockedActions24h: number;
    recentErrors: number;
    enabledTasks: number;
  };
  chat: {
    assistantTurns: number;
    avgLatencyMs: number;
    avgTokens: number;
    topModels: CountItem[];
    topTools: CountItem[];
  };
  ide: {
    recentProjects: Array<{
      id: string;
      name: string;
      description: string;
      updatedAt: string;
      files: number;
      commands: number;
      executions: number;
    }>;
    topIdeTools: CountItem[];
    recentCommands: Array<{
      id: string;
      command: string;
      status: string;
      exitCode?: number | null;
      duration?: number | null;
      createdAt: string;
      projectName: string;
    }>;
    recentExecutions: Array<{
      id: string;
      status: string;
      duration?: number | null;
      createdAt: string;
      projectName: string;
    }>;
  };
  automation: {
    totalTasks: number;
    enabledTasks: number;
    recentlyActiveTasks: number;
    tasks: Array<{
      id: string;
      name: string;
      enabled: boolean;
      channel: string;
      cronExpr: string;
      lastRunAt: string | null;
      lastResult: string;
    }>;
  };
  operatingSystem: {
    pillars: Array<{
      id: string;
      label: string;
      status: 'ready' | 'partial' | 'attention';
      summary: string;
    }>;
  };
  memoryUsage: Array<{
    id: string;
    createdAt: string;
    summary: string;
    memoryScope: string;
    memoryUsed: Array<{
      type: string;
      content: string;
      source?: string;
    }>;
  }>;
  activityFeed: Array<{
    id: string;
    lane: string;
    title: string;
    status: string;
    subtitle: string;
    createdAt: string;
    details?: Record<string, unknown>;
  }>;
  recommendations: string[];
}

function formatTime(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(value?: number | null) {
  if (!value || value <= 0) return 'n/a';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['success', 'pass', 'ready', 'enabled', 'approved'].includes(status)) return 'default';
  if (['partial', 'warning', 'warn', 'review_required', 'running', 'pending'].includes(status)) return 'secondary';
  if (['error', 'blocked', 'attention', 'rejected'].includes(status)) return 'destructive';
  return 'outline';
}

export function OpsView() {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [data, setData] = useState<OpsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ops/overview', { cache: 'no-store' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || typeof payload !== 'object') {
        throw new Error(payload?.error || 'Failed to load ops overview.');
      }
      setData(payload as OpsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ops overview.');
    } finally {
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const health = useMemo(() => {
    if (!data) return 'partial';
    if (data.live.recentErrors > 0 || data.live.blockedActions24h > 8) return 'attention';
    if (data.live.pendingReviews > 0 || data.live.activeCommands > 0 || data.live.activeExecutions > 0) return 'partial';
    return 'ready';
  }, [data]);

  if (loading && !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          <Skeleton className="h-12 w-72" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-32 rounded-xl bg-secondary/30" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl bg-secondary/30" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Radar className="h-6 w-6 text-primary" />
              Ops
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Run Nova like an operator: watch live work, runtime posture, orchestration signals, IDE activity, and automation health from one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(health)}>{health}</Badge>
            {data?.snapshotAt && <Badge variant="outline">Updated {formatTime(data.snapshotAt)}</Badge>}
            <Button variant="outline" size="sm" onClick={() => void load(true)} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-4 text-sm text-red-200">{error}</CardContent>
          </Card>
        )}

        {data && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {[
                { label: 'Active Commands', value: data.live.activeCommands, icon: <TerminalSquare className="h-5 w-5 text-primary" /> },
                { label: 'Active Runs', value: data.live.activeExecutions, icon: <FileCode2 className="h-5 w-5 text-cyan-400" /> },
                { label: 'Pending Reviews', value: data.live.pendingReviews, icon: <Lock className="h-5 w-5 text-orange-400" /> },
                { label: 'Blocked Actions', value: data.live.blockedActions24h, icon: <AlertTriangle className="h-5 w-5 text-amber-400" /> },
                { label: 'Recent Errors', value: data.live.recentErrors, icon: <Activity className="h-5 w-5 text-red-400" /> },
                { label: 'Enabled Tasks', value: data.live.enabledTasks, icon: <Clock3 className="h-5 w-5 text-emerald-400" /> },
              ].map((item, index) => (
                <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
                  <Card className="border-border/50 bg-card/90">
                    <CardContent className="flex items-center justify-between p-5">
                      <div>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-2xl font-bold">{item.value}</p>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/40">
                        {item.icon}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cpu className="h-4 w-4 text-primary" />
                    Runtime Posture
                  </CardTitle>
                  <CardDescription>The live operating stance of Nova across chat, orchestration, and automation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{data.runtime.provider}</Badge>
                    {data.runtime.model && <Badge variant="outline">{data.runtime.model}</Badge>}
                    <Badge variant="outline">profile: {data.runtime.operatingProfile}</Badge>
                    <Badge variant="outline">automation: {data.runtime.automationMode}</Badge>
                    <Badge variant="outline">chat: {data.runtime.chatPowerMode}</Badge>
                    <Badge variant="outline">speed: {data.runtime.chatSpeedMode}</Badge>
                    <Badge variant="outline">permissions: {data.runtime.chatPermissionMode}</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ['Workspace root', data.runtime.workspaceRootConfigured ? 'ready' : 'attention', data.runtime.workspaceRootConfigured ? 'Configured and available for file-backed execution.' : 'Not configured yet.'],
                      ['Router', data.runtime.routerEnabled ? 'ready' : 'attention', data.runtime.routerEnabled ? 'Stage-aware routing is on.' : 'Single-track model behavior only.'],
                      ['Scoped agents', data.runtime.scopedAgentsEnabled ? 'ready' : 'partial', data.runtime.scopedAgentsEnabled ? 'Planner/verifier passes are enabled.' : 'Specialists are disabled.'],
                      ['Telemetry', data.runtime.tokenTelemetryEnabled ? 'ready' : 'partial', data.runtime.tokenTelemetryEnabled ? 'Token and orchestration traces are being recorded.' : 'Observability is lighter than recommended.'],
                    ].map(([label, status, summary]) => (
                      <div key={String(label)} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{label}</p>
                          <Badge variant={statusVariant(String(status))}>{status}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{summary}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {data.runtime.connections.length > 0 ? data.runtime.connections.map((service) => (
                      <Badge key={service} variant="secondary">{service}</Badge>
                    )) : <p className="text-sm text-muted-foreground">No external accounts connected.</p>}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Workflow className="h-4 w-4 text-primary" />
                    Operating Pillars
                  </CardTitle>
                  <CardDescription>High-level readiness of the four system pillars you want Nova to master.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.operatingSystem.pillars.map((pillar) => (
                    <div key={pillar.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{pillar.label}</p>
                        <Badge variant={statusVariant(pillar.status)}>{pillar.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{pillar.summary}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="h-4 w-4 text-primary" />
                    Chat + Model Signals
                  </CardTitle>
                  <CardDescription>How the model layer is behaving across recent assistant turns.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Assistant turns</p>
                      <p className="mt-1 text-2xl font-bold">{data.chat.assistantTurns}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Avg latency</p>
                      <p className="mt-1 text-2xl font-bold">{data.chat.avgLatencyMs || 0} ms</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Avg tokens</p>
                      <p className="mt-1 text-2xl font-bold">{data.chat.avgTokens || 0}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Top Models</p>
                      {data.chat.topModels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No recent model telemetry yet.</p>
                      ) : (
                        data.chat.topModels.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                            <span className="truncate text-sm">{item.name}</span>
                            <Badge variant="outline">{item.count}</Badge>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Top Chat Tools</p>
                      {data.chat.topTools.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No recent chat tool calls recorded.</p>
                      ) : (
                        data.chat.topTools.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                            <span className="truncate text-sm">{item.name}</span>
                            <Badge variant="outline">{item.count}</Badge>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TerminalSquare className="h-4 w-4 text-primary" />
                    IDE Signals
                  </CardTitle>
                  <CardDescription>Recent project, command, execution, and tool activity from the IDE side.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Top IDE Tools</p>
                    {data.ide.topIdeTools.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent IDE tool usage yet.</p>
                    ) : (
                      data.ide.topIdeTools.map((item) => (
                        <div key={item.name} className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                          <span className="truncate text-sm">{item.name}</span>
                          <Badge variant="outline">{item.count}</Badge>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setActiveView('scripts')} className="gap-2">
                      <FileCode2 className="h-4 w-4" />
                      Open IDE
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setActiveView('doctor')} className="gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Run Doctor
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Memory Used This Turn</CardTitle>
                <CardDescription>Recent memory context that was injected into model turns for debugging and routing validation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.memoryUsage.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent memory usage events recorded.</p>
                ) : (
                  data.memoryUsage.map((event) => (
                    <div key={event.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{event.summary || 'Memory context used'}</p>
                        <Badge variant="outline">{event.memoryScope || 'unknown-scope'}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatTime(event.createdAt)}</p>
                      <div className="mt-2 space-y-1">
                        {event.memoryUsed.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No memory entries attached.</p>
                        ) : (
                          event.memoryUsed.slice(0, 6).map((entry, index) => (
                            <div key={`${event.id}-${entry.type}-${index}`} className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5 text-xs">
                              <span className="mr-2 uppercase tracking-wide text-muted-foreground">{entry.type}</span>
                              <span className="text-foreground/90">{entry.content}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Activity Feed</CardTitle>
                  <CardDescription>Audit, command, and execution events merged into one operational timeline.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.activityFeed.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent operational events yet.</p>
                  ) : (
                    data.activityFeed.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.subtitle}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{item.lane}</Badge>
                            <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{formatTime(item.createdAt)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="border-border/50 bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recent Projects</CardTitle>
                    <CardDescription>The latest IDE workspaces and how active they have been.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {data.ide.recentProjects.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No IDE projects yet.</p>
                    ) : (
                      data.ide.recentProjects.map((project) => (
                        <div key={project.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium">{project.name}</p>
                            <Badge variant="outline">{project.files} files</Badge>
                          </div>
                          {project.description && <p className="mt-2 text-xs text-muted-foreground">{project.description}</p>}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {project.commands} commands · {project.executions} runs · updated {formatTime(project.updatedAt)}
                          </p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Automation</CardTitle>
                    <CardDescription>Scheduled task posture and recent background activity.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{data.automation.enabledTasks}/{data.automation.totalTasks} enabled</Badge>
                      <Badge variant="outline">{data.automation.recentlyActiveTasks} active in last 24h</Badge>
                    </div>
                    {data.automation.tasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No scheduled tasks configured.</p>
                    ) : (
                      data.automation.tasks.map((task) => (
                        <div key={task.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium">{task.name}</p>
                            <Badge variant={task.enabled ? 'default' : 'secondary'}>{task.enabled ? 'enabled' : 'disabled'}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{task.channel} · {task.cronExpr}</p>
                          <p className="mt-2 text-xs text-muted-foreground">Last run: {formatTime(task.lastRunAt)}</p>
                          {task.lastResult && <p className="mt-2 text-xs text-muted-foreground">{task.lastResult}</p>}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Settings2 className="h-4 w-4 text-primary" />
                      Operator Advice
                    </CardTitle>
                    <CardDescription>High-leverage next moves generated from the current system posture.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {data.recommendations.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No urgent operator corrections right now.</p>
                    ) : (
                      data.recommendations.map((item) => (
                        <div key={item} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm">
                          {item}
                        </div>
                      ))
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setActiveView('settings')}>Settings</Button>
                      <Button variant="outline" size="sm" onClick={() => setActiveView('dashboard')}>Mission Control</Button>
                      <Button variant="outline" size="sm" onClick={() => setActiveView('doctor')}>Doctor</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Recent Commands</CardTitle>
                  <CardDescription>The latest workspace shell actions triggered in the IDE.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.ide.recentCommands.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent IDE commands.</p>
                  ) : (
                    data.ide.recentCommands.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium">{item.command}</p>
                          <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.projectName} · {formatDuration(item.duration)} · exit {item.exitCode ?? 'n/a'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatTime(item.createdAt)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Recent Executions</CardTitle>
                  <CardDescription>The latest file or project runs from the IDE execution pipeline.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.ide.recentExecutions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent IDE executions.</p>
                  ) : (
                    data.ide.recentExecutions.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{item.projectName}</p>
                          <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDuration(item.duration)} · {formatTime(item.createdAt)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
