import { Url } from 'laikacms/core';

/**
 * Advisory entry-locking for the Decap backend.
 *
 * The Laika Decap fork (`@laikacms/decap-cms` >= 4.1.0) shows a "being edited
 * by X" banner when an editor opens an entry another user already holds. It
 * drives this through four optional `CmsImplementation` methods
 * (`getEntryLock`/`acquireEntryLock`/`releaseEntryLock`/`refreshEntryLock`).
 * Its bundled reference (`EntryLockManager` + `localStorage`) only shares locks
 * between tabs of one browser; a multi-user deployment needs the *backend* to
 * arbitrate locks so two different browsers/users see the same lock.
 *
 * This module is the server side of that: a small advisory-lock state machine
 * (a server port of the fork's `EntryLockManager`) over an injected
 * {@link LockStore}, exposed as the `/locks` sub-API of `decapApi`.
 *
 * Locks are **advisory only** — nothing here blocks a write. The lock exists
 * purely to inform the editor UI before someone clobbers a concurrent edit.
 */

/** The identity that holds a lock. Mirrors the fork's `CmsEntryLockOwner`. */
export interface LockOwner {
  id: string;
  name: string;
}

/** An advisory lock on a single entry path. Mirrors the fork's `CmsEntryLock`. */
export interface EntryLock {
  /** The advisory-lock key — `` `${collection}/${slug}` `` on the client. */
  path: string;
  owner: LockOwner;
  /** ISO-8601 timestamp the lock was (re)acquired. */
  acquiredAt: string;
  /** ISO-8601 timestamp the lock goes stale unless refreshed. */
  expiresAt: string;
}

/**
 * The ephemeral, shared store lock state lives in. Deliberately minimal — a
 * TTL-aware key/value store — so any backing service (Redis, a KV namespace, a
 * DB table with a TTL column) can implement it.
 *
 * For a lock to be visible across *different browsers/nodes* the store must be
 * shared; an in-process {@link createInMemoryLockStore} only works for a single
 * server instance (fine for local dev, single-node, and tests).
 */
export interface LockStore {
  /** Return the raw serialized lock for `key`, or `null` if absent/expired. */
  get(key: string): Promise<string | null>;
  /** Store `value` under `key`, expiring it after `ttlMs` milliseconds. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Remove `key` if present. */
  delete(key: string): Promise<void>;
}

/** Default lock lifetime, matching the fork's `DEFAULT_ENTRY_LOCK_TTL_MS`. */
export const DEFAULT_ENTRY_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * An in-process {@link LockStore} backed by a `Map` with per-key expiry.
 * A reference/default implementation for single-instance deployments and
 * tests. Multi-node deployments must inject a shared store instead — an
 * in-memory store on one node is invisible to the others, which would defeat
 * the point of server-arbitrated locks.
 */
