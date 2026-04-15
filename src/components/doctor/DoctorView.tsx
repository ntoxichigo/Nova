'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCode2,
  RefreshCw,
  ShieldCheck,
  Wrench,
  Workflow,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DoctorCheck, DoctorRunResult } from '@/lib/doctor/types';

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function statusBadgeVariant(status: DoctorCheck['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'pass') return 'default';
  if (status === 'warn') return 'secondary';
  return 'destructive';
}

function statusTone(status: DoctorCheck['status']): string {
  if (status === 'pass') return 'border-emerald-500/30 bg-emerald-500/5';
  if (status === 'warn') return 'border-amber-500/30 bg-amber-500/5';
  return 'border-red-500/30 bg-red-500/5';
}

function checkIcon(checkId: string) {
  switch (checkId) {
    case 'provider-ping':
      return <Activity className="h-4 w-4 text-primary" />;
    case 'stream-test':
      return <Workflow className="h-4 w-4 text-cyan-400" />;
    case 'tool-call-test':
      return <Wrench className="h-4 w-4 text-amber-400" />;
    case 'project-create-test':
      return <FileCode2 className="h-4 w-4 text-violet-400" />;
    case 'preview-test':
      return <Eye className="h-4 w-4 text-emerald-400" />;
    default:
      return <ShieldCheck className="h-4 w-4 text-muted-foreground" />;
  }
}

function detailEntries(details?: Record<string, unknown>) {
  if (!details) return [] as Array<[string, unknown]>;
  return Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== '');
}

