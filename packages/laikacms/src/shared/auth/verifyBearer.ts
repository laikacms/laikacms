import { ADMIN_SCOPE, normalizeScopes } from './scopes.js';
import { hashToken, isPatToken } from './token.js';

import type { AuthContext, PatRecord, SessionVerificationResult } from './types.js';

export interface ResolveBearerDeps {
  /**
   * Validates a non-PAT bearer against the existing OAuth session-token seam
   * (unchanged). Return `null`/`undefined` for an invalid/expired token.
   * Omitting `scopes` on the result means "full admin", matching today's
   * behaviour where any authenticated session is full-admin.
   */
  verifySessionToken: (bearer: string) => Promise<SessionVerificationResult | null | undefined>;
  /** Looks up a PAT record by its sha256 hash. Never receives the plaintext token. */
  lookupPatByHash: (hash: string) => Promise<PatRecord | null | undefined>;
  now?: () => Date;
  /** Optional side effect (e.g. bump `lastUsedAt`); failures never fail verification. */
  onPatUsed?: (record: PatRecord) => void | Promise<void>;
}

/**
 * The single seam every consumer (REST API, MCP endpoints, ...) should call to
 * turn an `Authorization: Bearer <token>` header into `{ user, scopes }`. A
 * session token resolves to full scopes; a PAT resolves to its granted subset.
 * Returns `null` for anything invalid, revoked, or expired, and never throws
 * for bad input, so callers can treat `null` uniformly as 401.
 */
export async function resolveBearer(
  bearer: string | null | undefined,
  deps: ResolveBearerDeps,
): Promise<AuthContext | null> {
  if (!bearer) {
    return null;
  }

  const now = (deps.now ?? (() => new Date()))();

  if (isPatToken(bearer)) {
    const record = await deps.lookupPatByHash(hashToken(bearer));
    if (!record) {
      return null;
    }
    if (record.revokedAt) {
      return null;
    }
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
      return null;
    }

    if (deps.onPatUsed) {
      try {
        await deps.onPatUsed(record);
      } catch {
        // Best-effort side effect (e.g. bumping lastUsedAt); never fail
        // verification because of a downstream write failure.
      }
    }

    return {
      user: { id: record.userId },
      scopes: normalizeScopes(record.scopes),
      tokenType: 'pat',
      patId: record.id,
    };
  }

  const result = await deps.verifySessionToken(bearer);
  if (!result) {
    return null;
  }

  return {
    user: result.user,
    scopes: normalizeScopes(result.scopes ?? [ADMIN_SCOPE]),
    tokenType: 'session',
  };
}
