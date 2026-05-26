import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { telegramFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('telegram MarkdownV2 format', () => {
  it('round-trips a plain paragraph', () => {
    expectStable([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'hello', marks: [] }] },
    ]);
  });

  it('parses *bold* / _italic_ / __underline__ / ~strike~ / `code`', () => {
    const pt = format.toPortableText('*b* _i_ __u__ ~s~ `c`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses ||spoiler|| as a `spoiler` decorator', () => {
    const pt = format.toPortableText('||hidden||');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans[0]?.marks).toEqual(['spoiler']);
    expect(spans[0]?.text).toBe('hidden');
  });

  it('round-trips a spoiler span', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', text: 'hidden', marks: ['spoiler'] }],
      },
    ]);
  });

  it('parses [label](url) links', () => {
    const pt = format.toPortableText('see [here](https://example.com)');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('round-trips a code block', () => {
    expectStable([{ _type: 'code', code: 'a\nb', language: null }]);
  });

  it('escapes/unescapes special chars on round-trip', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', text: 'has * literal _ chars [too]', marks: [] }],
      },
    ]);
  });

  it('detects Telegram MarkdownV2 input', () => {
    expect(format.detect('||spoiler|| with __underline__')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
