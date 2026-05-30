#!/usr/bin/env node
/**
 * Generates `src/client/routeTree.gen.ts` using @tanstack/router-generator.
 *
 * TanStack Router normally generates this file via its Vite plugin during
 * `vite dev` / `vite build`. Running `tsc --noEmit` directly (typecheck)
 * skips Vite, so the generated file may be absent in a fresh checkout.
 *
 * This script replicates what the Vite plugin does so that:
 *   - `pnpm typecheck` works standalone without a prior vite build
 *   - CI gets a deterministic type-check without starting a dev server
 *
 * Resolution strategy: @tanstack/router-generator is a peer/dep of
 * @tanstack/router-plugin (our devDep). We resolve the generator by
 * following the real path of router-plugin's install location in the
 * pnpm store, then requiring router-generator from there.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const appNodeModules = resolve(appRoot, 'node_modules');

// @tanstack/router-generator is installed alongside @tanstack/router-plugin
// (our devDep). Resolve it via router-plugin's real location in the pnpm
// content-addressable store so pnpm's symlink structure doesn't confuse Node.
const routerPluginReal = realpathSync(resolve(appNodeModules, '@tanstack/router-plugin'));
const req = createRequire(resolve(routerPluginReal, 'dist/esm/index.js'));
const generatorEntry = req.resolve('@tanstack/router-generator');

// configSchema is a named export from the main router-generator entry point.
const { Generator, configSchema } = await import(generatorEntry);

const config = configSchema.parse({
  target: 'react',
  routesDirectory: resolve(appRoot, 'src/client/routes'),
  generatedRouteTree: resolve(appRoot, 'src/client/routeTree.gen.ts'),
  tmpDir: resolve(appRoot, '.tanstack/tmp'),
});

mkdirSync(resolve(appRoot, '.tanstack/tmp'), { recursive: true });

const gen = new Generator({ config, root: appRoot });
await gen.run();
console.log('[routes] routeTree.gen.ts written');
