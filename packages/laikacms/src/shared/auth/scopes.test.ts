import { describe, expect, it } from 'vitest';

import {
  ADMIN_SCOPE,
  ALL_SCOPES,
  GRANULAR_SCOPES,
  hasScope,
  isScope,
  normalizeScopes,
  WILDCARD_SCOPE,
} from './scopes.js';

describe('scopes', () => {
  it('lists the shipped CMS scopes plus admin in ALL_SCOPES', () => {
    expect(ALL_SCOPES).toEqual([...GRANULAR_SCOPES, ADMIN_SCOPE]);
  });

  describe('isScope', () => {
    it('accepts global grants and any well-formed resource:action', () => {
      expect(isScope(ADMIN_SCOPE)).toBe(true);
      expect(isScope(WILDCARD_SCOPE)).toBe(true);
      expect(isScope('content:read')).toBe(true);
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
});
