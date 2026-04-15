import type { EvalRunResult, OrchestrationTelemetrySummary } from '@/lib/orchestration/types';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface DoctorRunResult {
  ranAt: string;
  durationMs: number;
  overallStatus: DoctorCheckStatus;
  checks: DoctorCheck[];
  config: {
    provider: string;
    model: string;
    profile: string;
    operatingProfile?: string;
    automationMode?: string;
    maxTokens?: number;
    contextWindow?: number;
    qualityMode?: string;
    autonomyProfile?: string;
    routerEnabled?: boolean;
    scopedAgentsEnabled?: boolean;
    tokenTelemetryEnabled?: boolean;
    routeSummary?: string;
  };
  telemetry?: OrchestrationTelemetrySummary;
  latestEval?: EvalRunResult | null;
}
