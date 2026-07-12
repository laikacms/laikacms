/**
 * Smoke test for docs/quickstart-fs-decap.md (LCMS-413).
 *
 * Exercises both the npm and pnpm paths end-to-end:
 *   1. Fresh install following the quickstart verbatim
 *   2. esbuild bundles admin/index.ts → admin/bundle.js
 *   3. Server starts and /api/health returns 200
 *   4. Playwright confirms the Decap CMS admin UI renders (#nc-root found)
 *
 * Prerequisites:
 *   cd browser-sim && npm install   (installs playwright)
 *   npx playwright install chromium  (downloads chromium)
 *
 * Usage:
 *   node browser-sim/quickstart-smoke.mjs [--npm-only | --pnpm-only]
 *
 * Ports used: API :3100, admin :5100 (avoids conflicts with dev servers on 3000/5000).
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const API_PORT = 3100;
const SERVE_PORT = 5100;
const SHOTS_DIR = new URL('shots/', import.meta.url).pathname;

mkdirSync(SHOTS_DIR, { recursive: true });

const args = process.argv.slice(2);
const runNpm = !args.includes('--pnpm-only');
const runPnpm = !args.includes('--npm-only');

let passed = 0;
let failed = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) { console.log(`[qs-smoke] ${msg}`); }
function ok(label) { log(`✓ ${label}`); passed++; }
function fail(label, detail) { log(`✗ ${label}: ${detail}`); failed++; }

/** Write the quickstart server.mjs into a temp dir. */
function writeServerMjs(dir) {
  writeFileSync(join(dir, 'server.mjs'), `
import { serve } from '@hono/node-server';
import { decapApi } from '@laikacms/decap/decap-api';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DefaultContentBaseSettingsProvider } from 'laikacms/contentbase-settings-default';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const settings = new DefaultContentBaseSettingsProvider({ storage });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const api = decapApi({
  documents, storage, assets,
  basePath: '/api',
  authenticateAccessToken: async token => {
    if (token !== 'dev-secret-change-me') throw new Error('Invalid token');
    return { id: 'dev', email: 'dev@localhost' };
  },
  cors: { origins: ['http://localhost:${SERVE_PORT}'] },
});

serve({ fetch: api.fetch, port: ${API_PORT} }, () =>
  console.log('LaikaCMS API listening on http://localhost:${API_PORT}'),
);
`);
}

