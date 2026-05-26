import { describe, expect, it } from 'vitest';

import { pugFormat as format } from '../index';

describe('pug / jade format', () => {
  it('parses `h1 …`, `p …` and `blockquote …` lines', () => {
    const pt = format.toPortableText('h1 Title\np Body\nblockquote said');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
    expect((pt[2] as { style?: string }).style).toBe('blockquote');
  });

  it('parses `#[strong …]` / `#[em …]` / `#[code …]` inline marks', () => {
    const pt = format.toPortableText('p plain #[strong b] #[em i] #[code c]');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses `#[a(href="…") label]` as a link annotation', () => {
    const pt = format.toPortableText('p see #[a(href="https://example.com") here]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses `ul` / `ol` blocks with indented `li` children', () => {
    const pt = format.toPortableText('ul\n  li one\n  li two\nol\n  li alpha');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses `pre.` literal blocks as code', () => {
    const pt = format.toPortableText('pre.\n  print(1)\n  print(2)');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
  });

  it('serialises h2 to `h2 Section`', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Section', marks: [] }] },
    ]);
    expect(out).toBe('h2 Section');
  });

  it('detects Pug input', () => {
    expect(format.detect('h1 Title\np Body with #[strong x]')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
