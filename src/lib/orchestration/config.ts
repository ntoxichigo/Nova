import { getAllSettings } from '@/lib/settings';
import type { AutonomyProfile, AutonomyProfileId, OrchestrationSettings } from './types';

const DEFAULT_SETTINGS: OrchestrationSettings = {
  autonomyProfile: 'builder',
  routerEnabled: true,
  scopedAgentsEnabled: true,
  tokenTelemetryEnabled: true,
  plannerModel: '',
  coderModel: '',
  verifierModel: '',
  researchModel: '',
  fastModel: '',
  strongModel: '',
  auditModel: '',
};

export const AUTONOMY_PROFILES: Record<AutonomyProfileId, AutonomyProfile> = {
  safe: {
    id: 'safe',
    label: 'Safe',
    description: 'Plans and verifies carefully, but stays conservative about autonomous execution.',
    autoPlan: true,
    autoVerify: true,
    allowHandsFreeExecution: false,
    reviewOnly: false,
    preferResearchPass: false,
    maxAutonomousSteps: 4,
  },
  builder: {
    id: 'builder',
    label: 'Builder',
    description: 'Balanced implementation mode with planning, action, and verification enabled.',
    autoPlan: true,
    autoVerify: true,
    allowHandsFreeExecution: true,
    reviewOnly: false,
    preferResearchPass: false,
    maxAutonomousSteps: 6,
  },
  'hands-free': {
    id: 'hands-free',
    label: 'Hands-Free',
    description: 'Maximizes autonomous progress with staged reasoning and aggressive follow-through.',
    autoPlan: true,
    autoVerify: true,
    allowHandsFreeExecution: true,
    reviewOnly: false,
    preferResearchPass: true,
    maxAutonomousSteps: 8,
  },
  reviewer: {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Focuses on diagnosis, critique, and verification without broad autonomous edits.',
    autoPlan: true,
    autoVerify: true,
    allowHandsFreeExecution: false,
    reviewOnly: true,
    preferResearchPass: false,
    maxAutonomousSteps: 3,
  },
  research: {
    id: 'research',
    label: 'Research',
    description: 'Prioritizes retrieval, synthesis, and reasoning over direct action.',
    autoPlan: true,
    autoVerify: false,
    allowHandsFreeExecution: false,
    reviewOnly: true,
    preferResearchPass: true,
    maxAutonomousSteps: 4,
  },
};

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined) return fallback;
  return String(rawValue).toLowerCase() === 'true';
}

function parseAutonomyProfile(rawValue: string | undefined): AutonomyProfileId {
  if (!rawValue || !(rawValue in AUTONOMY_PROFILES)) {
    return DEFAULT_SETTINGS.autonomyProfile;
  }
  return rawValue as AutonomyProfileId;
}

export async function getOrchestrationSettings(): Promise<OrchestrationSettings> {
  const settings = await getAllSettings();

  return {
    autonomyProfile: parseAutonomyProfile(settings.agent_autonomy_profile),
    routerEnabled: parseBoolean(settings.llm_router_enabled, DEFAULT_SETTINGS.routerEnabled),
    scopedAgentsEnabled: parseBoolean(settings.llm_scoped_agents_enabled, DEFAULT_SETTINGS.scopedAgentsEnabled),
    tokenTelemetryEnabled: parseBoolean(settings.llm_token_telemetry_enabled, DEFAULT_SETTINGS.tokenTelemetryEnabled),
    plannerModel: settings.llm_planner_model || '',
    coderModel: settings.llm_coder_model || '',
    verifierModel: settings.llm_verifier_model || '',
    researchModel: settings.llm_research_model || '',
    fastModel: settings.llm_fast_model || '',
    strongModel: settings.llm_strong_model || '',
    auditModel: settings.llm_audit_model || '',
  };
}

export function getAutonomyProfile(profileId: AutonomyProfileId): AutonomyProfile {
  return AUTONOMY_PROFILES[profileId] || AUTONOMY_PROFILES.builder;
}
