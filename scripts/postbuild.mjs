import { cpSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const standaloneDir = join(root, '.next', 'standalone');
const nodeModulesDir = join(standaloneDir, 'node_modules');
const prismaModulesDir = join(root, 'node_modules', '.prisma', 'client');

console.log('🔍 Post-build: Setting up standalone Prisma client...');

// 1. Copy static assets
cpSync(join(root, '.next', 'static'), join(standaloneDir, '.next', 'static'), { recursive: true });
console.log('  ✅ Copied .next/static');

// 2. Copy public dir
cpSync(join(root, 'public'), join(standaloneDir, 'public'), { recursive: true });
console.log('  ✅ Copied public/');

// 3. Copy Prisma client to standalone node_modules/.prisma/client
const standalonePrismaClientDir = join(nodeModulesDir, '.prisma', 'client');
mkdirSync(standalonePrismaClientDir, { recursive: true });
cpSync(prismaModulesDir, standalonePrismaClientDir, { recursive: true });
console.log('  ✅ Copied .prisma/client to standalone');

// 4. Copy @prisma/client to standalone
const standalonePrismaDir = join(nodeModulesDir, '@prisma', 'client');
mkdirSync(standalonePrismaDir, { recursive: true });
cpSync(join(root, 'node_modules', '@prisma', 'client'), standalonePrismaDir, { recursive: true });
console.log('  ✅ Copied @prisma/client to standalone');

// 5. Find the hashed Prisma module name that Next.js generated
const chunksDir = join(standaloneDir, '.next', 'server', 'chunks');
const rootChunks = readdirSync(chunksDir).filter(f => f.startsWith('[root-of-the-server]'));
let hashedName = null;

for (const chunk of rootChunks) {
  try {
    const content = readFileSync(join(chunksDir, chunk), 'utf8');
    const match = content.match(/"@prisma\/client-([a-f0-9]+)"/);
    if (match) {
      hashedName = `@prisma/client-${match[1]}`;
      break;
    }
  } catch { /* skip */ }
}

if (hashedName) {
  console.log(`  🔗 Found hashed Prisma module: ${hashedName}`);

  // Create the hashed module directory with proper contents
  const hashedModuleDir = join(nodeModulesDir, '@prisma', hashedName.replace('@prisma/', ''));
  mkdirSync(hashedModuleDir, { recursive: true });
  cpSync(prismaModulesDir, hashedModuleDir, { recursive: true });

  // Create index.js that re-exports from client.js (the actual Prisma client)
  writeFileSync(
    join(hashedModuleDir, 'index.js'),
    'module.exports = require("./client.js");\n'
  );

  // Ensure @prisma scope has a package.json
  const prismaScopeDir = join(nodeModulesDir, '@prisma');
  const scopePkgPath = join(prismaScopeDir, 'package.json');
  if (!existsSync(scopePkgPath)) {
    writeFileSync(scopePkgPath, JSON.stringify({ name: '@prisma' }));
  }

  console.log(`  ✅ Created hashed module at ${hashedModuleDir}`);
} else {
  console.log('  ⚠️  No hashed Prisma module found in build output');
}

console.log('🎉 Post-build complete!');
