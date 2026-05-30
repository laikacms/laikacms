#!/usr/bin/env node
/**
 * Clone the laikacms/decap-cms v4.beta fork into `.vendor/laikacms-decap`
 * and build it in-place. We can't consume the fork as a regular npm dep
 * because its package.json uses pnpm `catalog:*` specifiers, which are
 * only resolved inside its own workspace (or rewritten by `pnpm publish`).
 *
 * The vendor dir is its own pnpm workspace: running `pnpm install` inside
 * it resolves the catalog refs against its own `pnpm-workspace.yaml`, and
 * `pnpm build` (= `tsc -p tsconfig.build.json && pnpm copy:assets`)
 * produces `dist/` with the subpath outputs we alias from vite/tsconfig.
 *
 * Skips the build when `dist/core/index.js` already exists. Re-run with
 * `LAIKACMS_DECAP_FORCE=1` (or delete `.vendor/`) to refresh.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'https://github.com/laikacms/decap-cms.git';
const BRANCH = 'v4.beta';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const vendorDir = resolve(appRoot, '.vendor', 'laikacms-decap');
const distMarker = resolve(vendorDir, 'dist', 'core', 'index.js');
const force = process.env.LAIKACMS_DECAP_FORCE === '1';

function run(cmd, args, cwd) {
  console.log(`[vendor] $ ${cmd} ${args.join(' ')}  (cwd: ${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`[vendor] ${cmd} exited with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

if (!force && existsSync(distMarker)) {
  console.log('[vendor] dist/ present — skipping (set LAIKACMS_DECAP_FORCE=1 to refresh)');
  process.exit(0);
}

if (existsSync(resolve(vendorDir, '.git'))) {
  console.log(`[vendor] refreshing existing clone at ${vendorDir}`);
  run('git', ['fetch', 'origin', BRANCH], vendorDir);
  run('git', ['reset', '--hard', `origin/${BRANCH}`], vendorDir);
  run('git', ['clean', '-fdx', '--exclude=node_modules', '--exclude=dist'], vendorDir);
} else {
  console.log(`[vendor] cloning ${REPO_URL}#${BRANCH} into ${vendorDir}`);
  run('git', ['clone', '--branch', BRANCH, '--depth', '1', REPO_URL, vendorDir], appRoot);
}

run('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], vendorDir);
run('pnpm', ['run', 'build'], vendorDir);

if (!existsSync(distMarker)) {
  console.error(`[vendor] build finished but ${distMarker} is missing`);
  process.exit(1);
}
console.log('[vendor] OK');
