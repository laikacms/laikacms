/**
 * Tests for decap-api/locks.ts — advisory entry locking.
 *
 * Two layers:
 *   1. buildLocksApi + createInMemoryLockStore directly — the state machine and
 *      HTTP status/body mapping, with an injected clock for TTL control.
 *   2. Through decapApi(...) — that /locks is auth-gated, that the owner id is
 *      derived from the authenticated user (not the body), and that /locks 404s
 *      when no store is configured.
 */

import { describe, expect, it, vi } from 'vitest';

import { decapApi } from './index.js';
import type { DecapOptions, User } from './index.js';
import { buildLocksApi, createInMemoryLockStore, DEFAULT_ENTRY_LOCK_TTL_MS } from './locks.js';
import type { LockOwner } from './locks.js';

// ---------------------------------------------------------------------------
// Layer 1: buildLocksApi directly
// ---------------------------------------------------------------------------

const ALICE: LockOwner = { id: 'alice@example.com', name: 'Alice' };
const BOB: LockOwner = { id: 'bob@example.com', name: 'Bob' };

function setup(now: () => number) {
  const store = createInMemoryLockStore(now);
  const api = buildLocksApi({ store, basePath: '/locks', now });
  const url = (key: string, refresh = false) =>
    `https://x/locks/${encodeURIComponent(key)}${refresh ? '/refresh' : ''}`;
  return {
    api,
    get: (key: string, owner: LockOwner) => api.fetch(new Request(url(key), { method: 'GET' }), owner),
    acquire: (key: string, owner: LockOwner, body?: unknown) =>
      api.fetch(
        new Request(url(key), { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
        owner,
      ),
    refresh: (key: string, owner: LockOwner) => api.fetch(new Request(url(key, true), { method: 'POST' }), owner),
    release: (key: string, owner: LockOwner) => api.fetch(new Request(url(key), { method: 'DELETE' }), owner),
  };
}

describe('buildLocksApi — acquire', () => {
  it('acquires a free lock and returns it with a TTL-based expiry', async () => {
    const t0 = 1_000_000;
    const { acquire } = setup(() => t0);

    const res = await acquire('posts/hello', ALICE, { owner: { name: 'Alice' } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.path).toBe('posts/hello');
    expect(data.owner).toEqual(ALICE);
    expect(new Date(data.acquiredAt).getTime()).toBe(t0);
    expect(new Date(data.expiresAt).getTime()).toBe(t0 + DEFAULT_ENTRY_LOCK_TTL_MS);
  });

  it('a second acquire by the SAME owner renews (200)', async () => {
    const { acquire } = setup(() => 1000);
    await acquire('c/s', ALICE);
    const res = await acquire('c/s', ALICE);
    expect(res.status).toBe(200);
  });

  it('an acquire by a DIFFERENT owner conflicts (409) and returns the current lock', async () => {
    const { acquire } = setup(() => 1000);
    await acquire('c/s', ALICE);
    const res = await acquire('c/s', BOB);
    expect(res.status).toBe(409);
    const { data } = await res.json();
    expect(data.owner).toEqual(ALICE);
  });

  it('force overrides another owner (200) and the new owner then holds it', async () => {
    const { acquire, get } = setup(() => 1000);
    await acquire('c/s', ALICE);
    const res = await acquire('c/s', BOB, { force: true });
    expect(res.status).toBe(200);
    const held = await (await get('c/s', ALICE)).json();
    expect(held.data.owner).toEqual(BOB);
  });

  it('takes over a stale (expired) lock without force', async () => {
    let t = 1000;
    const { acquire } = setup(() => t);
    await acquire('c/s', ALICE);
    t += DEFAULT_ENTRY_LOCK_TTL_MS + 1; // Alice's lock has expired
    const res = await acquire('c/s', BOB);
    expect(res.status).toBe(200);
  });

  it('uses the authenticated owner id, not the id in the request body (anti-spoof)', async () => {
    const { acquire } = setup(() => 1000);
    // Body claims to be Bob, but the authenticated owner passed to fetch() is Alice.
    const res = await acquire('c/s', ALICE, { owner: { id: 'bob@example.com', name: 'Impostor' } });
    const { data } = await res.json();
    expect(data.owner.id).toBe('alice@example.com'); // id from the session
    expect(data.owner.name).toBe('Impostor'); // display name from the body is allowed
  });
});

describe('buildLocksApi — get', () => {
  it('returns null for an unlocked entry', async () => {
    const { get } = setup(() => 1000);
    const { data } = await (await get('c/s', ALICE)).json();
    expect(data).toBeNull();
  });

  it('returns null once the lock has expired (TTL)', async () => {
    let t = 1000;
    const { acquire, get } = setup(() => t);
    await acquire('c/s', ALICE);
    t += DEFAULT_ENTRY_LOCK_TTL_MS + 1;
    const { data } = await (await get('c/s', ALICE)).json();
    expect(data).toBeNull();
  });
});

describe('buildLocksApi — refresh', () => {
  it('extends the TTL for the holder', async () => {
    let t = 1000;
    const { acquire, refresh } = setup(() => t);
    const first = await (await acquire('c/s', ALICE)).json();
    t += 60_000;
    const res = await refresh('c/s', ALICE);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(new Date(first.data.expiresAt).getTime());
  });

  it('conflicts (409) when someone else force-took the lock', async () => {
    const { acquire, refresh } = setup(() => 1000);
    await acquire('c/s', ALICE);
    await acquire('c/s', BOB, { force: true });
    const res = await refresh('c/s', ALICE);
    expect(res.status).toBe(409);
  });

  it('reclaims silently (200) when the prior lock had already expired', async () => {
    let t = 1000;
    const { acquire, refresh } = setup(() => t);
    await acquire('c/s', ALICE);
    t += DEFAULT_ENTRY_LOCK_TTL_MS + 1;
    expect((await refresh('c/s', ALICE)).status).toBe(200);
  });
});

describe('buildLocksApi — release', () => {
  it('releases a lock held by the caller (204) and the entry is then unlocked', async () => {
    const { acquire, release, get } = setup(() => 1000);
    await acquire('c/s', ALICE);
    expect((await release('c/s', ALICE)).status).toBe(204);
    const { data } = await (await get('c/s', ALICE)).json();
    expect(data).toBeNull();
  });

  it('is a no-op when the caller is not the holder (does not evict the new owner)', async () => {
    const { acquire, release, get } = setup(() => 1000);
    await acquire('c/s', ALICE);
    await release('c/s', BOB); // Bob doesn't hold it
    const { data } = await (await get('c/s', ALICE)).json();
    expect(data.owner).toEqual(ALICE);
  });
});

describe('buildLocksApi — malformed requests', () => {
  it('400 when the key is missing', async () => {
    const api = buildLocksApi({ store: createInMemoryLockStore(), basePath: '/locks' });
    expect((await api.fetch(new Request('https://x/locks/'), ALICE)).status).toBe(400);
  });

  it('405 for an unsupported method', async () => {
    const { api } = setup(() => 1000);
    const res = await api.fetch(new Request('https://x/locks/c%2Fs', { method: 'PUT' }), ALICE);
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: through decapApi(...)
// ---------------------------------------------------------------------------

const MOCK_USER: User = { id: 'u1', email: 'alice@example.com', name: 'Alice' };

function makeOptions(overrides: Partial<DecapOptions> = {}): DecapOptions {
  return {
    documents: {} as DecapOptions['documents'],
    storage: {} as DecapOptions['storage'],
    authenticateAccessToken: vi.fn().mockResolvedValue(MOCK_USER),
    authorize: () => true,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

const authed = (path: string, method = 'GET', body?: unknown) =>
  new Request(`https://example.com${path}`, {
    method,
    headers: { Authorization: 'Bearer valid-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('decapApi /locks integration', () => {
  it('mounts /locks when a store is provided and derives the owner from the authenticated user', async () => {
    const api = decapApi(makeOptions({ locks: createInMemoryLockStore() }));

    const res = await api.fetch(authed('/locks/posts%2Fhello', 'POST', { owner: { name: 'Alice' } }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.owner.id).toBe('alice@example.com'); // = user.email, not from the body
    expect(data.path).toBe('posts/hello');
  });

  it('404s on /locks when no store is configured (client degrades to unsupported)', async () => {
    const api = decapApi(makeOptions()); // no `locks`
    const res = await api.fetch(authed('/locks/posts%2Fhello', 'POST'));
    expect(res.status).toBe(404);
  });

  it('requires authentication (401 without a token)', async () => {
    const api = decapApi(makeOptions({ locks: createInMemoryLockStore() }));
    const res = await api.fetch(new Request('https://example.com/locks/posts%2Fhello'));
    expect(res.status).toBe(401);
  });

  it('honours the authorize gate (403 when denied)', async () => {
    const api = decapApi(makeOptions({ locks: createInMemoryLockStore(), authorize: () => false }));
    const res = await api.fetch(authed('/locks/posts%2Fhello', 'POST'));
    expect(res.status).toBe(403);
  });

  it('exposes the decoded lock key to authorize as itemId/collection', async () => {
    const authorize = vi.fn().mockReturnValue(true);
    const api = decapApi(makeOptions({ locks: createInMemoryLockStore(), authorize }));
    await api.fetch(authed('/locks/posts%2Fhello', 'POST'));
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'locks', collection: 'posts', itemId: 'posts/hello' }),
    );
  });
});
