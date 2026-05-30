import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LCT-179 / LCMS-016: smoke test that proves the vendored `decap-cms` fork's
 * build step actually materialised a consumable ESM artefact.
 *
 * The fork is cloned + built by `scripts/setup-vendor.mjs` into
 * `.vendor/laikacms-decap/` (inside the app directory). The Vite config
 * aliases `@laikacms/decap/*` → `.vendor/laikacms-decap/dist/*`.
 *
 * The vendor build uses TypeScript (`tsc`) and emits ESM output directly
 * (no Babel ESM step like the old `build-decap-fork.sh`). The dist layout is
 * one directory per package subpath, so the `core` module lives at
 * `.vendor/laikacms-decap/dist/core/index.js`.
 *
 * Implementation note: we do NOT exercise the full import graph here because
 * deep imports traverse browser-only packages (react-router-dom, etc.).
 * Those are bundled by the app's Vite build (covered by the `pnpm build`
 * acceptance gate). Instead we:
 *
 *   1. Assert the dist/core entry file exists — proves `setup-vendor.mjs`
 *      ran and the fork built successfully.
 *   2. Statically inspect the artefact for the public surface markers
 *      (`DecapCmsCore` namespace export, default export).
 *   3. Dynamically import the leaf source module that defines the registry
 *      and assert that its default export contains callable functions —
 *      exercising the real, just-built ESM file end-to-end.
 */

const here = dirname(fileURLToPath(import.meta.url));
// The vendor is cloned into the app's .vendor/ directory by setup-vendor.mjs
const vendorDist = resolve(here, '../.vendor/laikacms-decap/dist');
const coreDistEntry = resolve(vendorDist, 'core/index.js');

describe('decap-cms-core ESM postinstall smoke test', () => {
  it('produced a dist/core/index.js artefact for the fork', () => {
    expect(existsSync(coreDistEntry)).toBe(true);
  });

  it('artefact exposes the DecapCmsCore namespace and default export', () => {
    const src = readFileSync(coreDistEntry, 'utf8');
    expect(src).toContain('export const DecapCmsCore');
    expect(src).toContain('export default DecapCmsCore');
  });

  it('imports the registry module and confirms it exports callable functions', async () => {
    // Import the registry module directly — it's the leaf module that defines
    // the registration functions (registerWidget, registerBackend, etc.).
    // Importing it avoids pulling in browser-only side imports from bootstrap.
    const registryMod: Record<string, unknown> = await import(
      resolve(vendorDist, 'core/lib/registry.js')
    );
    expect(registryMod).toBeDefined();

    // The registry module exports a default object and named function exports.
    // Check the named function exports to prove the build emitted callable JS.
    const callableKeys = Object.keys(registryMod).filter(
      k => typeof (registryMod as Record<string, unknown>)[k] === 'function',
    );
    expect(callableKeys.length).toBeGreaterThan(0);
  });
});