/** Write admin files into a temp dir. */
function writeAdminFiles(dir) {
  mkdirSync(join(dir, 'admin'), { recursive: true });
  writeFileSync(join(dir, 'admin', 'index.ts'), `
import { createLaikaBackend } from '@laikacms/decap/decap-cms-backend-laika';
import CMS from 'decap-cms-app';
const LaikaBackend = createLaikaBackend();
CMS.registerBackend('laika', LaikaBackend);
CMS.init();
`);
  writeFileSync(join(dir, 'admin', 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Admin — LaikaCMS</title></head><body><script src="bundle.js"></script></body></html>`);
  writeFileSync(join(dir, 'admin', 'config.yml'), `
backend:
  name: laika
  base_url: http://localhost:${API_PORT}
  api_root: /api
  dev_token: dev-secret-change-me
media_folder: uploads
public_folder: /uploads
collections:
  - name: posts
    label: Posts
    folder: posts
    create: true
    fields:
      - { name: title, label: Title, widget: string }
      - { name: body,  label: Body,  widget: markdown }
`);
}

/** Run a command synchronously in a directory, returning stdout. */
function run(cmd, cwd, opts = {}) {
  return execSync(cmd, { cwd, stdio: 'pipe', ...opts }).toString().trim();
}

/** Kill a spawned process group. */
function kill(proc) {
  try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
}

/** Wait for a port to become reachable. */
async function waitForPort(port, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok || r.status < 500) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/** Launch headless Chromium and verify the Decap admin UI renders. */
async function checkUI(shotPrefix) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  try {
    await page.goto(`http://localhost:${SERVE_PORT}/`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(7000);
    await page.screenshot({ path: join(SHOTS_DIR, `${shotPrefix}.png`), fullPage: false });

    const ncRoot = await page.evaluate(() => !!document.getElementById('nc-root'));
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    return { ncRoot, bodyText: bodyText.slice(0, 400) };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// npm path
// ---------------------------------------------------------------------------

async function testNpm() {
  log('--- npm path ---');
  const dir = join(tmpdir(), `qs-npm-smoke-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } }));
  writeServerMjs(dir);
  writeAdminFiles(dir);

  log('npm install (step §1)...');
  try {
    run('npm install --legacy-peer-deps laikacms @laikacms/decap @hono/node-server hono', dir);
    ok('npm install core (with hono)');
  } catch (e) {
    fail('npm install core', e.message.slice(0, 200));
    return;
  }

  log('npm install decap-cms-app + codemirror@5 (step §4a)...');
  try {
    run('npm install --legacy-peer-deps decap-cms-app @laikacms/decap-cms codemirror@5', dir);
    run('npm install --legacy-peer-deps --save-dev esbuild', dir);
    ok('npm install decap-cms-app');
  } catch (e) {
    fail('npm install decap-cms-app', e.message.slice(0, 200));
    return;
  }

  log('esbuild (step §5)...');
  try {
    run('npx esbuild admin/index.ts --bundle --outfile=admin/bundle.js --format=iife --target=es2020', dir);
    ok('npm esbuild bundle');
  } catch (e) {
    fail('npm esbuild', e.stderr?.toString().slice(0, 300) || e.message);
    return;
  }

  log('Starting API server...');
  const server = spawn('node', ['server.mjs'], { cwd: dir, detached: true, stdio: 'ignore' });
  const serve = spawn('npx', ['serve', 'admin/', '-p', String(SERVE_PORT), '-n'], { cwd: dir, detached: true, stdio: 'ignore' });

  try {
    const apiUp = await waitForPort(API_PORT);
    const serveUp = await waitForPort(SERVE_PORT);
    if (!apiUp) { fail('npm API server', 'did not start in time'); return; }
    if (!serveUp) { fail('npm serve', 'did not start in time'); return; }
    ok('npm server + serve running');

    const { ncRoot, bodyText } = await checkUI('npm');
    if (ncRoot) {
      ok(`npm admin UI renders (#nc-root found)`);
      log(`  body text: ${bodyText.slice(0, 100).replace(/\n/g, ' ')}`);
    } else {
      fail('npm admin UI', `#nc-root not found. Body: ${bodyText.slice(0, 200)}`);
    }
  } finally {
    kill(server);
    kill(serve);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// pnpm path
// ---------------------------------------------------------------------------

async function testPnpm() {
  log('--- pnpm path ---');
  const dir = join(tmpdir(), `qs-pnpm-smoke-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } }));
  writeServerMjs(dir);
  writeAdminFiles(dir);

  log('pnpm add core (step §1)...');
  try {
    run('pnpm add laikacms @laikacms/decap @hono/node-server', dir);
    ok('pnpm add core');
  } catch (e) {
    fail('pnpm add core', e.message.slice(0, 200));
    return;
  }

  log('pnpm add decap-cms-app (step §4a)...');
  try {
    run('pnpm add decap-cms-app @laikacms/decap-cms', dir);
    run('pnpm add -D esbuild', dir);
    run('pnpm rebuild esbuild', dir);
    ok('pnpm add decap-cms-app');
  } catch (e) {
    fail('pnpm add decap-cms-app', e.message.slice(0, 200));
    return;
  }

  log('esbuild (step §5)...');
  try {
    run('pnpm exec esbuild admin/index.ts --bundle --outfile=admin/bundle.js --format=iife --target=es2020', dir);
    ok('pnpm esbuild bundle');
  } catch (e) {
    fail('pnpm esbuild', e.message.slice(0, 200));
    return;
  }

  log('Starting API server...');
  const server = spawn('node', ['server.mjs'], { cwd: dir, detached: true, stdio: 'ignore' });
  const serve = spawn('npx', ['serve', 'admin/', '-p', String(SERVE_PORT), '-n'], { cwd: dir, detached: true, stdio: 'ignore' });

  try {
    const apiUp = await waitForPort(API_PORT);
    const serveUp = await waitForPort(SERVE_PORT);
    if (!apiUp) { fail('pnpm API server', 'did not start in time'); return; }
    if (!serveUp) { fail('pnpm serve', 'did not start in time'); return; }
    ok('pnpm server + serve running');

    const { ncRoot, bodyText } = await checkUI('pnpm');
    if (ncRoot) {
      ok(`pnpm admin UI renders (#nc-root found)`);
      log(`  body text: ${bodyText.slice(0, 100).replace(/\n/g, ' ')}`);
    } else {
      fail('pnpm admin UI', `#nc-root not found. Body: ${bodyText.slice(0, 200)}`);
    }
  } finally {
    kill(server);
    kill(serve);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (runNpm) await testNpm();
if (runPnpm) await testPnpm();

log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
