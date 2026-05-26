import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { whatsappFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('whatsapp format', () => {
  it('round-trips a plain paragraph', () => {
    expectStable([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'hi', marks: [] }] },
    ]);
  });

  it('parses *bold* / _italic_ / ~strike~ / ```mono```', () => {
    const pt = format.toPortableText('*b* _i_ ~s~ ```c```');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('round-trips bullet and numbered lists', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        listItem: 'bullet',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'a', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        listItem: 'bullet',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'b', marks: [] }],
      },
    ]);
  });

  it('round-trips a block quote', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'said', marks: [] }] },
    ]);
  });

  it('detects WhatsApp formatting', () => {
    expect(format.detect('*bold* and ```mono``` and ~strike~')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose without markers')).toBe(0);
  });

  it('emits headings as bold paragraphs (round-trip flattens)', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    expect(out).toBe('*Hi*');
  });

  it('keeps links as `label (url)` since WhatsApp has no link syntax', () => {
    const out = format.fromPortableText([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'https://example.com' }],
        children: [{ _type: 'span', text: 'here', marks: ['m0'] }],
      },
    ]);
    expect(out).toContain('here');
    expect(out).toContain('https://example.com');
  });
});
