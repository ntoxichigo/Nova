'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock3,
  FileCode2,
  GraduationCap,
  LayoutDashboard,
  Lock,
  MessageSquare,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/app-store';

type PolicyMode = 'allow' | 'review' | 'block';
type PolicyCategory = 'filesystem' | 'integrations' | 'mcp' | 'automation';

interface MissionPolicy {
  defaultMode: PolicyMode;
  categories: Record<PolicyCategory, PolicyMode>;
  toolOverrides: Record<string, PolicyMode>;
}

interface MissionEvent {
  id: string;
  source: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  status: string;
  severity: string;
  summary: string;
  details: Record<string, unknown>;
  conversationId?: string | null;
  createdAt: string;
}

interface MissionNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  createdAt: string;
  status?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

interface MissionMapResponse {
  counts: {
    skills: number;
    knowledge: number;
    memories: number;
    notes: number;
    conversations: number;
    tasks: number;
    projects: number;
    facts: number;
    pendingReviews: number;
    blockedActions: number;
    failingTasks: number;
  };
  highlights: {
    hotEntities: Array<{ name: string; mentions: number }>;
    activeSkills: number;
    recentFailures: Array<{
      id: string;
      summary: string;
      source: string;
      status: string;
      createdAt: string;
    }>;
  };
  nodes: MissionNode[];
  relations: Array<{
    id: string;
    subject: string;
    relation: string;
    object: string;
    createdAt: string;
  }>;
}

interface ToolCatalogItem {
  name: string;
  description: string;
  source: 'builtin' | 'mcp';
  server?: string;
}

interface OperatingPillar {
  id: string;
  label: string;
  status: 'ready' | 'partial' | 'attention';
  summary: string;
}

interface OperatingSystemState {
  selectedProfile: string;
  automationMode: string;
  pillars: OperatingPillar[];
  projectsCount: number;
  scheduledTasksCount: number;
  enabledTasksCount: number;
  workspaceRootConfigured: boolean;
  recommendations: string[];
}

const defaultPolicy: MissionPolicy = {
  defaultMode: 'allow',
  categories: {
    filesystem: 'review',
    integrations: 'review',
    mcp: 'review',
    automation: 'allow',
  },
  toolOverrides: {},
};

const kindFilters = ['all', 'knowledge', 'memory', 'fact', 'conversation', 'script', 'task', 'event', 'skill', 'note'];

function formatTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTone(status?: string) {
  if (!status) return 'secondary';
  if (status === 'success' || status === 'approved' || status === 'active' || status === 'enabled') return 'default';
  if (status === 'review_required' || status === 'blocked' || status === 'error') return 'destructive';
  return 'secondary';
}

function typeIcon(type: string) {
  switch (type) {
    case 'knowledge':
      return <Brain className="h-4 w-4 text-amber-400" />;
    case 'memory':
      return <Sparkles className="h-4 w-4 text-pink-400" />;
    case 'conversation':
      return <MessageSquare className="h-4 w-4 text-primary" />;
    case 'script':
      return <FileCode2 className="h-4 w-4 text-cyan-400" />;
    case 'task':
      return <Clock3 className="h-4 w-4 text-emerald-400" />;
    case 'event':
      return <Shield className="h-4 w-4 text-orange-400" />;
    case 'fact':
      return <Activity className="h-4 w-4 text-blue-400" />;
    default:
      return <LayoutDashboard className="h-4 w-4 text-muted-foreground" />;
  }
}

