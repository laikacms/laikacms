import { defineConfig } from 'tsup';

// Stand-alone bundle for the verification harness in cap-test.ts. Lives in a
// separate config so `pnpm run build` (which produces the shipped `cli.js` /
// `index.js`) doesn't include the test in the published artifact.
export default defineConfig({
  entry: { 'cap-test': 'cap-test.ts' },
  outDir: 'dist-test',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: ['laikacms'],
});
