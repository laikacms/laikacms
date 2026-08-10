import { describe, expect, it } from 'vitest';

import { AuthenticationError, ForbiddenError } from 'laikacms/core';

import { allowAll, resolveAuthorization } from './authorize.js';

describe('resolveAuthorization', () => {
  it('treats true as allowed', () => {
    expect(resolveAuthorization(true)).toBeNull();
  });

  it('turns a bare false into a generic ForbiddenError', () => {
    const denial = resolveAuthorization(false);
    expect(denial).toBeInstanceOf(ForbiddenError);
  });

  it('passes a returned error through unchanged so its own status drives the response', () => {
    const error = new AuthenticationError('Missing bearer token');
    expect(resolveAuthorization(error)).toBe(error);
  });
});

describe('allowAll', () => {
  it('permits the action', () => {
    expect(resolveAuthorization(allowAll())).toBeNull();
  });
});
