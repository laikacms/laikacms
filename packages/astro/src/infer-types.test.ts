import { describe, expect, it } from 'vitest';

import { inferTypeScript } from './infer-types.js';

describe('inferTypeScript', () => {
  it('describes the fields every entry has as required', () => {
    const source = inferTypeScript([
      { title: 'a', count: 1 },
      { title: 'b', count: 2 },
    ]);

    expect(source).toContain('title: string;');
    expect(source).toContain('count: number;');
  });

  it('marks a field missing from some entries as optional', () => {
    // A template reading this must handle the entries that lack it, so
    // reporting it as required would be a lie the checker enforces.
    const source = inferTypeScript([{ title: 'a', note: 'x' }, { title: 'b' }]);

    expect(source).toContain('title: string;');
    expect(source).toContain('note?: string;');
  });

  it('unions a field whose type varies across entries', () => {
    const source = inferTypeScript([{ id: 1 }, { id: 'two' }]);

    expect(source).toMatch(/id: (number \| string|string \| number);/);
  });

  it('describes arrays by their element type', () => {
    const source = inferTypeScript([{ tags: ['a', 'b'] }, { tags: ['c'] }]);

    expect(source).toContain('tags: Array<string>;');
  });

  it('unions mixed array elements', () => {
    const source = inferTypeScript([{ items: ['a', 1] }]);

    expect(source).toMatch(/items: Array<(string \| number|number \| string)>;/);
  });

  it('falls back to unknown[] for an array that is always empty', () => {
    const source = inferTypeScript([{ tags: [] }]);

    expect(source).toContain('tags: unknown[];');
  });

  it('recurses into nested objects', () => {
    const source = inferTypeScript([
      { icon: { si: 'cloudflare' } },
      { icon: { si: 'aws' } },
    ]);

    expect(source).toMatch(/icon: \{\s*si: string;\s*\}/);
  });

  it('marks a nested field optional when only some nested objects have it', () => {
    const source = inferTypeScript([
      { icon: { si: 'a' } },
      { icon: { si: 'b', svg: 'c' } },
    ]);

    expect(source).toContain('si: string;');
    expect(source).toContain('svg?: string;');
  });

  it('does not let a non-object occurrence make a nested field look optional', () => {
    // `icon` is a string in one entry. That must not mark `si` optional — the
    // string occurrence is not an object missing a field.
    const source = inferTypeScript([{ icon: { si: 'a' } }, { icon: 'plain' }]);

    expect(source).toContain('si: string;');
    expect(source).not.toContain('si?: string;');
  });

  it('reports null as its own type rather than collapsing it', () => {
    const source = inferTypeScript([{ note: null }, { note: 'x' }]);

    expect(source).toMatch(/note: (null \| string|string \| null);/);
  });

  it('describes a Date value as Date', () => {
    const source = inferTypeScript([{ at: new Date(0) }]);

    expect(source).toContain('at: Date;');
  });

  it('quotes a key that is not a bare identifier', () => {
    const source = inferTypeScript([{ 'og:title': 'x' }]);

    expect(source).toContain('"og:title": string;');
  });

  it('admits it knows nothing about an empty collection', () => {
    expect(inferTypeScript([])).toBe('Record<string, unknown>');
  });

  it('describes an entry with no fields as an open record', () => {
    expect(inferTypeScript([{}])).toBe('Record<string, unknown>');
  });
});
