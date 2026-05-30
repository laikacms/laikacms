import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LCT-179: smoke test that proves `scripts/setup-vendor.mjs` actually cloned and
 * built the vendored `@laikacms/decap` v4 fork into a consumable ESM artefact
 * under `.vendor/laikacms-decap/dist`.
 *
 * The fork is consumed exclusively through Vite (see `vite.config.ts`, which
 * aliases `@laikacms/decap/*` subpaths into this dist). Its TypeScript ESM build
 * emits extensionless relative imports, so the artefact is bundler-only and can
 * NOT be `import()`-ed directly in a node test runner. We therefore assert the
 * public surface statically — which still proves the build materialised real,
 * non-stub ESM, not just empty files:
 *
 *   1. The `core` and `app` entry files exist — proves `setup-vendor.mjs` ran
 *      the fork's `tsc` ESM build.
 *   2. `core/index.js` exposes the `DecapCmsCore` namespace (default + named)
 *      and re-exports the extension `Registry`.
 *   3. `core/lib/registry.js` defines the real registration functions
 *      (`registerWidget`, `registerBackend`) — callable code, not stub exports.
 *   4. `app/index.js` exposes the `init` entrypoint that mounts the CMS (the
 *      "tie it together" step the fork moved out of `core`'s old bootstrap).
 */

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, '../.vendor/laikacms-decap/dist');
const coreEntry = resolve(distRoot, 'core/index.js');
const registryEntry = resolve(distRoot, 'core/lib/registry.js');
const appEntry = resolve(distRoot, 'app/index.js');

describe('@laikacms/decap fork vendor smoke test', () => {
  it('produced the core + app ESM entry artefacts for the fork', () => {
    expect(existsSync(coreEntry)).toBe(true);
    expect(existsSync(appEntry)).toBe(true);
  });

  it('core entry exposes the DecapCmsCore namespace + Registry', () => {
    const src = readFileSync(coreEntry, 'utf8');
    expect(src).toContain('export const DecapCmsCore');
    expect(src).toContain('export default DecapCmsCore');
    expect(src).toContain('export { Registry }');
  });

  it('registry artefact defines the real registration functions', () => {
    const src = readFileSync(registryEntry, 'utf8');
    expect(src).toContain('export function registerWidget');
    expect(src).toContain('export function registerBackend');
  });

  it('app entry exposes the init mount entrypoint', () => {
    const src = readFileSync(appEntry, 'utf8');
    expect(src).toContain('export function init');
  });
});
