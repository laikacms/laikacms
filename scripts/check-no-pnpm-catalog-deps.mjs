#!/usr/bin/env node
/**
 * Prepublish guard: reject any package.json dependency value containing the
 * "catalog:" pnpm workspace protocol. pnpm resolves these automatically during
 * `pnpm pack` / `pnpm publish`; other package managers do not, which causes the
 * published package to be unusable (EUNSUPPORTEDPROTOCOL on install).
 *
 * Skips the check when running under pnpm — pnpm resolves catalog: entries in
 * the packed tarball before this script's output reaches npm.
 *
 * Run: node scripts/check-no-pnpm-catalog-deps.mjs (from the package directory)
 */
import { readFileSync } from 'node:fs';

const userAgent = process.env['npm_config_user_agent'] ?? '';
if (userAgent.startsWith('pnpm/')) {
  // pnpm will resolve catalog: → real semver in the tarball; nothing to guard.
  process.exit(0);
}

const raw = readFileSync('./package.json', 'utf8');
const pkg = JSON.parse(raw);

const depFields = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];
const bad = [];

for (const field of depFields) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version === 'string' && version.includes('catalog:')) {
      bad.push(`  ${field}.${name}: "${version}"`);
    }
  }
}

if (bad.length === 0) process.exit(0);

console.error(
  `\nERROR: ${pkg.name} has unresolved pnpm catalog: entries in package.json.\n`
    + `       Use "pnpm publish" (not "npm publish") — pnpm resolves catalog: to\n`
    + `       real semver ranges before packing. npm ships them as-is, producing\n`
    + `       an unusable package (EUNSUPPORTEDPROTOCOL on install).\n\n`
    + `       Affected entries:\n`
    + bad.join('\n')
    + '\n',
);
process.exit(1);
