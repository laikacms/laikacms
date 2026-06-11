import { defineConfig } from 'tsup';

// Pure bin package: a single self-contained-enough ESM entry. @laikacms/local
// (and effect / platform-node) stay external — they're declared in
// `dependencies` and get installed alongside the package.
export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
});
