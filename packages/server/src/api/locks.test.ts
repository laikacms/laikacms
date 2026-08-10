/**
 * Tests for api/locks.ts — advisory entry locking as an adapter over the
 * documents repository's lock methods (ADR-007).
 *
 * Two layers:
 *   1. buildLocksApi over an InProcessLockManager-backed repository — the HTTP
 *      status/body mapping, with an injected clock for TTL control.
 *   2. Through laikaApi(...) — that /locks is auth-gated, that the owner is
 *      derived from the authenticated user rather than the body, and that a
 *      backend without lock support answers 501 so the client degrades.
 */

import { describe, expect, it, vi } from 'vitest';

import { LaikaTask, NotImplementedError } from 'laikacms/core';
import type { DocumentsCapabilities } from 'laikacms/documents';
import { DocumentsRepository } from 'laikacms/documents';
import { InProcessLockManager } from 'laikacms/locks/in-process';
import type { Key, Lock, LockOwner, LockToken, OwnedLock } from 'laikacms/storage';

import { laikaApi } from './index.js';
import type { LaikaApiOptions, User } from './index.js';
import { buildLocksApi } from './locks.js';

const ALICE: LockOwner = { id: 'alice@example.com', name: 'Alice' };
const BOB: LockOwner = { id: 'bob@example.com', name: 'Bob' };

/**
 * A documents repository that supports nothing but locking: `/locks` only ever
 * touches the five lock methods, so the rest stays unimplemented.
 */
class LockingDocumentsRepository extends DocumentsRepository {
  readonly manager: InProcessLockManager;

  constructor(now: () => number) {
    super();
    this.manager = new InProcessLockManager({ defaultTtlMs: 60_000, now });
  }

  override getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.fail(new NotImplementedError('not needed for lock tests'));
  }

  override acquireLock(
    key: Key,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined, force?: boolean | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    return this.manager.acquireLock(key, owner, options);
  }

  override refreshLock(
    key: Key,
    token: LockToken,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    return this.manager.refreshLock(key, token, owner, options);
  }

  override releaseLock(key: Key, token: LockToken): LaikaTask.LaikaTask<void> {
    return this.manager.releaseLock(key, token);
  }

  override getLock(key: Key): LaikaTask.LaikaTask<Lock | null> {
    return this.manager.getLock(key);
  }
}

/** A repository with no lock support: every lock call is NotImplementedError. */
class PlainDocumentsRepository extends DocumentsRepository {
  override getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.fail(new NotImplementedError('not needed for lock tests'));
  }
}

