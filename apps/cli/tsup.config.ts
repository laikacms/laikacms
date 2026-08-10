import { defineConfig } from 'tsup';

// The CLI binary (cli.js) bundles effect + @effect/platform-node inline so
// that `npx laikacli` / global installs cannot float these deps to an
// incompatible beta via npm peer-dep auto-resolution (LCMS-534).
//
// The library entry (index.js) keeps effect external so programmatic
// consumers don't end up with a second, bundled copy alongside their own.
export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node24',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    // ws and undici are CJS packages that use require() for Node built-ins;
    // they cannot be inlined into ESM without CJS shim issues. Keep them
    // external (installed as direct deps) so Node loads them natively as CJS.
    external: ['ws', 'undici'],
    noExternal: ['laikacms', 'effect', '@effect/platform-node', '@effect/platform-node-shared'],
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node24',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: false,
    dts: { entry: { index: 'src/index.ts' } },
    noExternal: ['laikacms'],
  },
]);
