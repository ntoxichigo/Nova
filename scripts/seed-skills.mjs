#!/usr/bin/env node
/**
 * Seed built-in skills from the skills/ directory into the SQLite database.
 * Reads SKILL.md YAML frontmatter for name/description, _meta.json for slug/version.
 * Run: node scripts/seed-skills.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const SKILLS_DIR = join(ROOT, 'skills');

const prisma = new PrismaClient();

function parseYamlFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function extractMarkdownBody(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

async function seedSkills() {
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let inserted = 0;
  let skipped = 0;

  for (const dir of entries) {
    const skillPath = join(SKILLS_DIR, dir);
    const skillMdPath = join(skillPath, 'SKILL.md');

    if (!existsSync(skillMdPath)) {
      console.log(`  skip ${dir} — no SKILL.md`);
      skipped++;
      continue;
    }

    let frontmatter = {};
    let instructions = '';
    try {
      const md = readFileSync(skillMdPath, 'utf-8');
      frontmatter = parseYamlFrontmatter(md);
      instructions = extractMarkdownBody(md);
    } catch {
      console.log(`  skip ${dir} — could not read SKILL.md`);
      skipped++;
      continue;
    }

    const name = frontmatter.name || dir;
    const description = frontmatter.description || `Built-in skill: ${dir}`;

    // Read optional _meta.json
    let category = 'built-in';
    const metaPath = join(skillPath, '_meta.json');
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        if (meta.slug) category = meta.slug;
      } catch { /* ignore */ }
    }

    // Upsert: skip if a skill with same name already exists
    const existing = await prisma.skill.findFirst({ where: { name } });
    if (existing) {
      console.log(`  skip ${name} — already exists`);
      skipped++;
      continue;
    }

    await prisma.skill.create({
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

    console.log(`  + ${name}`);
    inserted++;
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
  await prisma.$disconnect();
}

seedSkills().catch((err) => {
  console.error(err);
  process.exit(1);
});
