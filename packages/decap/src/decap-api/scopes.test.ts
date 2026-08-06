import { describe, expect, it } from 'vitest';

import type { AuthorizeContext, CmsDomain, CmsOperation, User } from './index.js';
import {
  ADMIN_SCOPE,
  createScopePolicy,
  hasScope,
  isScope,
  normalizeScopes,
  requiredScopeFor,
  WILDCARD_SCOPE,
} from './scopes.js';

describe('isScope', () => {
  it('accepts global grants and any well-formed resource:action', () => {
    expect(isScope(ADMIN_SCOPE)).toBe(true);
    expect(isScope(WILDCARD_SCOPE)).toBe(true);
    expect(isScope('content:read')).toBe(true);
    // Open vocabulary: not shipped, but structurally valid.
    expect(isScope('shipping:read')).toBe(true);
    expect(isScope('orders:*')).toBe(true);
  });

  it('rejects structurally invalid scopes', () => {
    expect(isScope('')).toBe(false);
    expect(isScope('content')).toBe(false);
    expect(isScope(':read')).toBe(false);
    expect(isScope('content:')).toBe(false);
    expect(isScope('a:b:c')).toBe(false);
  });
});

describe('hasScope', () => {
  it('a global grant satisfies anything, including consumer namespaces', () => {
    expect(hasScope([ADMIN_SCOPE], 'content:write')).toBe(true);
    expect(hasScope([WILDCARD_SCOPE], 'shipping:read')).toBe(true);
  });

  it('an exact grant only satisfies itself', () => {
    expect(hasScope(['content:read'], 'content:read')).toBe(true);
    expect(hasScope(['content:read'], 'content:write')).toBe(false);
  });

  it('a resource:* grant satisfies any action on that resource only', () => {
    expect(hasScope(['content:*'], 'content:write')).toBe(true);
    expect(hasScope(['shipping:*'], 'shipping:read')).toBe(true);
    expect(hasScope(['content:*'], 'media:read')).toBe(false);
  });

  it('an empty grant satisfies nothing', () => {
    expect(hasScope([], 'content:read')).toBe(false);
  });
});

describe('normalizeScopes', () => {
  it('collapses a global grant to a single admin, never enumerating', () => {
    expect(normalizeScopes([ADMIN_SCOPE, 'content:read'])).toEqual([ADMIN_SCOPE]);
    expect(normalizeScopes([WILDCARD_SCOPE])).toEqual([ADMIN_SCOPE]);
  });

  it('dedupes and preserves consumer-defined scopes verbatim', () => {
    expect(normalizeScopes(['shipping:read', 'shipping:read', 'sales:write'])).toEqual([
      'shipping:read',
      'sales:write',
    ]);
  });
});

describe('requiredScopeFor', () => {
  const cases: Array<[CmsDomain, CmsOperation, string | null]> = [
    ['session', 'read', null],
    ['documents', 'read', 'content:read'],
    ['documents', 'update', 'content:write'],
    ['documents', 'publish', 'content:write'],
    ['storage', 'read', 'content:read'],
    ['storage', 'delete', 'content:write'],
    ['assets', 'read', 'media:read'],
    ['assets', 'create', 'media:write'],
    ['locks', 'create', 'content:write'],
  ];

  it.each(cases)('maps %s/%s -> %s', (domain, operation, expected) => {
    expect(requiredScopeFor(domain, operation)).toBe(expected);
  });
});

describe('createScopePolicy', () => {
  function ctx(overrides: Partial<AuthorizeContext> & { user?: Partial<User> } = {}): AuthorizeContext {
    return {
      user: { id: 'u1', email: 'u1@example.com', ...overrides.user } as User,
      request: new Request('https://example.com'),
      method: 'GET',
      domain: 'documents',
      operation: 'read',
      ...overrides,
    } as AuthorizeContext;
  }

  it('allows when the principal has the required scope', () => {
    const policy = createScopePolicy();
    expect(policy(ctx({ user: { scopes: ['content:read'] } }))).toBe(true);
  });

  it('denies when the principal lacks the required scope (fails closed)', () => {
    const policy = createScopePolicy();
    // Read requires content:read; only content:write is granted.
    expect(policy(ctx({ user: { scopes: ['content:write'] }, operation: 'read' }))).toBe(false);
    // No scopes at all.
    expect(policy(ctx({ operation: 'update' }))).toBe(false);
  });

  it('always allows identity-only session reads regardless of scopes', () => {
    const policy = createScopePolicy();
    expect(policy(ctx({ domain: 'session', operation: 'read' }))).toBe(true);
  });

  it('honours admin and resource wildcards', () => {
    const policy = createScopePolicy();
    expect(policy(ctx({ user: { scopes: [ADMIN_SCOPE] }, operation: 'delete' }))).toBe(true);
    expect(policy(ctx({ user: { scopes: ['content:*'] }, operation: 'update' }))).toBe(true);
  });

  it('supports a custom requiredScopeFor for consumer routes', () => {
    const policy = createScopePolicy({
      requiredScopeFor: c => (c.collection === 'orders' ? 'orders:write' : null),
    });
    expect(policy(ctx({ collection: 'orders', user: { scopes: ['orders:write'] } }))).toBe(true);
    expect(policy(ctx({ collection: 'orders', user: { scopes: ['content:read'] } }))).toBe(false);
    // Non-orders route maps to null -> allowed.
    expect(policy(ctx({ collection: 'posts' }))).toBe(true);
  });

  it('supports a custom scopesOf source (ignoring user.scopes)', () => {
    // Grants come from somewhere other than user.scopes; content:read is present
    // there so reads pass but writes do not.
    const policy = createScopePolicy({ scopesOf: () => ['content:read'] });
    expect(policy(ctx({ operation: 'read' }))).toBe(true);
    expect(policy(ctx({ operation: 'update' }))).toBe(false);
  });
});