function setup(now: () => number) {
  const documents = new LockingDocumentsRepository(now);
  const api = buildLocksApi({ documents, basePath: '/locks' });
  const url = (key: string, refresh = false) =>
    `https://x/locks/${encodeURIComponent(key)}${refresh ? '/refresh' : ''}`;
  const post = (u: string, owner: LockOwner, body?: unknown) =>
    api.fetch(
      new Request(u, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
      owner,
    );
  return {
    api,
    get: (key: string, owner: LockOwner) => api.fetch(new Request(url(key), { method: 'GET' }), owner),
    acquire: (key: string, owner: LockOwner, body?: unknown) => post(url(key), owner, body),
    refresh: (key: string, owner: LockOwner, token: string) => post(url(key, true), owner, { token }),
    release: (key: string, owner: LockOwner, token: string) =>
      api.fetch(new Request(url(key), { method: 'DELETE', body: JSON.stringify({ token }) }), owner),
  };
}

describe('buildLocksApi — acquire', () => {
  it('acquires a free lock and returns it with a token and a TTL-based expiry', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.acquire('posts/hello', ALICE);

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.key).toBe('posts/hello');
    expect(data.owner).toEqual(ALICE);
    expect(typeof data.token).toBe('string');
    expect(Date.parse(data.expiresAt) - Date.parse(data.acquiredAt)).toBe(60_000);
  });

  it('a second acquire by the SAME owner renews (200)', async () => {
    const s = setup(() => 1_000_000);
    await s.acquire('posts/hello', ALICE);
    expect((await s.acquire('posts/hello', ALICE)).status).toBe(200);
  });

  it('an acquire by a DIFFERENT owner conflicts (423) and returns the current lock', async () => {
    const s = setup(() => 1_000_000);
    await s.acquire('posts/hello', ALICE);

    const res = await s.acquire('posts/hello', BOB);
    expect(res.status).toBe(423);
    const { data } = await res.json();
    expect(data.owner).toEqual(ALICE);
    // The holder's token must never appear in a rejection aimed at someone else.
    expect(data).not.toHaveProperty('token');
  });

  it('force overrides another owner (200) and the new owner then holds it', async () => {
    const s = setup(() => 1_000_000);
    await s.acquire('posts/hello', ALICE);

    expect((await s.acquire('posts/hello', BOB, { force: true })).status).toBe(200);

    const after = await (await s.get('posts/hello', ALICE)).json();
    expect(after.data.owner).toEqual(BOB);
  });

  it('takes over a stale (expired) lock without force', async () => {
    let now = 1_000_000;
    const s = setup(() => now);
    await s.acquire('posts/hello', ALICE, { ttlMs: 1_000 });
    now += 1_001;

    expect((await s.acquire('posts/hello', BOB)).status).toBe(200);
  });

  it('uses the authenticated owner, not an id in the request body (anti-spoof)', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.acquire('posts/hello', ALICE, { owner: { id: BOB.id, name: 'Impostor' } });

    expect((await res.json()).data.owner).toEqual(ALICE);
  });
});

describe('buildLocksApi — get', () => {
  it('returns null for an unlocked entry', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.get('posts/hello', ALICE);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });

  it('returns null once the lock has expired (TTL)', async () => {
    let now = 1_000_000;
    const s = setup(() => now);
    await s.acquire('posts/hello', ALICE, { ttlMs: 1_000 });
    now += 1_001;

    expect((await (await s.get('posts/hello', ALICE)).json()).data).toBeNull();
  });

  it('never exposes the token on the read path', async () => {
    const s = setup(() => 1_000_000);
    await s.acquire('posts/hello', ALICE);

    const { data } = await (await s.get('posts/hello', ALICE)).json();
    expect(data).not.toHaveProperty('token');
  });
});

describe('buildLocksApi — refresh', () => {
  it('extends the TTL for the token-holder', async () => {
    let now = 1_000_000;
    const s = setup(() => now);
    const { data: held } = await (await s.acquire('posts/hello', ALICE)).json();
    now += 30_000;

    const res = await s.refresh('posts/hello', ALICE, held.token);
    expect(res.status).toBe(200);
    expect(Date.parse((await res.json()).data.expiresAt)).toBe(now + 60_000);
  });

  it('conflicts (423) when someone else force-took the lock', async () => {
    const s = setup(() => 1_000_000);
    const { data: held } = await (await s.acquire('posts/hello', ALICE)).json();
    await s.acquire('posts/hello', BOB, { force: true });

    expect((await s.refresh('posts/hello', ALICE, held.token)).status).toBe(423);
  });

  it('reclaims silently (200) when the prior lock had already expired', async () => {
    let now = 1_000_000;
    const s = setup(() => now);
    const { data: held } = await (await s.acquire('posts/hello', ALICE, { ttlMs: 1_000 })).json();
    now += 5_000;

    expect((await s.refresh('posts/hello', ALICE, held.token)).status).toBe(200);
  });

  it('400s without a token, since identity alone does not authorise a refresh', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.api.fetch(
      new Request('https://x/locks/posts%2Fhello/refresh', { method: 'POST' }),
      ALICE,
    );
    expect(res.status).toBe(400);
  });
});