export function createInMemoryLockStore(now: () => number = () => Date.now()): LockStore {
  const map = new Map<string, { value: string, expiresAt: number }>();
  return {
    async get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        map.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlMs) {
      map.set(key, { value, expiresAt: now() + ttlMs });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/** Thrown internally when a non-holder tries to take/refresh a held lock. */
class LockConflict {
  constructor(readonly lock: EntryLock) {}
}

/**
 * The advisory-lock state machine, a server port of the fork's
 * `EntryLockManager`: acquire / refresh / release / get with TTL-based stale
 * expiry, force-override, and owner-guarded release.
 *
 * Concurrency is best-effort: acquire is a read-check-write against the store,
 * so a rare race can let two acquirers both win. That is acceptable for an
 * advisory lock — it informs the UI, it does not guarantee mutual exclusion.
 */
class LockManager {
  constructor(
    private readonly store: LockStore,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  private async read(key: string): Promise<EntryLock | null> {
    const raw = await this.store.get(key);
    if (!raw) return null;
    try {
      const lock = JSON.parse(raw) as EntryLock;
      // Defensive expiry check for stores without native TTL eviction.
      if (new Date(lock.expiresAt).getTime() <= this.now()) {
        await this.store.delete(key);
        return null;
      }
      return lock;
    } catch {
      // Corrupt/foreign value — treat as unlocked rather than throwing.
      await this.store.delete(key);
      return null;
    }
  }

  private async write(key: string, owner: LockOwner): Promise<EntryLock> {
    const acquiredAt = new Date(this.now());
    const expiresAt = new Date(acquiredAt.getTime() + this.ttlMs);
    const lock: EntryLock = {
      path: key,
      owner,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.store.set(key, JSON.stringify(lock), this.ttlMs);
    return lock;
  }

  async get(key: string): Promise<EntryLock | null> {
    return this.read(key);
  }

  async acquire(key: string, owner: LockOwner, force: boolean): Promise<EntryLock> {
    const existing = await this.read(key);
    if (existing && existing.owner.id !== owner.id && !force) {
      throw new LockConflict(existing);
    }
    // Free, already ours (renew), or force-override.
    return this.write(key, owner);
  }

  async refresh(key: string, owner: LockOwner): Promise<EntryLock> {
    const existing = await this.read(key);
    // A refresh from a holder whose lock already expired (or was taken over) is
    // just a fresh acquire — not an error — so a client that briefly lost
    // network can silently reclaim an unlocked entry instead of the periodic
    // refresh timer hard-failing.
    if (!existing || existing.owner.id === owner.id) {
      return this.write(key, owner);
    }
    throw new LockConflict(existing);
  }

  async release(key: string, owner: LockOwner): Promise<void> {
    const existing = await this.read(key);
    // Only the current holder may release — a delayed release from a client
    // that lost a force-override race must not evict the new holder.
    if (existing && existing.owner.id !== owner.id) return;
    await this.store.delete(key);
  }
}

export interface BuildLocksApiOptions {
  store: LockStore;
  /** Endpoint prefix, e.g. `/locks`. */
  basePath: string;
  /** Lock lifetime in ms. Defaults to {@link DEFAULT_ENTRY_LOCK_TTL_MS}. */
  ttlMs?: number;
  /** Clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
}

export interface LocksApi {
  /**
   * Handle a `/locks` request. `owner` is the authenticated principal's
   * identity — derived server-side, never trusted from the request body — so a
   * caller cannot release or override someone else's lock by spoofing an id.
   */
  fetch(request: Request, owner: LockOwner): Promise<Response>;
}

interface LockRequestBody {
  owner?: { name?: string };
  force?: boolean;
}

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders() });

/**
 * Build the `/locks` sub-API. Wired into `decapApi` only when a
 * {@link DecapOptions.locks} store is provided; when absent the `/locks`
 * endpoint does not exist and the client degrades to "locking unsupported".
 *
 * Wire format (the lock key is a single URL-encoded path segment):
 * - `GET    {base}/locks/:key`          → `200 { data: EntryLock | null }`
 * - `POST   {base}/locks/:key`          → `200 { data }` | `409 { data: currentLock }`
 * - `POST   {base}/locks/:key/refresh`  → `200 { data }` | `409 { data: currentLock }`
 * - `DELETE {base}/locks/:key`          → `204`
 */
export function buildLocksApi(options: BuildLocksApiOptions): LocksApi {
  const base = Url.normalize(options.basePath);
  const ttlMs = options.ttlMs ?? DEFAULT_ENTRY_LOCK_TTL_MS;
  const manager = new LockManager(options.store, ttlMs, options.now ?? (() => Date.now()));

  return {
    async fetch(request: Request, owner: LockOwner): Promise<Response> {
      const url = new URL(request.url);
      // Parse against the raw pathname (not a normalized one) so an encoded
      // '/' in the key survives as `%2F` — the key is one segment.
      const rest = url.pathname.slice(base.length).replace(/^\/+/, '');
      const segments = rest.split('/').filter(Boolean);
      const isRefresh = segments[segments.length - 1] === 'refresh';
      const encodedKey = isRefresh ? segments.slice(0, -1).join('/') : segments.join('/');

      if (!encodedKey) {
        return json(400, { errors: [{ status: '400', detail: 'Missing lock key' }] });
      }

      let key: string;
      try {
        key = decodeURIComponent(encodedKey);
      } catch {
        return json(400, { errors: [{ status: '400', detail: 'Malformed lock key' }] });
      }

      const method = request.method.toUpperCase();

      try {
        if (method === 'GET') {
          return json(200, { data: await manager.get(key) });
        }

        if (method === 'DELETE') {
          await manager.release(key, owner);
          return new Response(null, { status: 204, headers: jsonHeaders() });
        }

        if (method === 'POST') {
          let body: LockRequestBody | null = null;
          try {
            body = (await request.json()) as LockRequestBody;
          } catch {
            // No/invalid body — treated as no name override and force=false.
          }
          // The owner id is the authenticated principal's; the client may supply
          // a display name in the body, but never an identity.
          const effectiveOwner: LockOwner = { id: owner.id, name: body?.owner?.name || owner.name };
          const lock = isRefresh
            ? await manager.refresh(key, effectiveOwner)
            : await manager.acquire(key, effectiveOwner, body?.force === true);
          return json(200, { data: lock });
        }

        return json(405, { errors: [{ status: '405', detail: `Method ${method} not allowed` }] });
      } catch (e) {
        if (e instanceof LockConflict) {
          return json(409, { data: e.lock, errors: [{ status: '409', detail: 'Entry is locked' }] });
        }
        options.logger?.error('Lock request failed:', e);
        return json(500, { errors: [{ status: '500', detail: 'Lock request failed' }] });
      }
    },
  };
}
