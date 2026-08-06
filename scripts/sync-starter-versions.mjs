#!/usr/bin/env node
/**
 * Pin every starter's laikacms / @laikacms/* dependency to a caret range
 * against the package's current version. Run from the root `version` script,
 * right after `changeset version`, so a release automatically carries the new
 * version into the starters. Idempotent.
 *
 * Run: node scripts/sync-starter-versions.mjs
 */
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { applyRewrites, inspectStarter, starterPackageJsonPaths, workspaceVersions } from './starter-versions.mjs';

const versions = workspaceVersions();
let changed = 0;

for (const pkgPath of starterPackageJsonPaths()) {
  const { pkg, rewrites } = inspectStarter(pkgPath, versions);
  if (rewrites.length === 0) continue;
  writeFileSync(pkgPath, applyRewrites(pkg, versions));
  changed++;
  const rel = relative(process.cwd(), pkgPath);
  for (const r of rewrites) {
    console.log(`  ${rel}: ${r.name} ${r.from} → ${r.to}`);
  }
}

console.log(
  changed === 0
    ? 'sync-starter-versions: starters already in sync.'
    : `sync-starter-versions: updated ${changed} starter package.json file(s).`,
);
