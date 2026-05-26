import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { markuaFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('markua format', () => {
  it('parses `T> …` tip asides', () => {
    const pt = format.toPortableText('T> Be careful here\nT> with line two.');
    expect((pt[0] as { _type: string })._type).toBe('markua:aside');
    expect((pt[0] as { kind: string }).kind).toBe('tip');
    expect((pt[0] as { text: string }).text).toBe('Be careful here\nwith line two.');
  });

  it('parses `W> …` warning, `I> …` information, `A> …` general asides', () => {
    const pt = format.toPortableText('W> warn\n\nI> info\n\nA> note');
    const kinds = pt.filter(b => (b as { _type: string })._type === 'markua:aside').map(b =>
      (b as { kind: string }).kind
    );
    expect(kinds).toEqual(['warning', 'information', 'general']);
  });

  it('parses `{frontmatter}`/`{mainmatter}`/`{backmatter}` markers', () => {
    const pt = format.toPortableText('{frontmatter}\n\n# Preface\n\n{mainmatter}');
    const types = pt.map(b => (b as { _type: string })._type);
    expect(types).toContain('markua:matter');
    const kinds = pt.filter(b => (b as { _type: string })._type === 'markua:matter').map(b =>
      (b as { kind: string }).kind
    );
    expect(kinds).toEqual(['frontmatter', 'mainmatter']);
  });

  it('passes regular Markdown through unchanged', () => {
    const pt = format.toPortableText('# Chapter\n\nText with **bold**.');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    const spans = (pt[1] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.some(s => s.marks.includes('strong'))).toBe(true);
  });

  it('round-trips an aside + matter + heading mix', () => {
    expectStable([
      { _type: 'markua:matter', kind: 'mainmatter' },
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Chapter', marks: [] }] },
      { _type: 'markua:aside', kind: 'tip', text: 'A useful tip' },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', text: 'Body.', marks: [] }],
      },
    ] as unknown as PortableTextDocument);
  });

  it('detects Markua-specific markers', () => {
    expect(format.detect('T> a tip\n\n# Body')).toBeGreaterThan(0.4);
    expect(format.detect('{mainmatter}\n\n# Chapter')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
