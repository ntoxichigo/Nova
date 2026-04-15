import { db } from '@/lib/db';
import { getActionPolicy, saveActionPolicy, type ActionPolicy } from '@/lib/policy';
import { getAllSettings, setAllSettings, type AutomationMode, type ChatPermissionMode, type ChatPowerMode, type OperatingProfile } from '@/lib/settings';

export type OperatingPillarStatus = 'ready' | 'partial' | 'attention';

export interface OperatingPillar {
  id: 'workspace' | 'runtime' | 'orchestration' | 'automation';
  label: string;
  status: OperatingPillarStatus;
  summary: string;
}

export interface OperatingPreset {
  id: OperatingProfile;
  label: string;
  description: string;
  settings: Record<string, string>;
  policy: ActionPolicy;
}

export interface OperatingSystemState {
  selectedProfile: OperatingProfile;
  automationMode: AutomationMode;
  pillars: OperatingPillar[];
  projectsCount: number;
  scheduledTasksCount: number;
  enabledTasksCount: number;
  workspaceRootConfigured: boolean;
  recommendations: string[];
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

const PRESETS: Record<OperatingProfile, OperatingPreset> = {
  complete: {
    id: 'complete',
    label: 'Complete',
    description: 'Balanced default for a serious agentic workspace: IDE-first, guarded runtime, routed specialists, and assisted automation.',
    settings: {
      nova_operating_profile: 'complete',
      nova_automation_mode: 'assisted',
      agent_autonomy_profile: 'builder',
      chat_power_mode: 'builder',
      chat_permission_mode: 'ask_risky',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      llm_token_telemetry_enabled: 'true',
    },
    policy: {
      defaultMode: 'allow',
      categories: {
        filesystem: 'review',
        integrations: 'review',
        mcp: 'review',
        automation: 'review',
      },
      toolOverrides: {},
    },
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    description: 'Biases toward the IDE and implementation flow while keeping external automation conservative.',
    settings: {
      nova_operating_profile: 'studio',
      nova_automation_mode: 'manual',
      agent_autonomy_profile: 'builder',
      chat_power_mode: 'builder',
      chat_permission_mode: 'ask_risky',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      llm_token_telemetry_enabled: 'true',
    },
    policy: {
      defaultMode: 'allow',
      categories: {
        filesystem: 'review',
        integrations: 'review',
        mcp: 'review',
        automation: 'block',
      },
      toolOverrides: {},
    },
  },
  guarded: {
    id: 'guarded',
    label: 'Guarded',
    description: 'Tightest trust posture for runtime controls, approvals, and external surfaces.',
    settings: {
      nova_operating_profile: 'guarded',
      nova_automation_mode: 'manual',
      agent_autonomy_profile: 'safe',
      chat_power_mode: 'safe',
      chat_permission_mode: 'always_ask',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      llm_token_telemetry_enabled: 'true',
    },
    policy: {
      defaultMode: 'review',
      categories: {
        filesystem: 'review',
        integrations: 'review',
        mcp: 'block',
        automation: 'block',
      },
      toolOverrides: {},
    },
  },
  autonomous: {
    id: 'autonomous',
    label: 'Autonomous',
    description: 'For operators who want routed specialists plus recurring background work and faster follow-through.',
    settings: {
      nova_operating_profile: 'autonomous',
      nova_automation_mode: 'always_on',
      agent_autonomy_profile: 'hands-free',
      chat_power_mode: 'power',
      chat_permission_mode: 'ask_risky',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      llm_token_telemetry_enabled: 'true',
    },
    policy: {
      defaultMode: 'allow',
      categories: {
        filesystem: 'review',
        integrations: 'review',
        mcp: 'review',
        automation: 'allow',
      },
      toolOverrides: {},
    },
  },
};

export function listOperatingPresets(): OperatingPreset[] {
  return Object.values(PRESETS);
}

export async function applyOperatingPreset(profile: OperatingProfile): Promise<OperatingPreset> {
  const preset = PRESETS[profile] || PRESETS.complete;
  await setAllSettings(preset.settings);
  await saveActionPolicy(preset.policy);
  return preset;
}

export async function getOperatingSystemState(): Promise<OperatingSystemState> {
  const [settings, policy, projectsCount, tasks] = await Promise.all([
    getAllSettings(),
    getActionPolicy(),
    db.scriptProject.count(),
    db.scheduledTask.findMany({
      select: {
        id: true,
        enabled: true,
      },
    }),
  ]);

  const selectedProfile =
    (((settings.nova_operating_profile ?? settings.ntox_operating_profile) as OperatingProfile) || 'complete');
  const automationMode =
    (((settings.nova_automation_mode ?? settings.ntox_automation_mode) as AutomationMode) || 'assisted');
  const workspaceRootConfigured = Boolean((settings.workspace_root || '').trim());
  const chatPermissionMode = ((settings.chat_permission_mode as ChatPermissionMode) || 'always_ask');
  const chatPowerMode = ((settings.chat_power_mode as ChatPowerMode) || 'builder');
  const routerEnabled = asBool(settings.llm_router_enabled, true);
  const scopedAgentsEnabled = asBool(settings.llm_scoped_agents_enabled, true);
  const tokenTelemetryEnabled = asBool(settings.llm_token_telemetry_enabled, true);
  const enabledTasksCount = tasks.filter((task) => task.enabled).length;

  const filesystemGuarded = policy.categories.filesystem !== 'allow';
  const integrationGuarded = policy.categories.integrations !== 'allow';
  const mcpGuarded = policy.categories.mcp !== 'allow';
  const runtimeCoverage = [filesystemGuarded, integrationGuarded, mcpGuarded].filter(Boolean).length;

  const pillars: OperatingPillar[] = [
    {
      id: 'workspace',
      label: 'Agentic Workspace',
      status: workspaceRootConfigured && projectsCount > 0 ? 'ready' : (workspaceRootConfigured || projectsCount > 0 ? 'partial' : 'attention'),
      summary:
        workspaceRootConfigured && projectsCount > 0
          ? 'Workspace root is configured and the IDE already has live projects.'
          : workspaceRootConfigured || projectsCount > 0
            ? 'The IDE is present, but it still needs either a configured root or more active projects to feel fully native.'
            : 'Set a workspace root and create the first real IDE project to anchor Nova in your files.',
    },
    {
      id: 'runtime',
      label: 'Trustworthy Runtime',
      status:
        (chatPermissionMode === 'always_ask' || chatPermissionMode === 'ask_risky') && runtimeCoverage >= 2
          ? 'ready'
          : runtimeCoverage >= 1 || chatPermissionMode === 'ask_risky'
            ? 'partial'
            : 'attention',
      summary:
        (chatPermissionMode === 'always_ask' || chatPermissionMode === 'ask_risky') && runtimeCoverage >= 2
          ? 'Chat approvals and Mission Control are aligned for controlled execution.'
          : runtimeCoverage >= 1 || chatPermissionMode === 'ask_risky'
            ? 'Some guardrails are in place, but the runtime is still easier to over-open than it should be.'
            : 'Runtime controls are too permissive. Tighten approvals and Mission Control before scaling autonomy.',
    },
    {
      id: 'orchestration',
      label: 'Model Orchestration',
      status: routerEnabled && scopedAgentsEnabled && tokenTelemetryEnabled ? 'ready' : (routerEnabled || scopedAgentsEnabled ? 'partial' : 'attention'),
      summary:
        routerEnabled && scopedAgentsEnabled && tokenTelemetryEnabled
          ? 'Planner, coder, verifier, and telemetry are all active for routed execution.'
          : routerEnabled || scopedAgentsEnabled
            ? 'Specialist routing is partly enabled, but not all orchestration observability is online.'
            : 'Nova is acting like a single-model assistant. Turn on router, specialists, and telemetry.',
    },
    {
      id: 'automation',
      label: 'Always-On Automation',
      status:
        automationMode === 'always_on' && enabledTasksCount > 0
          ? 'ready'
          : (automationMode === 'assisted' || enabledTasksCount > 0 || chatPowerMode === 'power')
            ? 'partial'
            : 'attention',
      summary:
        automationMode === 'always_on' && enabledTasksCount > 0
          ? `Recurring automation is enabled with ${enabledTasksCount} active scheduled task${enabledTasksCount === 1 ? '' : 's'}.`
          : automationMode === 'assisted' || enabledTasksCount > 0
            ? 'Automation is available, but it is still operating more like a manual helper than an always-on operator.'
            : 'Automation exists in the product, but it is not configured into a meaningful operating loop yet.',
    },
  ];

  const recommendations: string[] = [];
  if (!workspaceRootConfigured) recommendations.push('Configure a workspace root so chat and IDE can operate on the same real file system.');
  if (projectsCount === 0) recommendations.push('Create a first IDE workspace template so Nova always has a concrete project surface to act on.');
  if (chatPermissionMode === 'autopilot') recommendations.push('Drop normal chat from Autopilot to Ask Risky or Always Ask until runtime confidence is stronger.');
  if (!routerEnabled || !scopedAgentsEnabled) recommendations.push('Enable model router and scoped specialists so planning, coding, and verification can split cleanly.');
  if (automationMode !== 'always_on') recommendations.push('Keep automation assisted for now, then promote one stable scheduled workflow to always-on once Doctor stays green.');
  if (policy.categories.automation === 'allow' && automationMode === 'manual') recommendations.push('Your automation policy is more open than your operating mode. Tighten or align those two surfaces.');
  if (runtimeCoverage < 2) recommendations.push('Move at least filesystem, integrations, and MCP into review or block inside Mission Control.');

  return {
    selectedProfile: PRESETS[selectedProfile] ? selectedProfile : 'complete',
    automationMode,
    pillars,
    projectsCount,
    scheduledTasksCount: tasks.length,
    enabledTasksCount,
    workspaceRootConfigured,
    recommendations,
  };
}
