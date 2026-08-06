import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { normalizeScopes } from './scopes.js';

import type { Scope } from './scopes.js';
import type { PatRecord } from './types.js';

export const TOKEN_PREFIX = 'lk_pat_';

/** Bytes of entropy for the token secret (256 bits). */
const SECRET_BYTE_LENGTH = 32;

const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function toBase62(buffer: Buffer): string {
  let out = '';
  for (const byte of buffer) {
    out += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
  }
  return out;
}

/**
 * Generates a new opaque PAT bearer string, e.g. `lk_pat_Ab3fG...`. Never
 * persisted in plaintext; only `hashToken(token)` is stored.
 */
export function generateToken(): string {
  const secret = toBase62(randomBytes(SECRET_BYTE_LENGTH));
  return `${TOKEN_PREFIX}${secret}`;
}

export function isPatToken(bearer: string): boolean {
  return typeof bearer === 'string' && bearer.startsWith(TOKEN_PREFIX);
}

/** sha256 hex digest of the full bearer string. Deterministic, one-way. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenPreview(token: string): string {
  return `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;
}

/** Constant-time comparison of two hex-encoded hashes, to avoid timing side-channels. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export interface MintPatInput {
  userId: string;
  scopes: Scope[];
  name?: string;
  /** ISO string; omit or null for a non-expiring token. */
  expiresAt?: string | null;
}

export interface MintPatDeps {
  /** Injected so callers control ID generation (uuid, ULID, DB-assigned, ...). */
  generateId: () => string;
  now?: () => Date;
}

export interface MintPatResult {
  /** The plaintext bearer token. Shown to the caller exactly once; never logged or persisted. */
  token: string;
  /** The record to persist. Contains only the hash, never the plaintext secret. */
  record: PatRecord;
}

/**
 * Mints a new PAT: generates the opaque secret, hashes it for storage, and
 * builds the record consumers persist. `scopes` must be a non-empty subset of
 * the granting user's own scopes; enforcing "PATs issue a subset of a user's
 * scopes" is the caller's job (it needs the requesting user's scopes), this
 * function only refuses structurally invalid input.
 */
export function mintPersonalAccessToken(input: MintPatInput, deps: MintPatDeps): MintPatResult {
  if (!input.scopes || input.scopes.length === 0) {
    throw new Error('mintPersonalAccessToken: at least one scope is required');
  }

  const token = generateToken();
  const now = (deps.now ?? (() => new Date()))();

  const record: PatRecord = {
    id: deps.generateId(),
    userId: input.userId,
    tokenHash: hashToken(token),
    tokenPreview: tokenPreview(token),
    scopes: normalizeScopes(input.scopes),
    name: input.name,
    createdAt: now.toISOString(),
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    lastUsedAt: null,
  };

  return { token, record };
}