export function DoctorView() {
  const [result, setResult] = useState<DoctorRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDoctor = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/doctor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object' || !Array.isArray((data as DoctorRunResult).checks)) {
        throw new Error('Doctor did not return a valid diagnostics payload.');
      }

      setResult(data as DoctorRunResult);
      if (!res.ok && !(data as DoctorRunResult).checks.length) {
        throw new Error('Doctor failed before completing any checks.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Doctor run failed.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runDoctor();
  }, [runDoctor]);

  const counts = useMemo(() => {
    const checks = result?.checks || [];
    return {
      pass: checks.filter((check) => check.status === 'pass').length,
      warn: checks.filter((check) => check.status === 'warn').length,
      fail: checks.filter((check) => check.status === 'fail').length,
    };
  }, [result]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-4 lg:grid-cols-[1.6fr_1fr]"
        >
          <Card className="border-primary/20 bg-card/90">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={result ? statusBadgeVariant(result.overallStatus) : 'outline'}>
                  {result ? result.overallStatus.toUpperCase() : 'READY'}
                </Badge>
                {result && (
                  <>
                    <Badge variant="outline">{result.config.provider}</Badge>
                    {result.config.model && <Badge variant="outline">{result.config.model}</Badge>}
                    <Badge variant="outline">{result.config.profile}</Badge>
                  </>
                )}
              </div>
              <div>
                <CardTitle className="text-xl">Doctor</CardTitle>
                <CardDescription>
                  One place to verify the Nova generation path: provider, stream, tool parsing, project creation, and preview containment.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pass</div>
                  <div className="mt-2 text-2xl font-semibold">{counts.pass}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Warn</div>
                  <div className="mt-2 text-2xl font-semibold">{counts.warn}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Fail</div>
                  <div className="mt-2 text-2xl font-semibold">{counts.fail}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void runDoctor()} disabled={loading}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                  {loading ? 'Running Doctor...' : 'Run Full Diagnostic'}
                </Button>
                {result && (
                  <span className="text-sm text-muted-foreground">
                    Last run {new Date(result.ranAt).toLocaleString()} in {formatDuration(result.durationMs)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runtime Profile</CardTitle>
              <CardDescription>The active model budget Doctor used for this run.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Provider</span>
                <span className="font-medium">{result?.config.provider || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Model</span>
                <span className="truncate font-medium">{result?.config.model || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Profile</span>
                <span className="font-medium">{result?.config.profile || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Operating Profile</span>
                <span className="font-medium">{result?.config.operatingProfile || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Automation Mode</span>
                <span className="font-medium">{result?.config.automationMode || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Max Tokens</span>
                <span className="font-medium">{result?.config.maxTokens ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Context Window</span>
                <span className="font-medium">{result?.config.contextWindow ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Quality Mode</span>
                <span className="font-medium">{result?.config.qualityMode || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Autonomy</span>
                <span className="font-medium">{result?.config.autonomyProfile || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Router</span>
                <span className="font-medium">{result?.config.routerEnabled ? 'On' : 'Off'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Scoped Agents</span>
                <span className="font-medium">{result?.config.scopedAgentsEnabled ? 'On' : 'Off'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-muted-foreground">Telemetry</span>
                <span className="font-medium">{result?.config.tokenTelemetryEnabled ? 'On' : 'Off'}</span>
              </div>
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Routes</div>
                <div className="mt-2 text-sm font-medium break-words">{result?.config.routeSummary || '-'}</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Doctor run failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && result.overallStatus !== 'pass' && (
          <Alert variant={result.overallStatus === 'fail' ? 'destructive' : 'default'}>
            {result.overallStatus === 'fail'
              ? <AlertTriangle className="h-4 w-4" />
              : <ShieldCheck className="h-4 w-4" />}
            <AlertTitle>
              {result.overallStatus === 'fail' ? 'Flaws found in the runtime path' : 'Warnings detected'}
            </AlertTitle>
            <AlertDescription>
              Doctor completed, but at least one part of the website-generation chain still needs attention.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {(result?.checks || []).map((check) => (
            <motion.div
              key={check.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className={cn('h-full border', statusTone(check.status))}>
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {checkIcon(check.id)}
                      <CardTitle className="text-base">{check.label}</CardTitle>
                    </div>
                    <Badge variant={statusBadgeVariant(check.status)}>{check.status}</Badge>
                  </div>
                  <CardDescription>{check.summary}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {formatDuration(check.durationMs)}
                  </div>
                  {detailEntries(check.details).length > 0 && (
                    <pre className="max-h-72 overflow-auto rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                      {JSON.stringify(check.details, null, 2)}
                    </pre>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {(result?.telemetry || result?.latestEval) && (
          <div className="grid gap-4 xl:grid-cols-2">
            {result.telemetry && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Orchestration Telemetry</CardTitle>
                  <CardDescription>Recent token and routing traces captured from real runs.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Runs</div>
                      <div className="mt-2 text-2xl font-semibold">{result.telemetry.totalRuns}</div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Avg Prompt</div>
                      <div className="mt-2 text-2xl font-semibold">{result.telemetry.avgPromptTokens}</div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Avg Output</div>
                      <div className="mt-2 text-2xl font-semibold">{result.telemetry.avgOutputTokens}</div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Top Mode</div>
                      <div className="mt-2 text-2xl font-semibold">{result.telemetry.topTaskMode || '-'}</div>
                    </div>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                    {JSON.stringify(result.telemetry, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}

            {result.latestEval && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Latest Eval</CardTitle>
                  <CardDescription>Deterministic checks for routing, context packing, and autonomy profiles.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={result.latestEval.overallStatus === 'pass' ? 'default' : 'destructive'}>
                      {result.latestEval.overallStatus.toUpperCase()}
                    </Badge>
                    <Badge variant="outline">{result.latestEval.passCount} pass</Badge>
                    <Badge variant="outline">{result.latestEval.failCount} fail</Badge>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                    {JSON.stringify(result.latestEval, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {!loading && result?.checks.length === 0 && (
          <Card>
            <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              No diagnostics have run yet.
            </CardContent>
          </Card>
        )}

        {!result && loading && (
          <Card>
            <CardContent className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Running Doctor checks...
            </CardContent>
          </Card>
        )}

        {result?.overallStatus === 'pass' && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <AlertTitle>Golden path looks healthy</AlertTitle>
            <AlertDescription>
              Provider, stream, tool parsing, project creation, and preview containment all passed in this run.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
