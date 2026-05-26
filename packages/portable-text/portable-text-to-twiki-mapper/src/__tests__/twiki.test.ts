import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { twikiFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('twiki / foswiki format', () => {
  it('round-trips headings (`---+` = h1, `---++++++` = h6)', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Top', marks: [] }] },
      { _type: 'block', style: 'h3', markDefs: [], children: [{ _type: 'span', text: 'Sub', marks: [] }] },
    ]);
  });

  it('parses *bold* / _italic_ / __bold-italic__ / =fixed= / ==bold-fixed==', () => {
    const pt = format.toPortableText('*b* _i_ __bi__ =c= ==bc==');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'bi')?.marks).toEqual(['strong', 'em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
    expect(spans.find(s => s.text === 'bc')?.marks).toEqual(['strong', 'code']);
  });

  it('parses [[url][label]] into a link annotation', () => {
    const pt = format.toPortableText('see [[https://example.com][here]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses 3-space-indented `* item` (bullet) and bare-digit `1 item` (numbered)', () => {
    const pt = format.toPortableText('   * a\n   * b\n\n   1 one\n   2 two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('round-trips a <verbatim>...</verbatim> code block', () => {
    expectStable([{ _type: 'code', code: 'print(1)\nprint(2)', language: null }]);
  });

  it('serialises an h2 with `---++`', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Section', marks: [] }] },
    ]);
    expect(out).toBe('---++ Section');
  });

  it('detects TWiki markup', () => {
    expect(format.detect('---+ Top\n\n*bold* =fixed= [[a][b]]')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
