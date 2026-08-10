import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as S from 'effect/Schema';

import { UnsupportedCapability } from './capabilities.js';

/**
 * Opaque bearer capability for a held lock (ADR-007).
 *
 * Comparable only by equality; never parse or interpret it. Whoever holds the
 * token can refresh or release the lock, and may write through it, so it is
 * returned **only** to the acquirer and never exposed by `getLock`. A
 * force-override mints a new token, which is what invalidates the previous
 * holder: their stale token simply stops matching.
 */
export const LockToken = S.String.pipe(S.brand('LockToken'));
export type LockToken = S.Schema.Type<typeof LockToken>;

/**
 * Who holds a lock.
 *
 * `name` is **display-only** ("being edited by Alice"). It never authorises
 * anything: authorisation is the {@link LockToken}, not the identity.
 */
export const LockOwnerSchema = S.toStandardSchemaV1(S.Struct({
  id: S.String,
  name: S.String,
})) satisfies StandardSchemaV1;

export type LockOwner = S.Schema.Type<typeof LockOwnerSchema>;

/**
 * The public projection of a lock: what any caller may see.
 *
 * Deliberately carries no {@link LockToken}, so reading a lock never grants the
 * ability to release or write through it.
 */
export const LockSchema = S.toStandardSchemaV1(S.Struct({
  /** The document key the lock covers (`collection/slug`). */
  key: S.String,
  owner: S.Struct({ id: S.String, name: S.String }),
  acquiredAt: S.DateTimeUtcFromString,
  expiresAt: S.DateTimeUtcFromString,
})) satisfies StandardSchemaV1;

export type Lock = S.Schema.Type<typeof LockSchema>;

/**
 * A lock as returned to the caller that acquired or refreshed it: the public
 * {@link Lock} plus the bearer {@link LockToken}.
 */
export const OwnedLockSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String,
  owner: S.Struct({ id: S.String, name: S.String }),
  acquiredAt: S.DateTimeUtcFromString,
  expiresAt: S.DateTimeUtcFromString,
  token: LockToken,
})) satisfies StandardSchemaV1;

export type OwnedLock = S.Schema.Type<typeof OwnedLockSchema>;

/** Default lock lifetime: 5 minutes, matching an admin UI's refresh cadence. */
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Advertises the locking surface of a repository. Never a bare boolean, because
 * two things a caller must not guess at are independently true or false:
 *
 * - `scope`: `in-process` locks live in one node's memory, which is correct for
 *   single-node deployments and tests but *silently wrong* across nodes.
 *   `shared` locks are cross-node correct. Advertised so a multi-node operator
 *   sees single-node-only locking here rather than discovering it in production.
 * - `transactional`: whether `withDocumentLock` rolls back partial writes
 *   (`true`) or merely brackets a lock around them (`false`). A caller needing
 *   atomic multi-write checks this and degrades or refuses on a bracket-only
 *   backend.
 *
 * Both axes exist from the first commit so that adding them later would not be
 * a breaking capability change.
 */
export const LocksSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
  scope: S.Literals(['in-process', 'shared']),
  transactional: S.Boolean,
});

export const LocksCapabilitySchema = S.Union([UnsupportedCapability, LocksSupportEnabled]);
export type LocksCapability = S.Schema.Type<typeof LocksCapabilitySchema>;

/** Strip the bearer token from an owned lock before handing it to a reader. */
export function toPublicLock(lock: OwnedLock): Lock {
  return {
    key: lock.key,
    owner: lock.owner,
    acquiredAt: lock.acquiredAt,
    expiresAt: lock.expiresAt,
  };
}
