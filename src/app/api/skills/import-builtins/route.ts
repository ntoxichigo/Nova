import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';

function parseYamlFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function extractMarkdownBody(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

export async function POST() {
  const skillsDir = join(process.cwd(), 'skills');

  let entries: string[] = [];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return NextResponse.json({ error: 'skills/ directory not found' }, { status: 500 });
  }

  const results: { name: string; status: 'imported' | 'skipped' }[] = [];

  for (const dir of entries) {
    const skillMdPath = join(skillsDir, dir, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    let frontmatter: Record<string, string> = {};
    let instructions = '';
    try {
      const md = readFileSync(skillMdPath, 'utf-8');
      frontmatter = parseYamlFrontmatter(md);
      instructions = extractMarkdownBody(md);
    } catch {
      continue;
    }

    const name = frontmatter.name || dir;
    const description = frontmatter.description || `Built-in skill: ${dir}`;

    let category = 'built-in';
    const metaPath = join(skillsDir, dir, '_meta.json');
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        if (meta.slug) category = meta.slug;
      } catch { /* ignore */ }
    }

    const existing = await db.skill.findFirst({ where: { name } });
    if (existing) {
      results.push({ name, status: 'skipped' });
      continue;
    }

    await db.skill.create({
      data: {
        name,
        description,
        instructions,
        category,
        isActive: true,
        isBuiltIn: true,
        executionMode: 'prompt',
        icon: 'Zap',
      },
    });

    results.push({ name, status: 'imported' });
  }

  return NextResponse.json({
    imported: results.filter((r) => r.status === 'imported').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  });
}
