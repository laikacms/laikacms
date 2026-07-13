/**
 * Smoke test for docs/quickstart-fs-decap.md (LCMS-413).
 *
 * Exercises both the npm and pnpm paths end-to-end:
 *   1. Fresh install following the quickstart verbatim
 *   2. esbuild bundles admin/index.ts → admin/bundle.js
 *   3. Server starts and /api/health returns 200
 *   4. Playwright confirms the Decap CMS admin UI really booted (Posts collection visible,
 *      no authentication error) — not merely that #nc-root mounted
 *
 * Note: this installs the PUBLISHED packages from npm, exactly as a reader of the quickstart would.
 * It therefore tests the last release, not the current workspace — a fix on develop does not turn
 * this harness green until it ships.
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

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

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

function log(msg) {
  console.log(`[qs-smoke] ${msg}`);
}
function ok(label) {
  log(`✓ ${label}`);
  passed++;
}
function fail(label, detail) {
  log(`✗ ${label}: ${detail}`);
  failed++;
}

/** Write the quickstart server.mjs into a temp dir. */
function writeServerMjs(dir) {
  writeFileSync(
    join(dir, 'server.mjs'),
    `
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
`,
  );
}

/** Write admin files into a temp dir. */
function writeAdminFiles(dir) {
  mkdirSync(join(dir, 'admin'), { recursive: true });
  writeFileSync(
    join(dir, 'admin', 'index.ts'),
    `
import { createLaikaBackend } from '@laikacms/decap/decap-cms-backend-laika';
import CMS from 'decap-cms-app';
const LaikaBackend = createLaikaBackend();
CMS.registerBackend('laika', LaikaBackend);
CMS.init();
`,
  );
  writeFileSync(
    join(dir, 'admin', 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Admin — LaikaCMS</title></head><body><script src="bundle.js"></script></body></html>`,
  );
  writeFileSync(
    join(dir, 'admin', 'config.yml'),
    `
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
`,
  );
}

/** Run a command synchronously in a directory, returning stdout. */
function run(cmd, cwd, opts = {}) {
  return execSync(cmd, { cwd, stdio: 'pipe', ...opts }).toString().trim();
}

/** Kill a spawned process group. */
function kill(proc) {
  try {
    process.kill(-proc.pid, 'SIGKILL');
    // eslint-disable-next-line no-empty
  } catch {}
}

/**
 * Wait for `path` on `port` to answer with a non-5xx.
 *
 * Probe only an endpoint that returns 200. Once the API answers a 401, every following request to
 * it from Node (`fetch` and `http.get` alike) fails with "terminated: other side closed" /
 * ECONNRESET, and the browser's /api/session fails too — so the old `/` probe, which is
 * unauthenticated and 401s, was breaking the very checks that ran after it. See LCMS-439.
 */
async function waitForPort(port, path = '/', ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}${path}`);
      if (r.status < 500) {
        await r.arrayBuffer(); // drain, so the connection is not left half-read
        return true;
      }
      // eslint-disable-next-line no-empty
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Assert GET /api/health returns 200 with status:"ok".
 *
 * No retry: waitForPort() has already seen this endpoint answer, so a transport error here is a
 * real failure. Retrying one was how the harness used to swallow LCMS-439.
 */
async function checkHealth(label) {
  let status;
  let raw;
  try {
    const r = await fetch(`http://localhost:${API_PORT}/api/health`);
    status = r.status;
    raw = await r.text();
  } catch (e) {
    fail(`${label} /api/health`, `${e.message}${e.cause ? `: ${e.cause.message}` : ''}`.slice(0, 200));
    return false;
  }
  if (status !== 200) {
    fail(`${label} /api/health`, `HTTP ${status}`);
    return false;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail(`${label} /api/health`, `unparseable body: ${JSON.stringify(raw.slice(0, 120))}`);
    return false;
  }
  if (body?.status !== 'ok') {
    fail(`${label} /api/health`, `unexpected body: ${raw.slice(0, 120)}`);
    return false;
  }
  ok(`${label} GET /api/health → 200 {"status":"ok",...}`);
  return true;
}

/**
 * Launch headless Chromium and report what the Decap admin UI actually rendered.
 *
 * Deliberately does NOT treat `#nc-root` as proof of success. Decap mounts that element before it
 * talks to the API, so it is present on a blank error screen too — an auth failure renders #nc-root
 * plus an "Authentication failed" toast and nothing else. Gating on it alone reported this harness
 * green while the admin was an unusable error screen. The signal that the admin genuinely booted is
 * the collection nav: `Posts` is only painted once config load and authentication have succeeded.
 */
async function checkUI(shotPrefix) {
  const empty = { ncRoot: false, collections: false, authError: '', bodyText: '', launched: false };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  } catch (e) {
    // A missing browser is an environment problem, not a quickstart failure — report it as a
    // failed assertion so the other path still runs, rather than aborting the whole harness.
    fail(
      `${shotPrefix} admin UI`,
      `could not launch chromium (npx playwright install chromium): ${e.message.split('\n')[0]}`,
    );
    return empty;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failedRequests = [];
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));

  try {
    await page.goto(`http://localhost:${SERVE_PORT}/`, { waitUntil: 'load', timeout: 15000 });

    // Wait for the real thing to appear rather than sleeping a fixed interval and hoping.
    const collections = await page
      .getByText('Posts', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true, () => false);

    // Screenshot AFTER the wait settles, so a failure shot shows the final error state.
    await page.screenshot({ path: join(SHOTS_DIR, `${shotPrefix}.png`), fullPage: false });

    const ncRoot = await page.evaluate(() => !!document.getElementById('nc-root'));
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const authError = /^.*Authentication failed.*$/im.exec(bodyText)?.[0]?.trim() ?? '';

    return { ncRoot, collections, authError, bodyText: bodyText.slice(0, 400), launched: true, failedRequests };
  } finally {
    await browser.close();
  }
}

