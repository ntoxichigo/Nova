import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const skillsRoot = path.join(root, 'skills');
const args = process.argv.slice(2);
const writeIndex = args.indexOf('--write');
const writePath = writeIndex >= 0 ? args[writeIndex + 1] : '';

function scoreSkill(skill) {
  let score = 0;
  if (skill.hasSkillMd) score += 40;
  if (skill.hasScripts) score += 20;
  if (skill.hasReferences) score += 15;
  if (skill.hasMeta) score += 10;
  if (skill.hasExamples) score += 15;
  return Math.min(score, 100);
}

function grade(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

async function dirExists(p) {
  try {
    const stat = await fsp.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p) {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function countFilesRecursive(dirPath) {
  if (!(await dirExists(dirPath))) return 0;
  const stack = [dirPath];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }

  return count;
}

async function audit() {
  if (!(await dirExists(skillsRoot))) {
    throw new Error('skills directory not found');
  }

  const entries = await fsp.readdir(skillsRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsRoot, entry.name);
    const hasSkillMd = await fileExists(path.join(skillDir, 'SKILL.md'));
    const hasMeta = await fileExists(path.join(skillDir, '_meta.json'));
    const hasScripts = await dirExists(path.join(skillDir, 'scripts'));
    const hasReferences = await dirExists(path.join(skillDir, 'references'));
    const hasExamples = (await dirExists(path.join(skillDir, 'examples'))) || (await dirExists(path.join(skillDir, 'assets')));
    const scriptFiles = await countFilesRecursive(path.join(skillDir, 'scripts'));
    const referenceFiles = await countFilesRecursive(path.join(skillDir, 'references'));
    const exampleFiles = (await countFilesRecursive(path.join(skillDir, 'examples'))) + (await countFilesRecursive(path.join(skillDir, 'assets')));

    const row = {
      name: entry.name,
      hasSkillMd,
      hasMeta,
      hasScripts,
      hasReferences,
      hasExamples,
      scriptFiles,
      referenceFiles,
      exampleFiles,
    };
    const score = scoreSkill(row);
    skills.push({
      ...row,
      score,
      grade: grade(score),
    });
  }

  skills.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return skills;
}

function render(skills) {
  const total = skills.length;
  const byGrade = {
    A: skills.filter((s) => s.grade === 'A').length,
    B: skills.filter((s) => s.grade === 'B').length,
    C: skills.filter((s) => s.grade === 'C').length,
    D: skills.filter((s) => s.grade === 'D').length,
  };

  const weak = skills.filter((s) => s.score < 70).slice(0, 20);
  const missingSkillDoc = skills.filter((s) => !s.hasSkillMd).map((s) => s.name);
  const missingScripts = skills.filter((s) => !s.hasScripts).map((s) => s.name);
  const missingExamples = skills.filter((s) => !s.hasExamples).map((s) => s.name);

  const lines = [];
  lines.push('# Skill Audit Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total skills: ${total}`);
  lines.push(`- Grade A: ${byGrade.A}`);
  lines.push(`- Grade B: ${byGrade.B}`);
  lines.push(`- Grade C: ${byGrade.C}`);
  lines.push(`- Grade D: ${byGrade.D}`);
  lines.push('');
  lines.push('Scoring rubric:');
  lines.push('- `SKILL.md` present: 40');
  lines.push('- `scripts/` present: 20');
  lines.push('- `references/` present: 15');
  lines.push('- `_meta.json` present: 10');
  lines.push('- `examples/` or `assets/` present: 15');
  lines.push('');
  lines.push('## Top Gaps');
  lines.push('');
  lines.push(`- Missing \`SKILL.md\`: ${missingSkillDoc.length}`);
  lines.push(`- Missing \`scripts/\`: ${missingScripts.length}`);
  lines.push(`- Missing examples/assets: ${missingExamples.length}`);
  lines.push('');
  lines.push('## Needs Attention (score < 70)');
  lines.push('');
  if (weak.length === 0) {
    lines.push('- None');
  } else {
    for (const skill of weak) {
      lines.push(`- ${skill.name}: ${skill.score}/100 (${skill.grade})`);
    }
  }
  lines.push('');
  lines.push('## Full Inventory');
  lines.push('');
  lines.push('| Skill | Grade | Score | Scripts | References | Examples/Assets |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const skill of skills) {
    lines.push(
      `| ${skill.name} | ${skill.grade} | ${skill.score} | ${skill.scriptFiles} | ${skill.referenceFiles} | ${skill.exampleFiles} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const skills = await audit();
  const output = render(skills);

  if (writePath) {
    const absolute = path.resolve(root, writePath);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, output, 'utf8');
    process.stdout.write(`Wrote ${absolute}\n`);
    return;
  }

  process.stdout.write(output);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Skill audit failed: ${message}\n`);
  process.exit(1);
});
