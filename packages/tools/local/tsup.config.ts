import { defineConfig } from 'tsup';

// Bundle the CLI and programmatic entry into self-contained ESM so direct
// `node dist/cli.js` (and therefore `npx @laikacms/local`) just works — laikacms
// ships extensionless deep imports that bundlers resolve but Node ESM does not.
//
// laikacms itself gets inlined; its transitive deps (and effect / platform-node)
// stay external — they're declared in our `dependencies` and get installed
// alongside the package.
export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: { entry: { index: 'src/index.ts' } },
  noExternal: ['laikacms'],
});
