import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { typstFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('typst format', () => {
  it('parses `=`...`======` headings into h1..h6', () => {
    const pt = format.toPortableText('= A\n== B\n====== F');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h6']);
  });

  it('parses inline `*bold*` / `_italic_` / `` `code` ``', () => {
    const pt = format.toPortableText('plain *bold* _italic_ `code`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'italic')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'code')?.marks).toEqual(['code']);
  });

  it('parses `#link("…")[…]` as a markDefs link', () => {
    const pt = format.toPortableText('see #link("https://example.com")[here]');
    const block = pt[0] as {
      markDefs: { href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses `- item` / `+ item` lists', () => {
    const pt = format.toPortableText('- a\n- b\n+ one\n+ two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[3] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses ```lang fenced code blocks', () => {
    const pt = format.toPortableText('```python\nx = 1\ny = 2\n```');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('parses `#quote[…]` as blockquote', () => {
    const pt = format.toPortableText('#quote[said the fox]');
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
  });

  it('strips `//` and `/* */` comments', () => {
    const pt = format.toPortableText(
      '// a comment\n= Title\n/* block\n   comment */\nBody.',
    );
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { children: { text: string }[] }).children[0]?.text).toBe('Body.');
  });

  it('round-trips a representative document', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ]);
  });

  it('detects Typst content', () => {
    expect(format.detect('= Title\n\n#link("https://x")[y]')).toBeGreaterThan(0.4);
    expect(format.detect('#quote[said]')).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
