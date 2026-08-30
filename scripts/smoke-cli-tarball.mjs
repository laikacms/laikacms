#!/usr/bin/env node
/**
 * Regression guard for the laikacli published tarball.
 *
 * Packs apps/cli, installs the tarball into a clean npm-only tree, and verifies
 * that `laikacli --version` boots without an ERR_MODULE_NOT_FOUND. This catches
 * Effect v4-beta reshuffles where two packages in the tree are pinned against
 * different snapshots of the module layout (the failure mode behind #926 / 0.1.1).
 *
 * Usage (from repo root, after `pnpm build`):
 *   node scripts/smoke-cli-tarball.mjs
 *
 * Requirements:
 *   - pnpm available (used to pack so catalog: entries are resolved to semver)
 *   - npm available (the smoke uses npm install, mimicking an npx user)
 *   - Node >= 24
 *   - apps/cli must already be built (dist/cli.js must exist)
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_DIR = resolve(import.meta.dirname, '../apps/cli');

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

let tmpDir;
let tgzPath;

try {
  // 1. Pack the CLI tarball using pnpm (resolves catalog: → real semver).
  console.log('Packing apps/cli with pnpm…');
  const packOut = run('pnpm pack --json', { cwd: CLI_DIR });
  // pnpm pack --json prints { name, version, filename, files[] }.
  const packed = JSON.parse(packOut);
  const filename = packed.filename;
  if (typeof filename !== 'string') throw new Error(`Unexpected pnpm pack output: ${packOut}`);
  tgzPath = resolve(CLI_DIR, filename);
  console.log(`Packed → ${tgzPath}`);

  // 2. Verify the packed package.json has no catalog: entries.
  //    pnpm resolves them — if any survive, something is wrong with the pack.
  const unpackOut = run(`tar -tzf "${tgzPath}" package/package.json`);
  if (unpackOut.trim()) {
    const pkgJson = run(`tar -xOf "${tgzPath}" package/package.json`);
    const pkg = JSON.parse(pkgJson);
    const allDeps = Object.assign(
      {},
      pkg.dependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    );
    const badEntries = Object.entries(allDeps).filter(([, v]) => typeof v === 'string' && v.includes('catalog:'));
    if (badEntries.length > 0) {
      throw new Error(
        `Packed tarball has unresolved catalog: entries:\n${
          badEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')
        }\nUse pnpm publish, not npm publish.`,
      );
    }
    console.log('No catalog: entries in packed package.json ✓');
  }

  // 3. Create a clean temp dir and install the tarball via npm (mirrors npx behaviour).
  tmpDir = mkdtempSync(join(tmpdir(), 'laikacli-smoke-'));
  console.log(`Smoke install dir: ${tmpDir}`);

  run(`npm init -y`, { cwd: tmpDir });
  console.log('Installing tarball via npm (this hits the registry for Effect deps)…');
  run(`npm install --save "${tgzPath}"`, { cwd: tmpDir, stdio: 'inherit' });

  // 4. Boot the CLI — any ERR_MODULE_NOT_FOUND fails here.
  console.log('Running laikacli --version…');
  const versionOut = run(`node node_modules/.bin/laikacli --version`, { cwd: tmpDir });
  console.log(`laikacli --version → ${versionOut.trim()}`);

  // 5. Sanity: the binary must print something containing a semver string.
  if (!/\d+\.\d+\.\d+/.test(versionOut.trim())) {
    throw new Error(`Unexpected --version output: ${versionOut.trim()}`);
  }

  console.log('\nSmoke test passed ✓');
} catch (err) {
  console.error('\nSmoke test FAILED:', err.message ?? err);
  process.exit(1);
} finally {
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  if (tgzPath) {
    try {
      rmSync(tgzPath, { force: true });
    } catch {
      // ignore
    }
  }
}