export function DashboardView() {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [loading, setLoading] = useState(true);
  const [map, setMap] = useState<MissionMapResponse | null>(null);
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [policy, setPolicy] = useState<MissionPolicy>(defaultPolicy);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [savingCategory, setSavingCategory] = useState<PolicyCategory | null>(null);
  const [savingToolOverride, setSavingToolOverride] = useState(false);
  const [newToolOverrideName, setNewToolOverrideName] = useState('');
  const [newToolOverrideMode, setNewToolOverrideMode] = useState<PolicyMode>('review');
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([]);
  const [operatingSystem, setOperatingSystem] = useState<OperatingSystemState | null>(null);
  const [resolvingReviewId, setResolvingReviewId] = useState<string | null>(null);

  async function loadMissionControl() {
    setLoading(true);
    try {
      const [mapRes, eventsRes, policyRes, toolsRes, operatingRes] = await Promise.all([
        fetch('/api/intelligence/map'),
        fetch('/api/audit/events?limit=40'),
        fetch('/api/policies'),
        fetch('/api/tools/catalog'),
        fetch('/api/operating-system'),
      ]);

      if (mapRes.ok) {
        setMap(await mapRes.json());
      }
      if (eventsRes.ok) {
        setEvents(await eventsRes.json());
      }
      if (policyRes.ok) {
        setPolicy(await policyRes.json());
      }
      if (toolsRes.ok) {
        const payload = await toolsRes.json();
        setToolCatalog(Array.isArray(payload.tools) ? payload.tools : []);
      }
      if (operatingRes.ok) {
        const payload = await operatingRes.json();
        setOperatingSystem(payload.state || null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMissionControl();
  }, []);

  async function updatePolicy(category: PolicyCategory, mode: PolicyMode) {
    const nextPolicy: MissionPolicy = {
      ...policy,
      categories: {
        ...policy.categories,
        [category]: mode,
      },
    };

    setSavingCategory(category);
    setPolicy(nextPolicy);

    try {
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPolicy),
      });

      if (res.ok) {
        setPolicy(await res.json());
        await loadMissionControl();
      }
    } finally {
      setSavingCategory(null);
    }
  }

  async function saveToolOverride(toolNameRaw: string, mode: PolicyMode | null) {
    const toolName = toolNameRaw.trim();
    if (!toolName) return;

    const nextOverrides = { ...(policy.toolOverrides || {}) };
    if (mode === null) {
      delete nextOverrides[toolName];
    } else {
      nextOverrides[toolName] = mode;
    }

    const nextPolicy: MissionPolicy = {
      ...policy,
      toolOverrides: nextOverrides,
    };

    setSavingToolOverride(true);
    setPolicy(nextPolicy);
    try {
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPolicy),
      });

      if (res.ok) {
        setPolicy(await res.json());
        await loadMissionControl();
      }
    } finally {
      setSavingToolOverride(false);
    }
  }

  async function resolveReview(id: string, decision: 'approve' | 'reject') {
    setResolvingReviewId(id);
    try {
      await fetch(`/api/audit/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      await loadMissionControl();
    } finally {
      setResolvingReviewId(null);
    }
  }

  if (loading || !map) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          <Skeleton className="h-10 w-56" />
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

  const filteredNodes = map.nodes.filter((node) => {
    if (kindFilter !== 'all' && node.type !== kindFilter) return false;
    if (!search.trim()) return true;
    const query = search.trim().toLowerCase();
    return [node.title, node.summary, node.type, ...(node.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const pendingReviews = events.filter((event) => event.status === 'review_required');
  const filteredToolSuggestions = newToolOverrideName.trim()
    ? toolCatalog
      .filter((tool) => {
        const q = newToolOverrideName.toLowerCase();
        return tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q);
      })
      .slice(0, 8)
    : toolCatalog.slice(0, 8);
  const quickActions = [
    {
      label: 'Teach Nova',
      description: 'Add skills, knowledge, or user preferences.',
      view: 'teach' as const,
      icon: <GraduationCap className="h-4 w-4" />,
    },
    {
      label: 'Inspect Scripts',
      description: 'Open the IDE and review active project work.',
      view: 'scripts' as const,
      icon: <FileCode2 className="h-4 w-4" />,
    },
    {
      label: 'Refine Skills',
      description: 'Tune routing and capability coverage.',
      view: 'skills' as const,
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      label: 'Open Settings',
      description: 'Adjust providers, integrations, and automation.',
      view: 'settings' as const,
      icon: <Shield className="h-4 w-4" />,
    },
    {
      label: 'Open Ops',
      description: 'Watch live runtime, IDE, and automation signals.',
      view: 'ops' as const,
      icon: <Activity className="h-4 w-4" />,
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Shield className="h-6 w-6 text-primary" />
              Mission Control
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Track what Nova knows, what it changed, and which actions need approval before they run.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadMissionControl()} className="gap-2 self-start">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Active Skills', value: map.highlights.activeSkills, subtitle: `${map.counts.skills} total`, icon: <Sparkles className="h-5 w-5 text-emerald-400" /> },
            { label: 'Knowledge Nodes', value: map.counts.knowledge + map.counts.memories + map.counts.facts, subtitle: `${map.counts.notes} notes`, icon: <Brain className="h-5 w-5 text-amber-400" /> },
            { label: 'Projects + Tasks', value: map.counts.projects + map.counts.tasks, subtitle: `${map.counts.tasks} scheduled`, icon: <FileCode2 className="h-5 w-5 text-cyan-400" /> },
            { label: 'Pending Reviews', value: map.counts.pendingReviews, subtitle: `${map.counts.blockedActions} blocked`, icon: <Lock className="h-5 w-5 text-orange-400" /> },
            { label: 'Recent Conversations', value: map.counts.conversations, subtitle: `${map.counts.failingTasks} failing tasks`, icon: <MessageSquare className="h-5 w-5 text-primary" /> },
          ].map((item, index) => (
            <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              <Card className="border-border/50 bg-card/90">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-2xl font-bold">{item.value}</p>
                    <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/40">
                    {item.icon}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="grid w-full grid-cols-3 bg-secondary/50 p-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence Map</TabsTrigger>
            <TabsTrigger value="trust">Trust Center</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {operatingSystem && (
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Operating System
                  </CardTitle>
                  <CardDescription>
                    Nova is strongest when the workspace, runtime controls, model orchestration, and automation all align as one operating posture.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Profile: {operatingSystem.selectedProfile}</Badge>
                    <Badge variant="outline">Automation: {operatingSystem.automationMode}</Badge>
                    <Badge variant="outline">{operatingSystem.projectsCount} IDE projects</Badge>
                    <Badge variant="outline">{operatingSystem.enabledTasksCount}/{operatingSystem.scheduledTasksCount} automation tasks enabled</Badge>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    {operatingSystem.pillars.map((pillar) => (
                      <div key={pillar.id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{pillar.label}</p>
                          <Badge variant={pillar.status === 'ready' ? 'default' : pillar.status === 'partial' ? 'secondary' : 'destructive'}>
                            {pillar.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{pillar.summary}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr]">
                    <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/10 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next corrections</p>
                      {operatingSystem.recommendations.length === 0 ? (
                        <p className="text-sm text-emerald-300">This operating posture is aligned. The next gains are depth and polish, not missing foundations.</p>
                      ) : (
                        operatingSystem.recommendations.slice(0, 4).map((item) => (
                          <div key={item} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm">
                            {item}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="grid gap-3">
                      <Button variant="outline" onClick={() => setActiveView('settings')} className="justify-start gap-2">
                        <Shield className="h-4 w-4" />
                        Tune Operating Profile
                      </Button>
                      <Button variant="outline" onClick={() => setActiveView('doctor')} className="justify-start gap-2">
                        <Activity className="h-4 w-4" />
                        Verify In Doctor
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4 text-primary" />
                    Hot Entities
                  </CardTitle>
                  <CardDescription>What keeps surfacing across memory and relations.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {map.highlights.hotEntities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No relation hotspots yet. More conversation and teaching will make this richer.</p>
                  ) : (
                    map.highlights.hotEntities.map((entity) => (
                      <div key={entity.name} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <div>
                          <p className="text-sm font-medium">{entity.name}</p>
                          <p className="text-xs text-muted-foreground">Seen in {entity.mentions} relation nodes</p>
                        </div>
                        <Badge variant="secondary">{entity.mentions}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-4 w-4 text-primary" />
                    Friction Signals
                  </CardTitle>
                  <CardDescription>Recent blocked or failing actions across the system.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {map.highlights.recentFailures.length === 0 ? (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                      No recent failures. Mission posture looks healthy.
                    </div>
                  ) : (
                    map.highlights.recentFailures.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{item.summary}</p>
                          <Badge variant={statusTone(item.status)}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.source} | {formatTime(item.createdAt)}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  Quick Actions
                </CardTitle>
                <CardDescription>High leverage next steps to expand Nova cleanly.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => setActiveView(action.view)}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {action.icon}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{action.label}</p>
                      <p className="text-xs text-muted-foreground">{action.description}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="intelligence" className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search memories, knowledge, projects, tasks, and audit events"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {kindFilters.map((item) => (
                  <button
                    key={item}
                    onClick={() => setKindFilter(item)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      kindFilter === item
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {item === 'all' ? 'All' : item}
                  </button>
                ))}
              </div>
            </div>

            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Live Relation Feed</CardTitle>
                <CardDescription>Structured facts Nova has extracted from interaction history.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {map.relations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No graph relations extracted yet.</p>
                ) : (
                  map.relations.map((relation) => (
                    <Badge key={relation.id} variant="secondary" className="rounded-full px-3 py-1">
                      {relation.subject} {relation.relation} {relation.object}
                    </Badge>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {filteredNodes.map((node) => (
                <Card key={`${node.type}-${node.id}`} className="border-border/50 bg-card">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/40">
                          {typeIcon(node.type)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{node.title}</p>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{node.type}</p>
                        </div>
                      </div>
                      {node.status ? <Badge variant={statusTone(node.status)}>{node.status}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{node.summary}</p>
                    <div className="flex flex-wrap gap-2">
                      {(node.tags || []).slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatTime(node.createdAt)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {filteredNodes.length === 0 ? (
              <Card className="border-border/50 bg-card">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No intelligence nodes match this filter yet.
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="trust" className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {(
                [
                  ['filesystem', 'Filesystem writes'],
                  ['integrations', 'Private integrations'],
                  ['mcp', 'MCP tools'],
                  ['automation', 'Automation runs'],
                ] as Array<[PolicyCategory, string]>
              ).map(([category, label]) => (
                <Card key={category} className="border-border/50 bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base capitalize">{label}</CardTitle>
                    <CardDescription>Current Mission Control gate for {category} actions.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Select
                      value={policy.categories[category]}
                      onValueChange={(value: PolicyMode) => void updatePolicy(category, value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="allow">Allow</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                        <SelectItem value="block">Block</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {savingCategory === category ? 'Saving policy...' : `Mode: ${policy.categories[category]}`}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tool-Level Overrides</CardTitle>
                <CardDescription>
                  Set exact rules per tool (for example: <code className="font-mono">mcp__github__create_pr</code>).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                  <Input
                    value={newToolOverrideName}
                    onChange={(event) => setNewToolOverrideName(event.target.value)}
                    placeholder="Tool name (exact)"
                  />
                  <Select value={newToolOverrideMode} onValueChange={(value: PolicyMode) => setNewToolOverrideMode(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="block">Block</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => void saveToolOverride(newToolOverrideName, newToolOverrideMode)}
                    disabled={savingToolOverride || !newToolOverrideName.trim()}
                  >
                    {savingToolOverride ? 'Saving...' : 'Add Override'}
                  </Button>
                </div>
                {filteredToolSuggestions.length > 0 ? (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-2">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Suggestions</p>
                    <div className="grid gap-1">
                      {filteredToolSuggestions.map((tool) => (
                        <button
                          key={tool.name}
                          type="button"
                          onClick={() => setNewToolOverrideName(tool.name)}
                          className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-secondary/60"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs">{tool.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{tool.description}</p>
                          </div>
                          <Badge variant="secondary" className="shrink-0">
                            {tool.source === 'mcp' ? `mcp${tool.server ? `:${tool.server}` : ''}` : 'builtin'}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Object.keys(policy.toolOverrides || {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tool overrides yet. Category rules are currently in effect.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(policy.toolOverrides)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([toolName, mode]) => (
                        <div key={toolName} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs">{toolName}</p>
                            <p className="text-xs text-muted-foreground">Mode: {mode}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={mode}
                              onValueChange={(value: PolicyMode) => void saveToolOverride(toolName, value)}
                            >
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="allow">Allow</SelectItem>
                                <SelectItem value="review">Review</SelectItem>
                                <SelectItem value="block">Block</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={savingToolOverride}
                              onClick={() => void saveToolOverride(toolName, null)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="h-4 w-4 text-primary" />
                  Pending Reviews
                </CardTitle>
                <CardDescription>Actions Nova proposed but did not run without your approval.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingReviews.length === 0 ? (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                    No pending reviews. High-risk actions are currently under control.
                  </div>
                ) : (
                  pendingReviews.map((event) => (
                    <div key={event.id} className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-medium">{event.summary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {event.details.reason ? String(event.details.reason) : 'Mission Control flagged this action for review.'}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {event.source} | {formatTime(event.createdAt)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resolvingReviewId === event.id}
                            onClick={() => void resolveReview(event.id, 'reject')}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            disabled={resolvingReviewId === event.id}
                            onClick={() => void resolveReview(event.id, 'approve')}
                          >
                            {resolvingReviewId === event.id ? 'Working...' : 'Approve'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Audit Timeline
                </CardTitle>
                <CardDescription>The last 40 high-level system events across chat, settings, scripts, MCP, and automation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{event.summary}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {event.source} | {event.action} | {formatTime(event.createdAt)}
                        </p>
                      </div>
                      <Badge variant={statusTone(event.status)}>{event.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
