export interface RoutableSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category: string;
}

interface SkillContextOptions {
  descriptionLimit?: number;
  instructionLimit?: number;
  compact?: boolean;
}

const ROUTING_STOP_WORDS = new Set([
  'about',
  'again',
  'also',
  'agent',
  'based',
  'best',
  'build',
  'create',
  'custom',
  'daily',
  'detail',
  'doing',
  'help',
  'helps',
  'here',
  'into',
  'just',
  'make',
  'more',
  'need',
  'only',
  'other',
  'over',
  'skill',
  'something',
  'thing',
  'this',
  'those',
  'that',
  'there',
  'the',
  'these',
  'their',
  'and',
  'for',
  'from',
  'you',
  'when',
  'where',
  'which',
  'with',
  'would',
  'could',
  'should',
  'using',
  'used',
  'use',
  'want',
  'what',
  'write',
  'your',
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\/]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function unique(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text);
}

function scoreSkill(skill: RoutableSkill, routingText: string): number {
  const normalizedRouting = normalizeText(routingText);
  const normalizedSkillName = normalizeText(skill.name);
  const skillText = normalizeText(`${skill.name} ${skill.category} ${skill.description}`);
  let score = 0;

  if (normalizedSkillName && normalizedRouting.includes(normalizedSkillName)) {
    score += 90;
  }

  const nameTokens = unique(tokenize(skill.name)).filter((token) => token.length > 2 && !ROUTING_STOP_WORDS.has(token));
  const categoryTokens = unique(tokenize(skill.category)).filter((token) => token.length > 2 && !ROUTING_STOP_WORDS.has(token));
  const descriptionTokens = unique(tokenize(skill.description))
    .filter((token) => token.length > 6 && !ROUTING_STOP_WORDS.has(token))
    .slice(0, 8);

  let matchedNameTokens = 0;
  for (const token of nameTokens) {
    if (hasWord(routingText, token)) {
      score += 28;
      matchedNameTokens += 1;
    }
  }

  for (const token of categoryTokens) {
    if (hasWord(routingText, token)) {
      score += 10;
    }
  }

  let matchedDescriptionTokens = 0;
  for (const token of descriptionTokens) {
    if (hasWord(routingText, token)) {
      score += 6;
      matchedDescriptionTokens += 1;
    }
  }

  const hasLiveIntent = /\b(latest|current|today|now|news|breaking|price|prices|stock|stocks|crypto|weather|forecast|temperature|wind|tonight|this week|this month|this year)\b/i.test(routingText);
  const hasWeatherIntent = /\b(weather|forecast|temperature|wind|humidity|rain|sunny|cloudy|snow|storm)\b/i.test(routingText);
  const hasTimeIntent = /\b(time|date|timezone|clock)\b/i.test(routingText);

  if (hasWeatherIntent && /\b(weather|forecast|temperature|wind|humidity|rain|sunny|cloudy|snow|storm)\b/i.test(skillText)) {
    score += 40;
  }

  if (hasTimeIntent && /\b(date and time|current date|current time|local time|time zone|timezone|clock)\b/i.test(skillText)) {
    score += 40;
  }

  if (hasLiveIntent && /\b(news|real time|realtime|search|browse|latest|live|update|prices?|stocks?|crypto|weather|forecast)\b/i.test(skillText)) {
    score += 35;
  }

  if (matchedNameTokens >= 2) score += 18;
  if (matchedNameTokens > 0 && matchedNameTokens === nameTokens.length) score += 25;
  if (matchedDescriptionTokens >= 2) score += 6;

  return score;
}

export function selectRelevantSkill<T extends RoutableSkill>(
  skills: T[],
  message: string,
  recentContext = ''
): T | null {
  if (skills.length === 0) return null;

  const routingText = [message, recentContext].filter(Boolean).join('\n');
  let bestSkill: T | null = null;
  let bestScore = 0;

  for (const skill of skills) {
    const score = scoreSkill(skill, routingText);
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }

  return bestScore >= 24 ? bestSkill : null;
}

function clipSegment(text: string, limit?: number): string {
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n[truncated]`;
}

export function buildSkillContext(skill: RoutableSkill | null, options?: SkillContextOptions): string {
  if (!skill) return '';

  const description = clipSegment(skill.description, options?.descriptionLimit);
  const instructions = clipSegment(skill.instructions, options?.instructionLimit);

  if (options?.compact) {
    return [
      '## Active Skill',
      `- ${skill.name} (${skill.category})`,
      description ? `- Purpose: ${description}` : '',
      instructions ? `- Key Instructions:\n${instructions}` : '',
    ].filter(Boolean).join('\n');
  }

  return [
    '## Active Skill (only one loaded for this turn)',
    `### ${skill.name} (${skill.category})`,
    description,
    'Instructions:',
    instructions,
  ].filter(Boolean).join('\n');
}
