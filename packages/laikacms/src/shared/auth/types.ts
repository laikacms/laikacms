import type { Scope } from './scopes.js';

/**
 * Storage-agnostic PAT record shape. Consumers persist this however they like
 * (SQL table, DynamoDB item, ...); this module never touches storage directly,
 * it only shapes and hashes the data.
 *
 * `tokenHash` is the sha256 hex digest of the full bearer string
 * (`lk_pat_<secret>`). The plaintext secret is never stored.
 */
export interface PatRecord {
  id: string;
  userId: string;
  tokenHash: string;
  /** Short, non-secret prefix of the token, useful for UI identification. */
  tokenPreview: string;
  scopes: Scope[];
  name?: string;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
}

export interface AuthUser {
  id: string;
  [key: string]: unknown;
}

export type TokenType = 'session' | 'pat';

/**
 * Result of resolving a bearer string, regardless of whether it was a session
 * (OAuth) token or a PAT. The `{ user, scopes }` shape every REST/MCP consumer
 * should key enforcement off of.
 */
export interface AuthContext {
  user: AuthUser;
  scopes: Scope[];
  tokenType: TokenType;
  patId?: string;
}

export interface SessionVerificationResult {
  user: AuthUser;
  /** Omit for the common case of a full-admin session token. */
  scopes?: Scope[];
}
