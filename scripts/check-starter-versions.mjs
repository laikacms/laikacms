#!/usr/bin/env node
/**
 * CI guard for starters/ (download-and-go apps). Fails if any starter:
 *   1. carries a workspace: / catalog: / link: / file: dependency protocol
 *      (unusable outside this monorepo — a downloaded starter would not install), or
 *   2. pins a laikacms / @laikacms/* dependency to anything other than a caret
 *      range against the package's latest npm-published version (stale after a
 *      release, or bumped ahead of what's on npm).
 *
 * Versions are resolved from the npm registry, not from workspace package.json
 * files, so the guard reflects what users can actually install. Packages not
 * yet published fall back to their workspace version.
 *
 * Fix drift with: node scripts/sync-starter-versions.mjs
 *
 * Run: node scripts/check-starter-versions.mjs
 */
import { relative } from 'node:path';
import {
  inspectStarter,
  npmPublishedVersions,
  starterPackageJsonPaths,
  workspaceVersions,
} from './starter-versions.mjs';

const versions = npmPublishedVersions(workspaceVersions());
const problems = [];

for (const pkgPath of starterPackageJsonPaths()) {
  const { rewrites, protocols } = inspectStarter(pkgPath, versions);
  const rel = relative(process.cwd(), pkgPath);
  for (const p of protocols) {
    problems.push(
      `  ${rel}: ${p.field}.${p.name} uses workspace protocol "${p.range}" — starters must ship published semver.`,
    );
  }
  for (const r of rewrites) {
    problems.push(`  ${rel}: ${r.name} is "${r.from}", expected "${r.to}" (latest npm release).`);
  }
}

if (problems.length === 0) {
  console.log('check-starter-versions: all starters ship published, in-sync versions.');
  process.exit(0);
}

console.error(
  '\nERROR: starters/ have version drift or workspace-protocol dependencies.\n'
    + '       Run `node scripts/sync-starter-versions.mjs` to fix version drift;\n'
    + '       replace any workspace:/catalog: ranges with published semver.\n\n'
    + problems.join('\n')
    + '\n',
);
process.exit(1);
