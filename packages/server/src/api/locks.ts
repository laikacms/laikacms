import { DateTime, Result } from 'effect';
import { errorCode, LaikaTask, Url } from 'laikacms/core';
import type { DocumentsRepository } from 'laikacms/documents';
import type { Key, Lock, LockOwner, OwnedLock } from 'laikacms/storage';
import { LockToken } from 'laikacms/storage';

export type { Lock, LockOwner, OwnedLock } from 'laikacms/storage';

/**
 * Advisory entry-locking for admin UIs, as a thin adapter over the documents
 * repository's lock methods (ADR-007).
 *
 * This module used to own the mechanism: a `LockStore` key/value seam plus a
 * `LockManager` policy class. That design could not be made correct, because a
 * dumb KV forces acquire to be a read-check-write and gives a backend no way to
 * use its datasource's native conditional write. The mechanism now lives on
 * `DocumentsRepository`, where each backend supplies a real atomic primitive,
 * and this file is only the HTTP shape on top of it.
 *
 * What stays here is the one thing that genuinely belongs at the API boundary:
 * **the owner is the authenticated principal**, derived server-side and never
 * read from the request body, so a caller cannot take a lock as somebody else.
 * Below this boundary the repository authorises on the opaque token alone and
 * needs no notion of identity.
 *
 * Locks are advisory: nothing here blocks a write. The lock exists to inform
 * the editor UI before someone clobbers a concurrent edit.
 */

/**
 * A standalone lock manager — the four atomic lock primitives without the rest
 * of a documents repository. `InProcessLockManager` (from `laikacms/locks/in-process`)
 * satisfies this interface.
 *
 * Pass an instance as `locks` in {@link BuildLocksApiOptions} (or in
 * {@link LaikaApiOptions} from `@laikacms/server/api`) to override the default
 * duck-typed documents-repo path and get real locking without a lock-capable
 * documents backend.
 */
export interface LockManager {
  acquireLock(
    key: Key,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined, force?: boolean | undefined },
  ): LaikaTask.LaikaTask<OwnedLock>;
  refreshLock(
    key: Key,
    token: LockToken,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined },
  ): LaikaTask.LaikaTask<OwnedLock>;
  releaseLock(key: Key, token: LockToken): LaikaTask.LaikaTask<void>;
  getLock(key: Key): LaikaTask.LaikaTask<Lock | null>;
}

export interface BuildLocksApiOptions {
  /** The repository that actually arbitrates locks. */
  documents: DocumentsRepository;
  /**
   * Explicit lock manager. Takes precedence over duck-typing `documents` for
   * lock support. Use `InProcessLockManager` from `laikacms/locks/in-process`
   * for single-node deployments.
   *
   * When omitted and `documents` does not implement the lock methods, every
   * `/locks` route returns `204 No Content` (no-op) instead of `501`.
   */
  lockManager?: LockManager | undefined;
  /** Endpoint prefix, e.g. `/locks`. */
  basePath: string;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
}

export interface LocksApi {
  /**
   * Handle a `/locks` request. `owner` is the authenticated principal's
   * identity, so a caller cannot act as someone else by spoofing an id.
   */
  fetch(request: Request, owner: LockOwner): Promise<Response>;
}

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders() });

/** Wire projection of a lock. Timestamps as ISO strings; never the token. */
const publicLock = (lock: Lock) => ({
  key: lock.key,
  owner: { id: lock.owner.id, name: lock.owner.name },
  acquiredAt: DateTime.formatIso(lock.acquiredAt),
  expiresAt: DateTime.formatIso(lock.expiresAt),
});

/** Wire projection for the acquirer, who is the only caller that gets the token. */
const ownedLock = (lock: OwnedLock) => ({ ...publicLock(lock), token: lock.token });

interface LockRequestBody {
  token?: string;
  force?: boolean;
  ttlMs?: number;
}

