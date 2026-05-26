import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { wikidotFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('wikidot format', () => {
  it('parses `+`..`++++++` headings as h1..h6', () => {
    const pt = format.toPortableText('+ A\n++ B\n+++ C\n++++++ F');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3', 'h6']);
  });

  it('parses `**` / `//` / `__` / `--` / `^^` / `,,` / `{{}}` / `@@@@` decorators', () => {
    const pt = format.toPortableText('plain **b** //i// __u__ --s-- ^^x^^ ,,y,, {{c}} @@d@@');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
    expect(spans.find(s => s.text === 'd')?.marks).toEqual(['code']);
  });

  it('parses `[URL text]` external links and `[[[Page|text]]]` wiki links', () => {
    const pt = format.toPortableText('see [https://example.com docs] and [[[OtherPage|the page]]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    const hrefs = block.markDefs.map(m => m.href).sort();
    expect(hrefs).toEqual(['https://example.com', 'wikidot://page/OtherPage']);
  });

  it('parses `* ` bullets, `# ` numbered, 2-space indent for nesting', () => {
    const pt = format.toPortableText('* a\n  * b\n# one\n  # two');
    expect((pt[0] as { listItem?: string, level?: number }).listItem).toBe('bullet');
    expect((pt[1] as { level?: number }).level).toBe(2);
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[3] as { level?: number }).level).toBe(2);
  });

  it('parses `[[code type="lang"]]...[[/code]]` as a code block', () => {
    const pt = format.toPortableText('[[code type="python"]]\nprint(1)\nprint(2)\n[[/code]]');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { language?: string }).language).toBe('python');
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
  });

  it('parses `> ` blockquote runs into a single blockquote', () => {
    const pt = format.toPortableText('> one\n> two\n\nbody');
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('drops `[!-- … --]` comments and recognises `----` as hr', () => {
    const pt = format.toPortableText('[!-- a comment --]\n+ Title\n----\nbody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { _type: string })._type).toBe('hr');
  });

  it('drops unknown `[[div]]` / `[[/div]]` module wrappers but keeps body', () => {
    const pt = format.toPortableText('[[div class="x"]]\nbody text\n[[/div]]');
    expect(pt).toHaveLength(1);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('body text');
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

  it('detects Wikidot content', () => {
    expect(format.detect('+ Heading\n\n[[[Page|link]]]')).toBeGreaterThan(0.4);
    expect(format.detect('[[code type="ts"]]\nx\n[[/code]]')).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
