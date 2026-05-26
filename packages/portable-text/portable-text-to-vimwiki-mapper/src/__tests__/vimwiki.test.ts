import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { vimwikiFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('vimwiki format', () => {
  it('parses balanced-equals headings', () => {
    const pt = format.toPortableText('= H1 =\n== H2 ==\n====== H6 ======');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h6']);
  });

  it('parses single-char `*bold*`, `_italic_`, `` `code` ``, `^sup^`', () => {
    const pt = format.toPortableText('plain *bold* _italic_ `code` ^sup^');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'italic')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'code')?.marks).toEqual(['code']);
    expect(spans.find(s => s.text === 'sup')?.marks).toEqual(['sup']);
  });

  it('parses `~~strike~~` and `,,sub,,`', () => {
    const pt = format.toPortableText('a ~~s~~ b ,,x,,');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sub']);
  });

  it("doesn't match `_` inside `snake_case` words as italic", () => {
    const pt = format.toPortableText('look at snake_case_word here');
    const text = (pt[0] as { children: { text: string, marks: string[] }[] }).children
      .map(c => c.text)
      .join('');
    expect(text).toBe('look at snake_case_word here');
    const allMarks = (pt[0] as { children: { text: string, marks: string[] }[] }).children.flatMap(c => c.marks);
    expect(allMarks).not.toContain('em');
  });

  it('parses `[[Target]]` / `[[Target|Label]]` wiki links', () => {
    const pt = format.toPortableText('see [[OtherPage]] and [[Other|the page]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('vimwiki://page/OtherPage');
    expect(block.markDefs[1]?.href).toBe('vimwiki://page/Other');
    expect(block.children.find(c => c.text === 'the page')?.marks).toHaveLength(1);
  });

  it('parses `* `/`- ` bullet and `1. `/`# ` numbered lists with 2-space nesting', () => {
    const pt = format.toPortableText('* a\n  * b\n1. one\n# two');
    expect((pt[0] as { listItem?: string, level?: number }).listItem).toBe('bullet');
    expect((pt[1] as { level?: number }).level).toBe(2);
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[3] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses `{{{` ... `}}}` code blocks', () => {
    const pt = format.toPortableText('{{{\nline 1\nline 2\n}}}');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('line 1\nline 2');
  });

  it('drops `%%` line comments and `----` horizontal rules', () => {
    const pt = format.toPortableText('%% a comment\n= Title =\n----\nbody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { _type: string })._type).toBe('hr');
    expect((pt[2] as { children: { text: string }[] }).children[0]?.text).toBe('body');
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

  it('detects Vimwiki content', () => {
    expect(format.detect('= Title =\n\n%% comment\n\nbody')).toBeGreaterThan(0.4);
    expect(format.detect('see [[Other]] and {{{\ncode\n}}}')).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
