import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { tiddlyWikiFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('tiddlywiki5 format', () => {
  it('round-trips headings (! = h1, !!!!!! = h6)', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Top', marks: [] }] },
      { _type: 'block', style: 'h6', markDefs: [], children: [{ _type: 'span', text: 'Tiny', marks: [] }] },
    ]);
  });

  it("parses ''bold'' / //italic// / __underline__ / ~~strike~~ / ``code``", () => {
    const pt = format.toPortableText("''b'' //i// __u__ ~~s~~ ``c``");
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses [[label|url]] links (label first — TiddlyWiki convention)', () => {
    const pt = format.toPortableText('see [[here|https://example.com]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses *  and # list items', () => {
    const pt = format.toPortableText('* one\n* two\n\n# first\n# second');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('round-trips a <<<…<<< block quote', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
    ]);
  });

  it('round-trips triple-backtick code blocks', () => {
    expectStable([{ _type: 'code', code: 'print(1)', language: 'python' }]);
  });

  it('detects TiddlyWiki markup', () => {
    expect(format.detect("! Top\n\n''bold'' //italic// [[a|b]]")).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
