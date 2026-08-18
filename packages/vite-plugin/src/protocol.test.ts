import { describe, expect, it } from 'vitest';

import { isLaikaSource, isVirtualId, parseLaikaId, toSource, toVirtualId } from './protocol.js';

describe('isLaikaSource', () => {
  it('returns true for laika: prefixed strings', () => {
    expect(isLaikaSource('laika:doc/posts/hello')).toBe(true);
    expect(isLaikaSource('laika:store/config')).toBe(true);
    expect(isLaikaSource('laika:')).toBe(true);
  });

  it('returns false for virtual ids (NUL-prefixed)', () => {
    expect(isLaikaSource('\0laika:doc/posts/hello')).toBe(false);
  });

  it('returns false for regular module specifiers', () => {
    expect(isLaikaSource('./module')).toBe(false);
    expect(isLaikaSource('some-package')).toBe(false);
    expect(isLaikaSource('')).toBe(false);
  });
});

describe('isVirtualId', () => {
  it('returns true for NUL-prefixed laika virtual ids', () => {
    expect(isVirtualId('\0laika:doc/posts/hello')).toBe(true);
    expect(isVirtualId('\0laika:store/config')).toBe(true);
  });

  it('returns false for plain laika: sources (no NUL)', () => {
    expect(isVirtualId('laika:doc/posts/hello')).toBe(false);
  });

  it('returns false for regular module specifiers', () => {
    expect(isVirtualId('./module')).toBe(false);
    expect(isVirtualId('some-package')).toBe(false);
  });
});

describe('parseLaikaId', () => {
  describe('happy path — canonical namespaces', () => {
    it('parses doc namespace', () => {
      expect(parseLaikaId('laika:doc/posts/hello')).toEqual({ namespace: 'doc', key: 'posts/hello' });
    });

    it('parses store namespace', () => {
      expect(parseLaikaId('laika:store/config')).toEqual({ namespace: 'store', key: 'config' });
    });
  });

  describe('happy path — namespace aliases', () => {
    it('normalises docs → doc', () => {
      expect(parseLaikaId('laika:docs/posts/hello')).toEqual({ namespace: 'doc', key: 'posts/hello' });
    });

    it('normalises document → doc', () => {
      expect(parseLaikaId('laika:document/slug')).toEqual({ namespace: 'doc', key: 'slug' });
    });

    it('normalises documents → doc', () => {
      expect(parseLaikaId('laika:documents/a/b')).toEqual({ namespace: 'doc', key: 'a/b' });
    });

    it('normalises storage → store', () => {
      expect(parseLaikaId('laika:storage/config')).toEqual({ namespace: 'store', key: 'config' });
    });
  });

  describe('happy path — virtual id input', () => {
    it('parses NUL-prefixed virtual ids', () => {
      expect(parseLaikaId('\0laika:doc/posts/hello')).toEqual({ namespace: 'doc', key: 'posts/hello' });
    });

    it('parses virtual store ids', () => {
      expect(parseLaikaId('\0laika:store/config')).toEqual({ namespace: 'store', key: 'config' });
    });
  });

  describe('error paths', () => {
    it('throws when there is no slash', () => {
      expect(() => parseLaikaId('laika:doc')).toThrow(/expected "laika:<namespace>\/<key>"/);
    });

    it('throws for an unknown namespace', () => {
      expect(() => parseLaikaId('laika:invalid/key')).toThrow(/Invalid laika namespace "invalid"/);
    });

    it('throws when the key after the slash is empty', () => {
      expect(() => parseLaikaId('laika:doc/')).toThrow(/missing key after "doc\/"/);
    });

    it('throws for unknown namespace in virtual id', () => {
      expect(() => parseLaikaId('\0laika:invalid/key')).toThrow(/Invalid laika namespace "invalid"/);
    });
  });
});

describe('toSource', () => {
  it('renders doc namespace', () => {
    expect(toSource({ namespace: 'doc', key: 'posts/hello' })).toBe('laika:doc/posts/hello');
  });

  it('renders store namespace', () => {
    expect(toSource({ namespace: 'store', key: 'config' })).toBe('laika:store/config');
  });

  it('round-trips through parseLaikaId', () => {
    const id = { namespace: 'doc' as const, key: 'a/b/c' };
    expect(parseLaikaId(toSource(id))).toEqual(id);
  });
});

describe('toVirtualId', () => {
  it('renders doc namespace with NUL prefix', () => {
    expect(toVirtualId({ namespace: 'doc', key: 'posts/hello' })).toBe('\0laika:doc/posts/hello');
  });

  it('renders store namespace with NUL prefix', () => {
    expect(toVirtualId({ namespace: 'store', key: 'config' })).toBe('\0laika:store/config');
  });

  it('round-trips through parseLaikaId', () => {
    const id = { namespace: 'store' as const, key: 'x/y' };
    expect(parseLaikaId(toVirtualId(id))).toEqual(id);
  });
});
