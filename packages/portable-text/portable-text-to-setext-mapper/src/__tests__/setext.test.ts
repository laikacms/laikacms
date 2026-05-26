import { describe, expect, it } from 'vitest';

import { setextFormat as format } from '../index';

describe('setext-only markdown format', () => {
  it('parses `===` underline as h1 and `---` as h2', () => {
    const pt = format.toPortableText('Top\n===\n\nSub\n---\n\nBody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('h2');
    expect((pt[2] as { style?: string }).style).toBe('normal');
  });

  it('parses **bold** / *italic* / `code`', () => {
    const pt = format.toPortableText('**b** *i* `c`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses [label](url) links', () => {
    const pt = format.toPortableText('see [here](https://example.com)');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses bullets, numbered lists, and a block quote', () => {
    const pt = format.toPortableText('- a\n- b\n\n1. one\n2. two\n\n> said');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[4] as { style?: string }).style).toBe('blockquote');
  });

  it('parses a 4-space-indented paragraph as a code block', () => {
    const pt = format.toPortableText('Hello\n\n    let x = 1;\n    let y = 2;');
    expect((pt[1] as { _type: string })._type).toBe('code');
    expect((pt[1] as { code?: string }).code).toBe('let x = 1;\nlet y = 2;');
  });

  it('serialises an h1 with `===` of matching length', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
    ]);
    expect(out).toBe('Title\n=====');
  });

  it('detects Setext input (and prefers it over ATX-`#` markdown)', () => {
    expect(format.detect('Title\n=====\n\nBody')).toBeGreaterThan(0.3);
    expect(format.detect('# ATX heading\n\nbody')).toBe(0);
  });
});
