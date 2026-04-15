import { access, writeFile } from 'fs/promises';
import path from 'path';

async function ensureFile(filePath, content) {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, content, 'utf8');
  }
}

const nextTypesDir = path.join(process.cwd(), '.next', 'types');

await ensureFile(
  path.join(nextTypesDir, 'routes.js'),
  'export {};\n',
);
