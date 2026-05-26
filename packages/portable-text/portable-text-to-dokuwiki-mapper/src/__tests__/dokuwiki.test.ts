import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { dokuwikiFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('dokuwiki format', () => {
  it('uses INVERTED heading levels (6 = → h1, 1 = → h6)', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Top', marks: [] }] },
      { _type: 'block', style: 'h6', markDefs: [], children: [{ _type: 'span', text: 'Tiny', marks: [] }] },
    ]);
    expect(out).toContain('====== Top ======');
    expect(out).toContain('= Tiny =');
  });

  it('round-trips a heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Section', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it("parses **bold** / //italic// / __underline__ / ''code''", () => {
    const pt = format.toPortableText("**b** //i// __u__ ''c''");
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses <del>strike</del>', () => {
    const pt = format.toPortableText('plain <del>gone</del>');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'gone')?.marks).toEqual(['strike-through']);
  });

  it('parses [[url|label]] links', () => {
    const pt = format.toPortableText('see [[https://example.com|here]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses indented * (bullet) and - (numbered) list items', () => {
    const pt = format.toPortableText('  * apple\n  * pear\n\n  - one\n  - two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('round-trips a <code lang>...</code> block', () => {
    expectStable([{ _type: 'code', code: 'print(1)', language: 'python' }]);
  });

  it('detects DokuWiki markup', () => {
    expect(format.detect('====== Title ======\n\n//italic// and [[u|l]]')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
