import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';
import { defaultCapabilities } from './capabilities.js';
import type { Capabilities } from './capabilities.js';

describe('defaultCapabilities', () => {
  it('has search set to false', () => {
    expect(defaultCapabilities.search).toBe(false);
  });

  it('has pagination set to false', () => {
    expect(defaultCapabilities.pagination).toBe(false);
  });

  it('has versioning set to false', () => {
    expect(defaultCapabilities.versioning).toBe(false);
  });

  it('has exactly the expected fields', () => {
    const keys = Object.keys(defaultCapabilities).sort();
    expect(keys).toEqual(['pagination', 'search', 'versioning']);
  });

  it('can be wrapped in a success result', () => {
    const result = Result.succeed(defaultCapabilities);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const caps: Capabilities = result.success;
      expect(caps).toEqual({ search: false, pagination: false, versioning: false });
    }
  });
});
