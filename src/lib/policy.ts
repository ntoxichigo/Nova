import { db } from '@/lib/db';
import { parseAuditDetails } from './audit';

export type PolicyMode = 'allow' | 'review' | 'block';
export type PolicyCategory = 'filesystem' | 'integrations' | 'mcp' | 'automation';

export interface ActionPolicy {
  defaultMode: PolicyMode;
  categories: Record<PolicyCategory, PolicyMode>;
  toolOverrides: Record<string, PolicyMode>;
}

const POLICY_KEY = 'agent_action_policy';

export const DEFAULT_ACTION_POLICY: ActionPolicy = {
  defaultMode: 'allow',
  categories: {
    filesystem: 'allow',
    integrations: 'allow',
    mcp: 'allow',
    automation: 'allow',
  },
  toolOverrides: {},
};

function isPolicyMode(value: unknown): value is PolicyMode {
  return value === 'allow' || value === 'review' || value === 'block';
}

function normalizePolicy(value: unknown): ActionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_ACTION_POLICY;
  }

  const candidate = value as {
    defaultMode?: unknown;
    categories?: Partial<Record<PolicyCategory, unknown>>;
    toolOverrides?: Record<string, unknown>;
  };
  const categories = candidate.categories ?? {};
  const toolOverridesInput = candidate.toolOverrides && typeof candidate.toolOverrides === 'object'
    ? candidate.toolOverrides
    : {};
  const toolOverrides = Object.entries(toolOverridesInput).reduce<Record<string, PolicyMode>>((acc, [toolName, mode]) => {
    if (!toolName || typeof toolName !== 'string') return acc;
    if (!isPolicyMode(mode)) return acc;
    acc[toolName.trim()] = mode;
    return acc;
  }, {});

  return {
    defaultMode: isPolicyMode(candidate.defaultMode) ? candidate.defaultMode : DEFAULT_ACTION_POLICY.defaultMode,
    categories: {
      filesystem: isPolicyMode(categories.filesystem) ? categories.filesystem : DEFAULT_ACTION_POLICY.categories.filesystem,
      integrations: isPolicyMode(categories.integrations) ? categories.integrations : DEFAULT_ACTION_POLICY.categories.integrations,
      mcp: isPolicyMode(categories.mcp) ? categories.mcp : DEFAULT_ACTION_POLICY.categories.mcp,
      automation: isPolicyMode(categories.automation) ? categories.automation : DEFAULT_ACTION_POLICY.categories.automation,
    },
    toolOverrides,
  };
}

export async function getActionPolicy(): Promise<ActionPolicy> {
  const record = await db.settings.findUnique({ where: { key: POLICY_KEY } });
  if (!record?.value) {
    return DEFAULT_ACTION_POLICY;
  }

  const stored = normalizePolicy(parseAuditDetails(record.value));

  // Auto-upgrade: if any category is still 'review' (old default), reset to DEFAULT
  const hasOldDefault =
    stored.categories.filesystem === 'review' ||
    stored.categories.integrations === 'review' ||
    stored.categories.mcp === 'review';

  if (hasOldDefault) {
    const upgraded = DEFAULT_ACTION_POLICY;
    await db.settings.update({ where: { key: POLICY_KEY }, data: { value: JSON.stringify(upgraded) } }).catch(() => {});
    return upgraded;
  }

  return stored;
}

export async function saveActionPolicy(policy: ActionPolicy) {
  const normalized = normalizePolicy(policy);
  await db.settings.upsert({
    where: { key: POLICY_KEY },
    update: { value: JSON.stringify(normalized) },
    create: { key: POLICY_KEY, value: JSON.stringify(normalized) },
  });
  return normalized;
}

export interface ToolPolicyDecision {
  category: PolicyCategory | null;
  mode: PolicyMode;
  reason: string;
}

const toolCategories: Array<{ names: string[]; category: PolicyCategory }> = [
  { names: ['fs_write_file', 'fs_edit_file', 'fs_delete_file'], category: 'filesystem' },
  { names: ['github_create_issue', 'github_list_my_repos', 'google_list_emails', 'google_calendar_events'], category: 'integrations' },
  { names: ['fs_run_command'], category: 'automation' },
];

function getToolCategory(toolName: string): PolicyCategory | null {
  if (toolName.startsWith('mcp_')) {
    return 'mcp';
  }
  const explicit = toolCategories.find((entry) => entry.names.includes(toolName));
  return explicit?.category ?? null;
}

export async function evaluateToolPolicy(toolName: string): Promise<ToolPolicyDecision> {
  const policy = await getActionPolicy();
  const category = getToolCategory(toolName);
  const directOverride = policy.toolOverrides[toolName];
  if (directOverride) {
    return {
      category,
      mode: directOverride,
      reason: `Tool-specific Mission Control override for ${toolName}.`,
    };
  }

  if (category === 'mcp') {
    return {
      category: 'mcp',
      mode: policy.categories.mcp,
      reason: 'MCP tools can invoke external processes or remote systems.',
    };
  }

  if (category) {
    const categoryMode = policy.categories[category];
    const reasons: Record<PolicyCategory, string> = {
      filesystem: 'Filesystem mutation changes local workspace state.',
      integrations: 'Integration tools can access private data or external services.',
      mcp: 'MCP tools can invoke external processes or remote systems.',
      automation: 'Automation actions can trigger unattended work.',
    };
    return {
      category,
      mode: categoryMode,
      reason: reasons[category],
    };
  }

  return {
    category: null,
    mode: policy.defaultMode,
    reason: 'No special policy rule matched this action.',
  };
}
