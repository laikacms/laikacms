import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { discordFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('discord markdown format', () => {
  it('round-trips heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('parses **bold** / *italic* / __underline__ / ~~strike~~ / `code`', () => {
    const pt = format.toPortableText('**b** *i* __u__ ~~s~~ `c`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses [label](url) into a link', () => {
    const pt = format.toPortableText('see [here](https://example.com)');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('round-trips a code block with language', () => {
    expectStable([{ _type: 'code', code: 'print(1)', language: 'python' }]);
  });

  it('round-trips a block quote', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
    ]);
  });

  it('parses bullet and numbered lists', () => {
    const pt = format.toPortableText('- a\n- b\n\n1. one\n2. two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('collapses h4..h6 to h3', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h5', markDefs: [], children: [{ _type: 'span', text: 'Deep', marks: [] }] },
    ]);
    expect(out).toBe('### Deep');
  });

  it('detects Discord markup', () => {
    expect(format.detect('# Title\n\n**bold** [link](http://x)')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
