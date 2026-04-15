import type { RuntimeProfile } from '@/lib/chat/stream-utils';
import { clipText, estimateTokens } from '@/lib/chat/stream-utils';
import type { ContextPack, ContextPackSection, TaskMode } from './types';

interface RawContextSection {
  label: string;
  content: string;
  itemCount?: number;
  priority?: number;
  maxChars?: number;
}

interface BuildContextPackOptions {
  objective: string;
  taskMode: TaskMode;
  runtimeProfile: RuntimeProfile;
  sections: RawContextSection[];
}

export function classifyTaskMode(
  message: string,
  options: { websiteBuildIntent?: boolean; workspaceAware?: boolean } = {},
): TaskMode {
  const text = message.toLowerCase();

  const liveUtilityIntent = /\b(weather|forecast|temperature|wind|humidity|rain|snow|storm|time|timezone|clock|date)\b/.test(text);
  if (liveUtilityIntent) {
    return 'chat';
  }

  const explicitReviewIntent = /\b(review|audit|critique|inspect|verify|assess)\b/.test(text);
  const checkReviewIntent =
    /\bcheck\b/.test(text) &&
    /\b(code|file|function|component|diff|pr|pull request|test|bug|issue|quality|performance|security|logs?)\b/.test(text);

  if (explicitReviewIntent || checkReviewIntent) {
    return 'review';
  }
  if (/\b(debug|fix|error|crash|failing|broken|stack trace|lint|test failure)\b/.test(text)) {
    return 'debug';
  }
  if (options.websiteBuildIntent || /\b(build|scaffold|create app|create project|landing page|website|setup|set up)\b/.test(text)) {
    return 'build';
  }
  if (/\b(research|latest|current|news|compare|study|investigate|look up|analyze market)\b/.test(text)) {
    return 'research';
  }
  if (options.workspaceAware || /\b(code|file|function|component|refactor|typescript|javascript|python|react)\b/.test(text)) {
    return 'coding';
  }
  return 'chat';
}

function normalizeSections(sections: RawContextSection[]): RawContextSection[] {
  return sections
    .filter((section) => section.content.trim().length > 0)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

function buildSection(section: RawContextSection): ContextPackSection {
  const clipped = clipText(section.content.trim(), section.maxChars ?? section.content.length);
  return {
    label: section.label,
    content: clipped,
    estimatedTokens: estimateTokens(clipped),
    itemCount: section.itemCount ?? 1,
  };
}

export function buildContextPack({
  objective,
  taskMode,
  runtimeProfile,
  sections,
}: BuildContextPackOptions): ContextPack {
  const charBudget = runtimeProfile.contextCharBudget;
  const normalized = normalizeSections(sections);
  const included: ContextPackSection[] = [];
  const droppedSections: string[] = [];
  let usedChars = 0;

  for (const section of normalized) {
    const built = buildSection({
      ...section,
      maxChars: section.maxChars ?? Math.max(220, Math.floor(charBudget * 0.3)),
    });
    const rendered = `## ${built.label}\n${built.content}\n`;
    if (usedChars + rendered.length > charBudget && included.length > 0) {
      droppedSections.push(section.label);
      continue;
    }
    included.push(built);
    usedChars += rendered.length;
  }

  const combined = [
    `## Objective\n${clipText(objective.trim(), Math.max(240, Math.floor(charBudget * 0.18)))}`,
    ...included.map((section) => `## ${section.label}\n${section.content}`),
  ].join('\n\n');

  return {
    objective,
    taskMode,
    sections: included,
    combined,
    estimatedTokens: estimateTokens(combined),
    charBudget,
    droppedSections,
  };
}
