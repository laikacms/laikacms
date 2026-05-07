import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';
import { AsyncGenerator, Header, lazy, lazyAsync, memoize, Paths, TemplateLiteral, Url } from './utilities.js';

describe('lazy', () => {
  it('runs the factory the first time and reuses the result thereafter', () => {
    let calls = 0;
    const get = lazy(() => {
      calls++;
      return { id: calls };
    });
    expect(get().id).toBe(1);
    expect(get().id).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('lazyAsync', () => {
  it('awaits the factory once and reuses the resolved value', async () => {
    let calls = 0;
    const get = lazyAsync(async () => {
      calls++;
      return calls;
    });
    expect(await get()).toBe(1);
    expect(await get()).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('memoize', () => {
  it('caches the most recent input → output pair', () => {
    let calls = 0;
    const square = memoize((n: number) => {
      calls++;
      return n * n;
    });

    expect(square(3)).toBe(9);
    expect(square(3)).toBe(9);
    expect(calls).toBe(1);
  });

  it('recomputes when the input changes (single-slot cache)', () => {
    let calls = 0;
    const id = memoize((n: number) => {
      calls++;
      return n;
    });

    id(1);
    id(2);
    id(1); // cache currently holds 2 → recomputes
    expect(calls).toBe(3);
  });

  it('uses reference equality (===) for the cache key', () => {
    let calls = 0;
    const f = memoize((o: { x: number }) => {
      calls++;
      return o.x;
    });
    const obj = { x: 1 };
    f(obj);
    f(obj);
    expect(calls).toBe(1);

    f({ x: 1 }); // new reference, even if structurally equal
    expect(calls).toBe(2);
  });
});

describe('AsyncGenerator helpers', () => {
  async function* range(n: number) {
    for (let i = 0; i < n; i++) yield i;
  }

  it('toArray collects every yielded value', async () => {
    expect(await AsyncGenerator.toArray(range(3))).toEqual([0, 1, 2]);
  });

  it('toArray returns [] for an empty generator', async () => {
    async function* empty() {}
    expect(await AsyncGenerator.toArray(empty())).toEqual([]);
  });

  it('first returns the first value and stops iterating', async () => {
    let visited = 0;
    async function* counted() {
      for (let i = 0; i < 5; i++) {
        visited++;
        yield i;
      }
    }
    expect(await AsyncGenerator.first(counted())).toBe(0);
    expect(visited).toBe(1);
  });

  it('first returns undefined for an empty generator', async () => {
    async function* empty() {}
    expect(await AsyncGenerator.first(empty())).toBeUndefined();
  });

  it('accumulateFirst returns the first success and short-circuits', async () => {
    async function* gen() {
      yield Result.fail({ kind: 'err1' });
      yield Result.succeed('hello');
      yield Result.fail({ kind: 'err2' });
    }
    const result = await AsyncGenerator.accumulateFirst(gen() as any);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success).toBe('hello');
  });

  it('accumulateFirst collects every failure when no success arrives', async () => {
    async function* gen() {
      yield Result.fail({ kind: 'a' });
      yield Result.fail({ kind: 'b' });
    }
    const result = await AsyncGenerator.accumulateFirst(gen() as any);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect((result.failure as Array<{ kind: string }>).map(e => e.kind)).toEqual(['a', 'b']);
    }
  });
});

describe('Url.isAbsolute', () => {
  it('matches scheme-prefixed URLs', () => {
    expect(Url.isAbsolute('https://example.com')).toBe(true);
    expect(Url.isAbsolute('http://example.com')).toBe(true);
    expect(Url.isAbsolute('ftp://x')).toBe(true);
    expect(Url.isAbsolute('mailto:a@b.c')).toBe(true);
  });

  it('rejects relative paths and falsy values', () => {
    expect(Url.isAbsolute('/absolute-path')).toBe(false);
    expect(Url.isAbsolute('foo/bar')).toBe(false);
    expect(Url.isAbsolute(undefined)).toBe(false);
    expect(Url.isAbsolute(null)).toBe(false);
    expect(Url.isAbsolute('')).toBe(false);
  });
});

describe('Url.normalize', () => {
  it('strips a single trailing slash from non-absolute paths', () => {
    expect(Url.normalize('foo/')).toBe('/foo');
    expect(Url.normalize('/foo/')).toBe('/foo');
  });

  it('prepends a leading slash to relative paths', () => {
    expect(Url.normalize('foo')).toBe('/foo');
  });

  it('passes absolute URLs through unchanged after the trailing-slash trim', () => {
    expect(Url.normalize('https://example.com')).toBe('https://example.com');
    // Trailing slash is stripped before the absolute check, so the scheme test runs against
    // the trimmed value — this is the actual current behavior:
    expect(Url.normalize('https://example.com/')).toBe('https://example.com');
  });
});

describe('Url.join', () => {
  it('joins two relative parts', () => {
    expect(Url.join('/api', 'docs')).toBe('/api/docs');
  });

  it('returns the second URL verbatim if it is absolute', () => {
    expect(Url.join('/api', 'https://other.com/x')).toBe('https://other.com/x');
  });

  it('handles empty / nullish parts', () => {
    expect(Url.join(null, '/foo')).toBe('/foo');
    expect(Url.join('/foo', null)).toBe('/foo');
    expect(Url.join(null, null)).toBe('');
  });
});

describe('Url.combine', () => {
  it('joins many segments left-to-right', () => {
    expect(Url.combine('/api', 'v1', 'docs')).toBe('/api/v1/docs');
  });

  it('returns "" when given no usable segments', () => {
    expect(Url.combine()).toBe('');
    expect(Url.combine(null, undefined)).toBe('');
  });
});

describe('Paths.pathToSegments', () => {
  it('splits and trims path segments', () => {
    expect(Paths.pathToSegments('/foo/bar/baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('drops empty and whitespace-only segments', () => {
    expect(Paths.pathToSegments('//foo///bar/')).toEqual(['foo', 'bar']);
    expect(Paths.pathToSegments('  ')).toEqual([]);
  });

  it('toSegments is an alias of pathToSegments', () => {
    expect(Paths.toSegments('/a/b')).toEqual(Paths.pathToSegments('/a/b'));
  });
});

describe('Paths.combine', () => {
  it('joins segments with a single slash', () => {
    expect(Paths.combine('foo', 'bar', 'baz')).toBe('foo/bar/baz');
  });

  it('drops empty / whitespace-only segments', () => {
    expect(Paths.combine('foo', '', '  ', 'bar')).toBe('foo/bar');
  });
});

describe('TemplateLiteral.url', () => {
  it('builds a URL from interpolated parts', () => {
    const id = 42;
    expect(TemplateLiteral.url`/api/users/${id}/profile`).toBe('/api/users/42/profile');
  });
});

describe('Header.ExtractAuthorizationBearerToken', () => {
  it('extracts a Bearer token', () => {
    expect(Header.ExtractAuthorizationBearerToken('Bearer abc123')).toBe('abc123');
    expect(Header.ExtractAuthorizationBearerToken('Bearer  spaced')).toBe('spaced');
  });

  it('returns undefined when absent or malformed', () => {
    expect(Header.ExtractAuthorizationBearerToken(null)).toBeUndefined();
    expect(Header.ExtractAuthorizationBearerToken(undefined)).toBeUndefined();
    expect(Header.ExtractAuthorizationBearerToken('')).toBeUndefined();
    expect(Header.ExtractAuthorizationBearerToken('Basic abc')).toBeUndefined();
    expect(Header.ExtractAuthorizationBearerToken('bearer abc')).toBeUndefined(); // case-sensitive
  });

  it('does not match Bearer with no token', () => {
    expect(Header.ExtractAuthorizationBearerToken('Bearer ')).toBeUndefined();
  });
});

describe('Header.ExtractAuthorizationApiKey', () => {
  it('extracts an ApiKey credential', () => {
    expect(Header.ExtractAuthorizationApiKey('ApiKey deadbeef')).toBe('deadbeef');
  });

  it('returns undefined for a Bearer header', () => {
    expect(Header.ExtractAuthorizationApiKey('Bearer abc')).toBeUndefined();
  });

  it('returns undefined for null / undefined', () => {
    expect(Header.ExtractAuthorizationApiKey(null)).toBeUndefined();
    expect(Header.ExtractAuthorizationApiKey(undefined)).toBeUndefined();
  });
});
