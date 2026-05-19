import { describe, expect, it } from 'vitest';

import { paginationCodec } from './pagination-codec.js';

describe('paginationCodec.encode', () => {
  it('encodes after-cursor with size', () => {
    const params = paginationCodec.encode({ after: 'cur-1', perPage: 25 });
    expect(params.get('page[after]')).toBe('cur-1');
    expect(params.get('page[size]')).toBe('25');
    expect(params.get('page[before]')).toBe(null);
  });

  it('encodes before-cursor with size', () => {
    const params = paginationCodec.encode({ before: 'cur-9', perPage: 10 });
    expect(params.get('page[before]')).toBe('cur-9');
    expect(params.get('page[size]')).toBe('10');
    expect(params.get('page[after]')).toBe(null);
  });

  it('encodes page-based with size', () => {
    const params = paginationCodec.encode({ page: 3, perPage: 50 });
    expect(params.get('page[number]')).toBe('3');
    expect(params.get('page[size]')).toBe('50');
  });

  it('encodes offset-based with limit', () => {
    const params = paginationCodec.encode({ offset: 100, limit: 20 });
    expect(params.get('page[offset]')).toBe('100');
    expect(params.get('page[limit]')).toBe('20');
  });

  it('encodes offset-based without limit when limit is undefined', () => {
    const params = paginationCodec.encode({ offset: 100 });
    expect(params.get('page[offset]')).toBe('100');
    expect(params.get('page[limit]')).toBe(null);
  });

  it('omits perPage when undefined on cursor pagination', () => {
    const params = paginationCodec.encode({ after: 'cur-1' });
    expect(params.get('page[after]')).toBe('cur-1');
    expect(params.get('page[size]')).toBe(null);
  });
});

describe('paginationCodec.decode', () => {
  it('decodes after-cursor', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[after]=cur-1&page[size]=25'));
    expect(out).toEqual({ after: 'cur-1', perPage: 25 });
  });

  it('decodes before-cursor', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[before]=cur-9&page[size]=10'));
    expect(out).toEqual({ before: 'cur-9', perPage: 10 });
  });

  it('decodes page-based with size', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[number]=3&page[size]=50'));
    expect(out).toEqual({ page: 3, perPage: 50 });
  });

  it('decodes page-based without size', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[number]=2'));
    expect(out).toEqual({ page: 2 });
  });

  it('decodes offset-based with limit', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[offset]=100&page[limit]=20'));
    expect(out).toEqual({ offset: 100, limit: 20 });
  });

  it('decodes offset-based without limit', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[offset]=10'));
    expect(out).toEqual({ offset: 10 });
  });

  it('defaults to after-cursor when no pagination params are present', () => {
    const out = paginationCodec.decode(new URLSearchParams(''));
    expect(out).toEqual({ after: undefined });
  });

  it('preserves perPage on the default after-cursor branch', () => {
    const out = paginationCodec.decode(new URLSearchParams('page[size]=15'));
    expect(out).toEqual({ after: undefined, perPage: 15 });
  });

  it('prefers cursor params over page/offset when both are present', () => {
    const out = paginationCodec.decode(
      new URLSearchParams('page[after]=cur&page[number]=4&page[offset]=10'),
    );
    expect(out).toEqual({ after: 'cur', perPage: undefined });
  });
});

describe('paginationCodec round-trip', () => {
  it('after-cursor round-trips through encode/decode', () => {
    const input = { after: 'abc', perPage: 25 };
    expect(paginationCodec.decode(paginationCodec.encode(input))).toEqual(input);
  });

  it('before-cursor round-trips through encode/decode', () => {
    const input = { before: 'xyz', perPage: 10 };
    expect(paginationCodec.decode(paginationCodec.encode(input))).toEqual(input);
  });

  it('page-based round-trips through encode/decode', () => {
    const input = { page: 5, perPage: 100 };
    expect(paginationCodec.decode(paginationCodec.encode(input))).toEqual(input);
  });

  it('offset-based round-trips through encode/decode', () => {
    const input = { offset: 200, limit: 50 };
    expect(paginationCodec.decode(paginationCodec.encode(input))).toEqual(input);
  });
});

describe('paginationCodec string helpers', () => {
  it('encodeToString produces a query string', () => {
    const s = paginationCodec.encodeToString({ offset: 10, limit: 5 });
    const params = new URLSearchParams(s);
    expect(params.get('page[offset]')).toBe('10');
    expect(params.get('page[limit]')).toBe('5');
  });

  it('decodeFromString round-trips through encodeToString', () => {
    const input = { page: 2, perPage: 20 };
    const decoded = paginationCodec.decodeFromString(paginationCodec.encodeToString(input));
    expect(decoded).toEqual(input);
  });
});