/**
 * Assert a checkUI() result. Ordered most-diagnostic first: an auth toast explains a missing
 * collection nav, so report that rather than the symptom it causes.
 */
function assertUI(label, ui) {
  if (!ui.launched) return; // checkUI() already reported the launch failure
  const detail = ui.failedRequests?.length ? ` Failed requests: ${ui.failedRequests.slice(0, 3).join('; ')}` : '';

  if (ui.authError) {
    fail(`${label} admin UI`, `admin mounted but could not authenticate: "${ui.authError}".${detail}`);
  } else if (!ui.ncRoot) {
    fail(`${label} admin UI`, `#nc-root not found. Body: ${ui.bodyText.slice(0, 200)}${detail}`);
  } else if (!ui.collections) {
    fail(
      `${label} admin UI`,
      `#nc-root mounted but the "Posts" collection never rendered — the admin did not finish booting. `
        + `Body: ${ui.bodyText.slice(0, 200)}${detail}`,
    );
  } else {
    ok(`${label} admin UI renders (Posts collection visible, no auth error)`);
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
    run('npm install laikacms @laikacms/decap @hono/node-server hono', dir);
    ok('npm install core');
  } catch (e) {
    fail('npm install core', e.message.slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  log('npm install decap-cms-app + codemirror@5 (step §4a)...');
  try {
    run('npm install --legacy-peer-deps decap-cms-app @laikacms/decap-cms codemirror@5', dir);
    run('npm install --legacy-peer-deps --save-dev esbuild', dir);
    ok('npm install decap-cms-app');
  } catch (e) {
    fail('npm install decap-cms-app', e.message.slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  log('esbuild (step §5)...');
  try {
    run('npx esbuild admin/index.ts --bundle --outfile=admin/bundle.js --format=iife --target=es2020', dir);
    ok('npm esbuild bundle');
  } catch (e) {
    fail('npm esbuild', e.stderr?.toString().slice(0, 300) || e.message);
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  log('Starting API server...');
  const server = spawn('node', ['server.mjs'], { cwd: dir, detached: true, stdio: 'ignore' });
  const serve = spawn('npx', ['serve', 'admin/', '-p', String(SERVE_PORT), '-n'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
  });

  try {
    // Probe /api/health rather than '/': '/' answered 401 and wedged the server for Node
    // clients (LCMS-439 — fixed in develop, not yet in this published release). Revert to
    // '/' once a release containing the fix is published.
    const apiUp = await waitForPort(API_PORT, '/api/health');
    const serveUp = await waitForPort(SERVE_PORT, '/'); // static file server — no auth, no 401
    if (!apiUp) {
      fail('npm API server', 'did not start in time');
      return;
    }
    if (!serveUp) {
      fail('npm serve', 'did not start in time');
      return;
    }
    ok('npm server + serve running');

    await checkHealth('npm');

    assertUI('npm', await checkUI('npm'));
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
    run(
      'pnpm add --allow-build=esbuild --allow-build=msgpackr-extract laikacms @laikacms/decap @hono/node-server hono',
      dir,
    );
    ok('pnpm add core');
  } catch (e) {
    fail('pnpm add core', e.message.slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  log('pnpm add decap-cms-app (step §4a)...');
  try {
    run('pnpm add decap-cms-app @laikacms/decap-cms', dir);
    run('pnpm add -D esbuild', dir);
    ok('pnpm add decap-cms-app');
  } catch (e) {
    fail('pnpm add decap-cms-app', e.message.slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  log('esbuild (step §5)...');
  try {
    run('pnpm exec esbuild admin/index.ts --bundle --outfile=admin/bundle.js --format=iife --target=es2020', dir);
    ok('pnpm esbuild bundle');
  } catch (e) {
    fail('pnpm esbuild', e.message.slice(0, 200));
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  log('Starting API server...');
  const server = spawn('node', ['server.mjs'], { cwd: dir, detached: true, stdio: 'ignore' });
  const serve = spawn('npx', ['serve', 'admin/', '-p', String(SERVE_PORT), '-n'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
  });

  try {
    // Probe /api/health rather than '/': '/' answered 401 and wedged the server for Node
    // clients (LCMS-439 — fixed in develop, not yet in this published release). Revert to
    // '/' once a release containing the fix is published.
    const apiUp = await waitForPort(API_PORT, '/api/health');
    const serveUp = await waitForPort(SERVE_PORT, '/'); // static file server — no auth, no 401
    if (!apiUp) {
      fail('pnpm API server', 'did not start in time');
      return;
    }
    if (!serveUp) {
      fail('pnpm serve', 'did not start in time');
      return;
    }
    ok('pnpm server + serve running');

    await checkHealth('pnpm');

    assertUI('pnpm', await checkUI('pnpm'));
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
