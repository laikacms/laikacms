import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { texinfoFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('texinfo format', () => {
  it('parses @chapter / @section into h1 / h2', () => {
    const pt = format.toPortableText('@chapter Top\n\n@section Sub');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('h2');
  });

  it('parses @b{...} / @i{...} / @code{...} into marks', () => {
    const pt = format.toPortableText('@b{b} @i{i} @code{c}');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses @uref{url, label} into a link annotation', () => {
    const pt = format.toPortableText('see @uref{https://example.com, here}');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses @itemize / @item / @end itemize into bullet list', () => {
    const pt = format.toPortableText('@itemize @bullet\n@item\nApple\n@item\nPear\n@end itemize');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses @enumerate as numbered list', () => {
    const pt = format.toPortableText('@enumerate\n@item\nOne\n@item\nTwo\n@end enumerate');
    expect((pt[0] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses @example / @end example as a code block', () => {
    const pt = format.toPortableText('@example\nx = 1\ny = 2\n@end example');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
  });

  it('round-trips heading + code block', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Top', marks: [] }] },
      { _type: 'code', code: 'one\ntwo', language: null },
    ]);
  });

  it('detects Texinfo input', () => {
    expect(format.detect('@chapter Top\n\n@b{bold} @uref{http://x}')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
