import type { LLMConfig } from '@/lib/llm/types';

export type AutonomyProfileId =
  | 'safe'
  | 'builder'
  | 'hands-free'
  | 'reviewer'
  | 'research';

export type TaskMode =
  | 'chat'
  | 'coding'
  | 'build'
  | 'debug'
  | 'review'
  | 'research';

export type SpecialistStage =
  | 'main'
  | 'planner'
  | 'coder'
  | 'researcher'
  | 'verifier';

export interface OrchestrationSettings {
  autonomyProfile: AutonomyProfileId;
  routerEnabled: boolean;
  scopedAgentsEnabled: boolean;
  tokenTelemetryEnabled: boolean;
  plannerModel?: string;
  coderModel?: string;
  verifierModel?: string;
  researchModel?: string;
  fastModel?: string;
  strongModel?: string;
  auditModel?: string;
}

export interface AutonomyProfile {
  id: AutonomyProfileId;
  label: string;
  description: string;
  autoPlan: boolean;
  autoVerify: boolean;
  allowHandsFreeExecution: boolean;
  reviewOnly: boolean;
  preferResearchPass: boolean;
  maxAutonomousSteps: number;
}

export interface ContextPackSection {
  label: string;
  content: string;
  estimatedTokens: number;
  itemCount: number;
}

export interface ContextPack {
  objective: string;
  taskMode: TaskMode;
  sections: ContextPackSection[];
  combined: string;
  estimatedTokens: number;
  charBudget: number;
  droppedSections: string[];
}

export interface RoutedStage {
  stage: SpecialistStage;
  taskMode: TaskMode;
  selectedModel: string;
  usedOverride: boolean;
  reason: string;
}

export interface SpecialistPlan {
  objective: string;
  steps: string[];
  risks: string[];
  notes: string;
  route: RoutedStage;
  trace: OrchestrationTraceStage;
}

export interface SpecialistVerification {
  verdict: 'pass' | 'revise';
  summary: string;
  followUp?: string;
  confidence: 'low' | 'medium' | 'high';
  route: RoutedStage;
  trace: OrchestrationTraceStage;
}

export interface SpecialistResearchBrief {
  summary: string;
  route: RoutedStage;
  trace: OrchestrationTraceStage;
}

export interface OrchestrationTraceStage {
  stage: SpecialistStage;
  model: string;
  promptTokens: number;
  outputTokens: number;
  usedFallback?: boolean;
  finishReason?: string;
}

export interface OrchestrationTraceInput {
  source: 'chat' | 'scripts' | 'doctor' | 'eval';
  entityId?: string;
  entityLabel?: string;
  conversationId?: string | null;
  taskMode: TaskMode;
  autonomyProfile: AutonomyProfileId;
  provider: LLMConfig['provider'];
  model: string;
  promptTokens: number;
  outputTokens: number;
  contextTokens: number;
  toolsUsed: string[];
  routes: RoutedStage[];
  stages: OrchestrationTraceStage[];
  notes?: string[];
  error?: string;
}

export interface EvalCaseResult {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  summary: string;
  details?: Record<string, unknown>;
}

export interface EvalRunResult {
  ranAt: string;
  overallStatus: 'pass' | 'fail';
  passCount: number;
  failCount: number;
  cases: EvalCaseResult[];
}

export interface OrchestrationTelemetryRun {
  id: string;
  source: string;
  createdAt: Date;
  status: string;
  taskMode: string;
  autonomyProfile: string;
  promptTokens: number;
  outputTokens: number;
  model: string;
}

export interface OrchestrationTelemetrySummary {
  totalRuns: number;
  avgPromptTokens: number;
  avgOutputTokens: number;
  avgContextTokens: number;
  topTaskMode: string;
  topAutonomyProfile: string;
  topTool: string;
  recentRuns: OrchestrationTelemetryRun[];
}