describe('buildLocksApi — release', () => {
  it('releases a lock held by the caller and the entry is then unlocked', async () => {
    const s = setup(() => 1_000_000);
    const { data: held } = await (await s.acquire('posts/hello', ALICE)).json();

    expect((await s.release('posts/hello', ALICE, held.token)).status).toBe(200);
    expect((await (await s.get('posts/hello', ALICE)).json()).data).toBeNull();
  });

  it('is a no-op with a stale token (does not evict the new owner)', async () => {
    const s = setup(() => 1_000_000);
    const { data: alicesLock } = await (await s.acquire('posts/hello', ALICE)).json();
    await s.acquire('posts/hello', BOB, { force: true });

    await s.release('posts/hello', ALICE, alicesLock.token);

    const after = await (await s.get('posts/hello', ALICE)).json();
    expect(after.data.owner).toEqual(BOB);
  });

  it('400s without a token', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.api.fetch(new Request('https://x/locks/posts%2Fhello', { method: 'DELETE' }), ALICE);
    expect(res.status).toBe(400);
  });
});

describe('buildLocksApi — unsupported backend', () => {
  it('501s on every route so the client degrades rather than retrying', async () => {
    const api = buildLocksApi({ documents: new PlainDocumentsRepository(), basePath: '/locks' });
    const url = 'https://x/locks/posts%2Fhello';

    expect((await api.fetch(new Request(url), ALICE)).status).toBe(501);
    expect((await api.fetch(new Request(url, { method: 'POST' }), ALICE)).status).toBe(501);
    expect(
      (await api.fetch(new Request(url, { method: 'DELETE', body: JSON.stringify({ token: 't' }) }), ALICE)).status,
    ).toBe(501);
  });
});

describe('buildLocksApi — malformed requests', () => {
  it('400 when the key is missing', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.api.fetch(new Request('https://x/locks/', { method: 'GET' }), ALICE);
    expect(res.status).toBe(400);
  });

  it('405 for an unsupported method', async () => {
    const s = setup(() => 1_000_000);
    const res = await s.api.fetch(new Request('https://x/locks/posts%2Fhello', { method: 'PUT' }), ALICE);
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: through laikaApi(...)
// ---------------------------------------------------------------------------

const MOCK_USER: User = { id: 'u1', email: 'alice@example.com', name: 'Alice' };

function makeOptions(overrides: Partial<LaikaApiOptions> = {}): LaikaApiOptions {
  return {
    documents: new LockingDocumentsRepository(() => 1_000_000),
    storage: {} as LaikaApiOptions['storage'],
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

describe('laikaApi /locks integration', () => {
  it('derives the lock owner from the authenticated user, not the request body', async () => {
    const api = laikaApi(makeOptions());

    const res = await api.fetch(
      authed('/locks/posts%2Fhello', 'POST', { owner: { id: 'mallory', name: 'Mallory' } }),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.owner.id).toBe('alice@example.com'); // = user.email, not from the body
    expect(data.key).toBe('posts/hello');
  });

  it('501s when the documents repository does not support locking', async () => {
    const api = laikaApi(makeOptions({ documents: new PlainDocumentsRepository() }));
    const res = await api.fetch(authed('/locks/posts%2Fhello', 'POST'));
    expect(res.status).toBe(501);
  });

  it('requires authentication (401 without a token)', async () => {
    const api = laikaApi(makeOptions());
    const res = await api.fetch(new Request('https://example.com/locks/posts%2Fhello'));
    expect(res.status).toBe(401);
  });

  it('honours the authorize gate (403 when denied)', async () => {
    const api = laikaApi(makeOptions({ authorize: () => false }));
    const res = await api.fetch(authed('/locks/posts%2Fhello', 'POST'));
    expect(res.status).toBe(403);
  });

  it('exposes the decoded lock key to authorize as itemId/collection', async () => {
    const authorize = vi.fn().mockReturnValue(true);
    const api = laikaApi(makeOptions({ authorize }));
    await api.fetch(authed('/locks/posts%2Fhello', 'POST'));
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'locks', collection: 'posts', itemId: 'posts/hello' }),
    );
  });
});
