import { describe, expect, it, vi } from 'vitest';

import { hashToken, mintPersonalAccessToken } from './token.js';
import { resolveBearer } from './verifyBearer.js';

import type { PatRecord } from './types.js';

const NOW = new Date('2026-03-01T00:00:00.000Z');

function makeStore(records: PatRecord[]) {
  return async (hash: string) => records.find(r => r.tokenHash === hash) ?? null;
}

describe('resolveBearer', () => {
  it('returns null for an empty/missing bearer', async () => {
    const ctx = await resolveBearer(undefined, {
      verifySessionToken: async () => ({ user: { id: 'u1' } }),
      lookupPatByHash: async () => null,
    });
    expect(ctx).toBeNull();
  });

  it('resolves a scopeless session token to a single admin grant', async () => {
    const ctx = await resolveBearer('session-token-abc', {
      verifySessionToken: async bearer => (bearer === 'session-token-abc' ? { user: { id: 'u1' } } : null),
      lookupPatByHash: async () => null,
    });
    expect(ctx).toEqual({ user: { id: 'u1' }, scopes: ['admin'], tokenType: 'session' });
  });

  it('passes through explicit session scopes, including consumer namespaces', async () => {
    const ctx = await resolveBearer('session-token-scoped', {
      verifySessionToken: async () => ({ user: { id: 'u2' }, scopes: ['content:read', 'shipping:write'] }),
      lookupPatByHash: async () => null,
    });
    expect(ctx).toEqual({
      user: { id: 'u2' },
      scopes: ['content:read', 'shipping:write'],
      tokenType: 'session',
    });
  });

  it('returns null for an invalid session token', async () => {
    const ctx = await resolveBearer('garbage', {
      verifySessionToken: async () => null,
      lookupPatByHash: async () => null,
    });
    expect(ctx).toBeNull();
  });

  it('resolves a valid PAT to its granted scope subset and never calls verifySessionToken', async () => {
    const { token, record } = mintPersonalAccessToken(
      { userId: 'agent_1', scopes: ['content:read', 'media:read'] },
      { generateId: () => 'pat_1', now: () => NOW },
    );
    const verifySessionToken = vi.fn();

    const ctx = await resolveBearer(token, {
      verifySessionToken,
      lookupPatByHash: makeStore([record]),
      now: () => NOW,
    });

    expect(ctx).toEqual({
      user: { id: 'agent_1' },
      scopes: ['content:read', 'media:read'],
      tokenType: 'pat',
      patId: 'pat_1',
    });
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it('rejects unknown, revoked, and expired PATs', async () => {
    const mk = (over: Partial<PatRecord> = {}) => {
      const { token, record } = mintPersonalAccessToken(
        { userId: 'agent_1', scopes: ['content:read'] },
        { generateId: () => 'pat_1', now: () => NOW },
      );
      Object.assign(record, over);
      return { token, record };
    };

    expect(
      await resolveBearer('lk_pat_doesnotexist', {
        verifySessionToken: async () => null,
        lookupPatByHash: async () => null,
      }),
    ).toBeNull();

    const revoked = mk({ revokedAt: '2026-02-15T00:00:00.000Z' });
    expect(
      await resolveBearer(revoked.token, {
        verifySessionToken: async () => null,
        lookupPatByHash: makeStore([revoked.record]),
        now: () => NOW,
      }),
    ).toBeNull();

    const expired = mk({ expiresAt: '2026-01-01T00:00:00.000Z' });
    expect(
      await resolveBearer(expired.token, {
        verifySessionToken: async () => null,
        lookupPatByHash: makeStore([expired.record]),
        now: () => NOW,
      }),
    ).toBeNull();
  });

  it('fires onPatUsed but does not fail verification if it throws, and looks up by hash only', async () => {
    const { token, record } = mintPersonalAccessToken(
      { userId: 'agent_1', scopes: ['content:read'] },
      { generateId: () => 'pat_1', now: () => NOW },
    );
    const onPatUsed = vi.fn(async () => {
      throw new Error('storage down');
    });
    const lookupPatByHash = vi.fn(async (hash: string) => (hash === hashToken(token) ? record : null));

    const ctx = await resolveBearer(token, {
      verifySessionToken: async () => null,
      lookupPatByHash,
      now: () => NOW,
      onPatUsed,
    });

    expect(ctx).not.toBeNull();
    expect(onPatUsed).toHaveBeenCalledWith(record);
    expect(lookupPatByHash).toHaveBeenCalledWith(hashToken(token));
    expect(lookupPatByHash.mock.calls[0][0]).not.toBe(token);
  });
});
