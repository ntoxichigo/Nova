import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  bundle: true,
  splitting: false,
  minify: true,
  sourcemap: false,
  clean: true,
  // No banner - shebang lives in bin/nova.js wrapper
  // No noExternal - let Node.js built-ins stay external (resolved at runtime)
});

