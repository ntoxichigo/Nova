import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

/**
 * GET /api/scripts/[id]/download
 * Downloads a project as a single JSON bundle the frontend turns into a .zip via JSZip.
 * Includes all files + generated boilerplate (package.json, README, .gitignore, tsconfig).
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const project = await db.scriptProject.findUnique({
    where: { id },
    include: { files: { orderBy: { path: 'asc' } } },
  });

  if (!project) return Response.json({ error: 'Not found' }, { status: 404 });

  const hasTs = project.files.some((f) => f.language === 'typescript' || f.path.endsWith('.ts') || f.path.endsWith('.tsx'));
  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

  // Build boilerplate files that don't already exist
  const existing = new Set(project.files.map((f) => f.path));
  const boilerplate: { path: string; content: string }[] = [];

  if (!existing.has('package.json')) {
    boilerplate.push({
      path: 'package.json',
      content: JSON.stringify(
        {
          name: safeName,
          version: '1.0.0',
          private: true,
          description: project.description || `Project exported from NOVA IDE`,
          scripts: { start: hasTs ? 'npx tsx src/index.ts' : 'node index.js' },
          ...(hasTs ? { devDependencies: { tsx: '^4', typescript: '^5' } } : {}),
        },
        null,
        2,
      ),
    });
  }

  if (!existing.has('README.md')) {
    boilerplate.push({
      path: 'README.md',
      content: `# ${project.name}\n\n${project.description || 'Exported from NOVA IDE.'}\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n`,
    });
  }

  if (!existing.has('.gitignore')) {
    boilerplate.push({
      path: '.gitignore',
      content: 'node_modules/\ndist/\n.env\n*.log\n',
    });
  }

  if (hasTs && !existing.has('tsconfig.json')) {
    boilerplate.push({
      path: 'tsconfig.json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'Node16',
            moduleResolution: 'Node16',
            strict: true,
            outDir: 'dist',
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['**/*.ts'],
        },
        null,
        2,
      ),
    });
  }

  // Merge user files + boilerplate
  const allFiles = [
    ...project.files.map((f) => ({ path: f.path, content: f.content })),
    ...boilerplate,
  ];

  return Response.json({
    projectName: safeName,
    files: allFiles,
  });
}
