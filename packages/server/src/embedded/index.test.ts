/**
 * Unit tests for embedded/index.ts — createEmbeddedLaika
 *
 * Covers:
 *   - DEFAULT_DEV_TOKEN constant
 *   - dev auth: correct bearer → 200; wrong bearer → 401
 *   - token auth: authenticate() callback wired and receives bearer value
 *   - config seeding: missing config.yml written on first fetch(); idempotent on second
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmbeddedLaika, DEFAULT_DEV_TOKEN } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://example.com';

function makeRequest(apiPath: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE_URL}${apiPath}`, { headers });
}

const DEFAULT_DECAP_CONFIG = {
  backend: { name: 'laika', api_url: '/api/decap' },
  media_folder: 'public/uploads',
  collections: [],
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-embedded-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeEmbedded(overrides: Parameters<typeof createEmbeddedLaika>[0] = {} as never) {
  return createEmbeddedLaika({
    contentDir: tmpDir,
    decapConfig: DEFAULT_DECAP_CONFIG,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Suite: DEFAULT_DEV_TOKEN
// ---------------------------------------------------------------------------

describe('DEFAULT_DEV_TOKEN', () => {
  it('is a non-empty string', () => {
    expect(typeof DEFAULT_DEV_TOKEN).toBe('string');
    expect(DEFAULT_DEV_TOKEN.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: dev auth mode
// ---------------------------------------------------------------------------

describe('dev auth — correct token', () => {
  it('returns 200 for /health without authentication (health is always public)', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev' } });
    const res = await fetch(makeRequest('/api/decap/health'));

    expect(res.status).toBe(200);
  });

  it('returns 200 for /session with the default dev bearer token', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev' } });
    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` }),
    );

    expect(res.status).toBe(200);
  });

  it('returns the dev user identity on /session', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev' } });
    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` }),
    );
    const body = await res.json() as { data: { id: string, attributes: { email: string } } };

    expect(body.data.id).toBe('dev');
    expect(body.data.attributes.email).toBe('dev@local.test');
  });

  it('accepts a custom devToken override', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev', devToken: 'my-custom-token' } });
    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer my-custom-token' }),
    );

    expect(res.status).toBe(200);
  });

  it('rejects the default dev token when a custom devToken is configured', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev', devToken: 'my-custom-token' } });
    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` }),
    );

    expect(res.status).toBe(401);
  });
});

describe('dev auth — wrong token → 401', () => {
  it('returns 401 when bearer token does not match DEFAULT_DEV_TOKEN', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev' } });
    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer wrong-token' }),
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 when no Authorization header is supplied', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev' } });
    const res = await fetch(makeRequest('/api/decap/session'));

    expect(res.status).toBe(401);
  });

  it('returns 401 for an empty bearer value', async () => {
    const { fetch } = makeEmbedded({ auth: { mode: 'dev' } });
    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer ' }),
    );

    expect(res.status).toBe(401);
  });

  it('defaults to dev auth when no auth option is supplied', async () => {
    const { fetch } = makeEmbedded({ auth: undefined });

    const authed = await fetch(
      makeRequest('/api/decap/session', { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` }),
    );
    expect(authed.status).toBe(200);

    const rejected = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer not-the-default' }),
    );
    expect(rejected.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: token auth mode
// ---------------------------------------------------------------------------

describe('token auth — authenticate() delegation', () => {
  it('calls the authenticate callback with the bearer token value', async () => {
    const authenticate = vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@example.com' });
    const { fetch } = makeEmbedded({ auth: { mode: 'token', authenticate } });

    await fetch(makeRequest('/api/decap/session', { Authorization: 'Bearer user-api-token' }));

    expect(authenticate).toHaveBeenCalledWith('user-api-token');
  });

  it('returns 200 when authenticate resolves with a User', async () => {
    const authenticate = vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@example.com' });
    const { fetch } = makeEmbedded({ auth: { mode: 'token', authenticate } });

    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer valid-token' }),
    );

    expect(res.status).toBe(200);
  });

  it('shapes /session response with the User returned by authenticate', async () => {
    const user = { id: 'alice', email: 'alice@example.com', name: 'Alice' };
    const authenticate = vi.fn().mockResolvedValue(user);
    const { fetch } = makeEmbedded({ auth: { mode: 'token', authenticate } });

    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer alice-token' }),
    );
    const body = await res.json() as { data: { id: string, attributes: { email: string } } };

    expect(body.data.id).toBe('alice');
    expect(body.data.attributes.email).toBe('alice@example.com');
  });

  it('returns 401 when authenticate throws', async () => {
    const authenticate = vi.fn().mockRejectedValue(new Error('bad token'));
    const { fetch } = makeEmbedded({ auth: { mode: 'token', authenticate } });

    const res = await fetch(
      makeRequest('/api/decap/session', { Authorization: 'Bearer bad-token' }),
    );

    expect(res.status).toBe(401);
  });

  it('does not call authenticate when no bearer token is present', async () => {
    const authenticate = vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@example.com' });
    const { fetch } = makeEmbedded({ auth: { mode: 'token', authenticate } });

    await fetch(makeRequest('/api/decap/session'));

    expect(authenticate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: config seeding
//
// The storage backend seeds the config using the key 'config.yml' but
// resolves the final extension from the repository's default (i.e. 'md'), so
// the file lands as 'config.md'. What matters functionally:
//   1. Some config file appears in contentDir after the first fetch().
//   2. A pre-existing 'config.yml' is NOT overwritten (resolvePathWithExtension
//      finds it before attempting to create).
//   3. The seed does not re-run on subsequent fetch() calls (configSeeded flag).
// ---------------------------------------------------------------------------

async function findConfigFile(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir);
  const found = entries.find(e => e.startsWith('config.'));
  return found ? path.join(dir, found) : null;
}

describe('config seeding', () => {
  it('creates a config file in contentDir on the first fetch() when none is present', async () => {
    const decapConfig = { backend: { name: 'laika' }, collections: [{ name: 'posts' }] };
    const { fetch } = makeEmbedded({ decapConfig });

    await fetch(makeRequest('/api/decap/health'));

    const seeded = await findConfigFile(tmpDir);
    expect(seeded).not.toBeNull();
  });

  it('seeded config file content encodes the decapConfig object', async () => {
    const decapConfig = { backend: { name: 'laika' }, collections: [{ name: 'posts' }] };
    const { fetch } = makeEmbedded({ decapConfig });

    await fetch(makeRequest('/api/decap/health'));

    const seeded = await findConfigFile(tmpDir);
    expect(seeded).not.toBeNull();
    const raw = await fs.readFile(seeded!, 'utf8');
    expect(raw).toContain('laika');
    expect(raw).toContain('posts');
  });

  it('does NOT overwrite a pre-existing config.yml on the first fetch()', async () => {
    const existing = 'backend:\n  name: existing\n';
    await fs.writeFile(path.join(tmpDir, 'config.yml'), existing, 'utf8');

    const { fetch } = makeEmbedded({ decapConfig: { backend: { name: 'new' } } });
    await fetch(makeRequest('/api/decap/health'));

    const raw = await fs.readFile(path.join(tmpDir, 'config.yml'), 'utf8');
    expect(raw).toBe(existing);
  });

  it('is idempotent — second fetch() does not write a second config file', async () => {
    const { fetch } = makeEmbedded({});
    await fetch(makeRequest('/api/decap/health'));

    const seeded = await findConfigFile(tmpDir);
    expect(seeded).not.toBeNull();
    const stat1 = await fs.stat(seeded!);

    await fetch(makeRequest('/api/decap/health'));

    const stat2 = await fs.stat(seeded!);
    // mtime unchanged proves the file was not re-written on the second call
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
  });
});

// ---------------------------------------------------------------------------
// Suite: returned EmbeddedLaika object
// ---------------------------------------------------------------------------

describe('EmbeddedLaika shape', () => {
  it('exposes a documents repository', () => {
    const embedded = makeEmbedded({});
    expect(embedded.documents).toBeDefined();
  });

  it('exposes a storage repository', () => {
    const embedded = makeEmbedded({});
    expect(embedded.storage).toBeDefined();
  });

  it('exposes an assets repository', () => {
    const embedded = makeEmbedded({});
    expect(embedded.assets).toBeDefined();
  });

  it('exposes a fetch handler', () => {
    const embedded = makeEmbedded({});
    expect(typeof embedded.fetch).toBe('function');
  });

  it('uses a custom basePath when provided', async () => {
    const { fetch } = makeEmbedded({ basePath: '/cms' });

    const hit = await fetch(makeRequest('/cms/health'));
    expect(hit.status).toBe(200);

    const miss = await fetch(makeRequest('/api/decap/health'));
    expect(miss.status).not.toBe(200);
  });
});
