export interface SkillProfileSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
}

export interface SkillProfileSlot {
  key: string;
  label: string;
  reason: string;
  candidates: string[];
}

export interface SkillProfileSelectionItem {
  slot: SkillProfileSlot;
  skill: SkillProfileSkill;
}

export interface SkillProfileSelection {
  selected: SkillProfileSelectionItem[];
  missing: SkillProfileSlot[];
}

export const GOLDEN_12_PROFILE_ID = 'golden-12-coding-web-debug';

export const GOLDEN_12_PROFILE_NAME = 'Golden 12 (Coding + Website + Debugging)';

export const GOLDEN_12_PROFILE_SLOTS: SkillProfileSlot[] = [
  {
    key: 'coding-core',
    label: 'Coding Core',
    reason: 'Structured implementation workflow with planning and verification.',
    candidates: ['coding-agent'],
  },
  {
    key: 'fullstack-shipping',
    label: 'Fullstack Shipping',
    reason: 'End-to-end app delivery for Next.js + TypeScript + Prisma stacks.',
    candidates: ['fullstack-dev'],
  },
  {
    key: 'frontend-craft',
    label: 'Frontend Craft',
    reason: 'High-quality UI implementation with production-ready styling and patterns.',
    candidates: ['frontend', 'Modern Frontend Coder'],
  },
  {
    key: 'website-experience',
    label: 'Website Experience',
    reason: 'Interactive landing pages, animation polish, and user-facing web experience.',
    candidates: ['Website Nova', 'ui-ux-pro-max'],
  },
  {
    key: 'frontend-architecture',
    label: 'Frontend Architecture',
    reason: 'Component architecture, state patterns, and maintainable frontend design.',
    candidates: ['Frontend Patterns Expert', 'Atomic Frontend Architect', 'Modern Frontend Coder'],
  },
  {
    key: 'git-devops',
    label: 'Git and Delivery',
    reason: 'Version-control discipline, branch hygiene, and release flow support.',
    candidates: ['Git Master'],
  },
  {
    key: 'deep-diagnosis',
    label: 'Deep Diagnosis',
    reason: 'Complex root-cause analysis and multi-source debugging research.',
    candidates: ['Deep Researcher', 'qingyan_research_report'],
  },
  {
    key: 'live-web-search',
    label: 'Live Web Search',
    reason: 'Current docs and live issue investigation.',
    candidates: ['web-search', 'multi-search-engine'],
  },
  {
    key: 'web-content-extraction',
    label: 'Web Content Extraction',
    reason: 'Fast extraction and digestion of technical pages and references.',
    candidates: ['web-reader', 'ContentAnalysis'],
  },
  {
    key: 'llm-engineering',
    label: 'LLM Engineering',
    reason: 'Model integration, prompts, and chat completion capability.',
    candidates: ['LLM'],
  },
  {
    key: 'browser-e2e',
    label: 'Browser E2E',
    reason: 'Automated browser-level validation for real website behavior.',
    candidates: ['Agent Browser'],
  },
  {
    key: 'system-orchestration',
    label: 'System Orchestration',
    reason: 'Top-level capability orchestration and broad execution fallback.',
    candidates: ['Nova-Almighty', 'nova-almighty'],
  },
];

function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findCandidateSkill(
  slot: SkillProfileSlot,
  skills: SkillProfileSkill[],
  usedIds: Set<string>
): SkillProfileSkill | null {
  for (const candidate of slot.candidates) {
    const normalizedCandidate = normalizeSkillName(candidate);

    const exact = skills.find(
      (skill) =>
        !usedIds.has(skill.id) &&
        skill.name === candidate
    );
    if (exact) return exact;

    const normalized = skills.find(
      (skill) =>
        !usedIds.has(skill.id) &&
        normalizeSkillName(skill.name) === normalizedCandidate
    );
    if (normalized) return normalized;
  }

  return null;
}

export function selectGolden12Skills(skills: SkillProfileSkill[]): SkillProfileSelection {
  const selected: SkillProfileSelectionItem[] = [];
  const missing: SkillProfileSlot[] = [];
  const usedIds = new Set<string>();

  for (const slot of GOLDEN_12_PROFILE_SLOTS) {
    const match = findCandidateSkill(slot, skills, usedIds);
    if (match) {
      selected.push({ slot, skill: match });
      usedIds.add(match.id);
      continue;
    }
    missing.push(slot);
  }

  return { selected, missing };
}
