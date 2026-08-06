import { describe, expect, it } from 'vitest';

import { hasRequiredScope, InsufficientScopeError, requireScope } from './requireScope.js';

import type { AuthContext } from './types.js';

function ctx(scopes: AuthContext['scopes']): AuthContext {
  return { user: { id: 'u1' }, scopes, tokenType: 'pat', patId: 'pat_1' };
}

describe('requireScope', () => {
  it('passes silently when the scope is granted (exact, admin, or wildcard)', () => {
    expect(() => requireScope(ctx(['content:write']), 'content:write')).not.toThrow();
    expect(() => requireScope(ctx(['admin']), 'config:read')).not.toThrow();
    expect(() => requireScope(ctx(['content:*']), 'content:write')).not.toThrow();
    expect(() => requireScope(ctx(['shipping:read']), 'shipping:read')).not.toThrow();
  });

  it('throws InsufficientScopeError carrying the missing scope', () => {
    expect(() => requireScope(ctx(['content:read']), 'content:write')).toThrow(InsufficientScopeError);
    try {
      requireScope(ctx([]), 'media:write');
      throw new Error('expected requireScope to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientScopeError);
      expect((err as InsufficientScopeError).required).toBe('media:write');
      expect((err as Error).message).toMatch(/media:write/);
    }
  });
});

describe('hasRequiredScope', () => {
  it('mirrors requireScope as a boolean, non-throwing check', () => {
    expect(hasRequiredScope(ctx(['content:read']), 'content:read')).toBe(true);
    expect(hasRequiredScope(ctx(['content:read']), 'content:write')).toBe(false);
    expect(hasRequiredScope(ctx(['admin']), 'content:write')).toBe(true);
  });
});
