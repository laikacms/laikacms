#!/usr/bin/env node
/**
 * Local starters build gate (LCMS-897).
 *
 * Mirrors the dead .github/workflows/starters.yml build job as a local check.
 * Builds the workspace packages that starters link to via starters/pnpm-workspace.yaml
 * overrides, installs the starters workspace, then typechecks + builds all six starters.
 *
 * Run: pnpm build:starters
 * Also wired into husky pre-push when starters/ or packages/ are changed.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startersRoot = resolve(repoRoot, 'starters');

const STARTERS = [
  'starter-vite-react-blog',
  'starter-hono-blog',
  'starter-workers-blog',
  'starter-astro-blog',
  'starter-github-blog',
  'starter-opfs-blog',
];

// Workspace packages the starters/ workspace links to via link: overrides
// (starters/pnpm-workspace.yaml overrides block). Their dist/ must exist
// before `pnpm install` in starters/ can resolve them.
const LINKED_PACKAGES = ['laikacms', '@laikacms/github'];

function run(cmd, args, cwd) {
  process.stdout.write(`  $ ${cmd} ${args.join(' ')}\n`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// 1. Build the linked workspace packages so link: overrides resolve.
console.log('\n▸ Building workspace packages…');
run(
  'pnpm',
  [...LINKED_PACKAGES.flatMap(pkg => ['--filter', pkg]), 'run', 'build'],
  repoRoot,
);

// 2. Install the starters workspace (link: overrides now point to built packages).
console.log('\n▸ Installing starters workspace…');
run('pnpm', ['install', '--no-frozen-lockfile'], startersRoot);

// 3. Typecheck + build each starter, collecting failures.
console.log('\n▸ Checking starters…');
const failures = [];

for (const starter of STARTERS) {
  process.stdout.write(`\n  [${starter}]\n`);
  let ok = true;
  try {
    run('pnpm', ['--filter', starter, 'run', 'typecheck'], startersRoot);
  } catch {
    ok = false;
  }
  try {
    run('pnpm', ['--filter', starter, 'run', '--if-present', 'build'], startersRoot);
  } catch {
    ok = false;
  }
  if (ok) {
    process.stdout.write(`  ✓ ${starter}\n`);
  } else {
    process.stderr.write(`  ✗ ${starter}\n`);
    failures.push(starter);
  }
}

if (failures.length > 0) {
  const list = failures.map(s => `  - ${s}`).join('\n');
  process.stderr.write(`\nERROR: starters gate FAILED — ${failures.length} starter(s) broken:\n${list}\n`);
  process.exit(1);
}

process.stdout.write('\nAll starters passed. ✓\n');
