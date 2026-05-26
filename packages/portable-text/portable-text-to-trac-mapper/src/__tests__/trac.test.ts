import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { tracFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('trac wiki format', () => {
  it('round-trips a heading and paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it("parses '''bold''' / ''italic'' / __underline__ / ~~strike~~", () => {
    const pt = format.toPortableText("'''b''' ''i'' __u__ ~~s~~");
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
  });

  it('parses ,,sub,, and ^sup^', () => {
    const pt = format.toPortableText('H,,2,,O E=mc^2^');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === '2' && s.marks.includes('sub'))).toBeTruthy();
    expect(spans.find(s => s.text === '2' && s.marks.includes('sup'))).toBeTruthy();
  });

  it('parses [url label] into a link annotation', () => {
    const pt = format.toPortableText('see [https://example.com here]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses indented * (bullet) and N. (numbered) lists', () => {
    const pt = format.toPortableText(' * a\n * b\n\n 1. one\n 2. two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('round-trips a {{{...}}} code block', () => {
    expectStable([{ _type: 'code', code: 'print(1)\nprint(2)', language: null }]);
  });

  it('detects Trac wiki markup', () => {
    expect(format.detect("= Top =\n\n'''bold''' ,,sub,, ^sup^")).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
