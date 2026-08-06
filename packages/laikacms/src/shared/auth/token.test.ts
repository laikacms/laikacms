import { describe, expect, it } from 'vitest';

import {
  generateToken,
  hashesEqual,
  hashToken,
  isPatToken,
  mintPersonalAccessToken,
  TOKEN_PREFIX,
  tokenPreview,
} from './token.js';

describe('generateToken', () => {
  it('is prefixed with lk_pat_', () => {
    expect(generateToken()).toMatch(new RegExp(`^${TOKEN_PREFIX}`));
  });

  it('produces unique, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });

  it('only uses url/shell-safe characters after the prefix', () => {
    const secret = generateToken().slice(TOKEN_PREFIX.length);
    expect(secret).toMatch(/^[A-Za-z0-9]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });
});

describe('isPatToken', () => {
  it('recognizes PAT-prefixed bearers and rejects others', () => {
    expect(isPatToken(generateToken())).toBe(true);
    expect(isPatToken('eyJhbGciOiJIUzI1NiJ9.session.token')).toBe(false);
    expect(isPatToken('')).toBe(false);
  });
});

describe('hashToken', () => {
  it('is a deterministic 64-char hex sha256 digest that never reveals the token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken('lk_pat_abc')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it('hashes different tokens differently', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});

describe('hashesEqual', () => {
  it('matches equal hashes and rejects differing / different-length ones', () => {
    const h = hashToken('lk_pat_same');
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(hashToken('a'), hashToken('b'))).toBe(false);
    expect(hashesEqual('ab', 'abcd')).toBe(false);
  });
});

describe('tokenPreview', () => {
  it('truncates to a short, non-secret preview', () => {
    const token = generateToken();
    const preview = tokenPreview(token);
    expect(preview.length).toBeLessThan(token.length);
    expect(preview.startsWith(TOKEN_PREFIX)).toBe(true);
  });
});

describe('mintPersonalAccessToken', () => {
  const deps = { generateId: () => 'pat_123', now: () => new Date('2026-01-01T00:00:00.000Z') };

  it('mints a token and a matching, hash-only record', () => {
    const { token, record } = mintPersonalAccessToken({ userId: 'user_1', scopes: ['content:read'] }, deps);
    expect(token).toMatch(new RegExp(`^${TOKEN_PREFIX}`));
    expect(record.id).toBe('pat_123');
    expect(record.userId).toBe('user_1');
    expect(record.scopes).toEqual(['content:read']);
    expect(record.tokenHash).toBe(hashToken(token));
    expect(record.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(record.revokedAt).toBeNull();
    expect(JSON.stringify(record)).not.toContain(token);
  });

  it('collapses a widened scope set down to just admin', () => {
    const { record } = mintPersonalAccessToken({ userId: 'user_1', scopes: ['admin', 'content:read'] }, deps);
    expect(record.scopes).toEqual(['admin']);
  });

  it('preserves consumer-defined scopes and an explicit expiry', () => {
    const { record } = mintPersonalAccessToken(
      { userId: 'user_1', scopes: ['shipping:read'], expiresAt: '2026-06-01T00:00:00.000Z' },
      deps,
    );
    expect(record.scopes).toEqual(['shipping:read']);
    expect(record.expiresAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rejects an empty scope set', () => {
    expect(() => mintPersonalAccessToken({ userId: 'user_1', scopes: [] }, deps)).toThrow(
      /at least one scope/i,
    );
  });
});
