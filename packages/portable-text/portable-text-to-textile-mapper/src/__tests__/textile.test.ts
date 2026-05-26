import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { textileFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('textile format', () => {
  it('round-trips heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('round-trips a block quote and a code block', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
      { _type: 'code', code: 'console.log("hi")', language: null },
    ]);
  });

  it('parses *bold* / _italic_ / -strike- / @code@', () => {
    const pt = format.toPortableText('*b* _i_ -s- @c@');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses "label":url into a link annotation', () => {
    const pt = format.toPortableText('see "here":https://example.com');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses * bullets and # numbered items', () => {
    const pt = format.toPortableText('* one\n* two\n\n# first\n# second');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('serialises h3 with `h3.` prefix', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h3', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    expect(out).toBe('h3. Hi');
  });

  it('detects Textile markup', () => {
    expect(format.detect('h1. Title\n\n*bold* "link":http://x')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