/**
 * Build the `/locks` sub-API.
 *
 * Wire format (the lock key is a single URL-encoded path segment):
 * - `GET    {base}/locks/:key`         -> `200 { data: Lock | null }`
 * - `POST   {base}/locks/:key`         -> `200 { data: OwnedLock }` | `423 { data: currentLock }`
 * - `POST   {base}/locks/:key/refresh` -> `200 { data: OwnedLock }` | `423 { data: currentLock }`
 * - `DELETE {base}/locks/:key`         -> `200 { meta: { released: true } }`
 *
 * Lock source priority: an explicit `lockManager` option takes precedence; if
 * absent the documents repository's lock methods are used (duck-typed). When
 * neither supports locking, every route answers `204 No Content` (no-op).
 */
export function buildLocksApi(options: BuildLocksApiOptions): LocksApi {
  const base = Url.normalize(options.basePath);
  // Prefer an explicit lock manager; fall back to the documents repo (duck-typed).
  const locks: LockManager = options.lockManager ?? options.documents;

  const run = <T>(task: LaikaTask.LaikaTask<T>) => LaikaTask.runPromiseResult(task);

  return {
    async fetch(request: Request, owner: LockOwner): Promise<Response> {
      const url = new URL(request.url);
      // Parse against the raw pathname (not a normalized one) so an encoded
      // '/' in the key survives as `%2F`: the key is one segment.
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

      // Read the body once, tolerantly: absent or malformed means no token and
      // no overrides, which the routes that need a token then reject.
      let body: LockRequestBody = {};
      if (method === 'POST' || method === 'DELETE') {
        try {
          body = (await request.json()) as LockRequestBody;
        } catch {
          body = {};
        }
      }

      /** Map a repository failure onto the wire, including the 423 holder body. */
      const onFailure = async (failure: { code: string, message: string }): Promise<Response> => {
        if (failure.code === errorCode.NOT_IMPLEMENTED) {
          // No lock backend is wired: treat as no-op rather than an error.
          // Decap POSTs a lock on every entry open; returning 501 fills the
          // console with errors on every navigation. 204 is transparent to the
          // client — it still opens the entry, it just skips the lock banner.
          return new Response(null, { status: 204 });
        }
        if (failure.code === errorCode.LOCK_CONFLICT) {
          // Include the current holder so the client renders the banner from
          // the rejection itself, with no follow-up request.
          const current = await run(locks.getLock(key));
          const holder = Result.isSuccess(current) && current.success ? publicLock(current.success) : null;
          return json(423, { data: holder, errors: [{ status: '423', detail: failure.message }] });
        }
        options.logger?.error('Lock request failed:', failure);
        return json(500, { errors: [{ status: '500', detail: 'Lock request failed' }] });
      };

      try {
        if (method === 'GET') {
          const result = await run(locks.getLock(key));
          if (Result.isFailure(result)) return onFailure(result.failure);
          return json(200, { data: result.success ? publicLock(result.success) : null });
        }

        if (method === 'DELETE') {
          if (!body.token) {
            return json(400, { errors: [{ status: '400', detail: 'A lock token is required to release a lock' }] });
          }
          const result = await run(locks.releaseLock(key, LockToken.make(body.token)));
          if (Result.isFailure(result)) return onFailure(result.failure);
          return json(200, { meta: { released: true } });
        }

        if (method === 'POST' && isRefresh) {
          if (!body.token) {
            return json(400, { errors: [{ status: '400', detail: 'A lock token is required to refresh a lock' }] });
          }
          const result = await run(
            locks.refreshLock(
              key,
              LockToken.make(body.token),
              owner,
              body.ttlMs === undefined ? undefined : { ttlMs: body.ttlMs },
            ),
          );
          if (Result.isFailure(result)) return onFailure(result.failure);
          return json(200, { data: ownedLock(result.success) });
        }

        if (method === 'POST') {
          const result = await run(
            locks.acquireLock(key, owner, {
              ...(body.ttlMs === undefined ? {} : { ttlMs: body.ttlMs }),
              ...(body.force === undefined ? {} : { force: body.force === true }),
            }),
          );
          if (Result.isFailure(result)) return onFailure(result.failure);
          return json(200, { data: ownedLock(result.success) });
        }

        return json(405, { errors: [{ status: '405', detail: `Method ${method} not allowed` }] });
      } catch (e) {
        options.logger?.error('Lock request failed:', e);
        return json(500, { errors: [{ status: '500', detail: 'Lock request failed' }] });
      }
    },
  };
}
