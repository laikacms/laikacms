import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { slackFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('slack mrkdwn format', () => {
  it('round-trips a plain paragraph', () => {
    expectStable([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'hello', marks: [] }] },
    ]);
  });

  it('parses *bold* / _italic_ / ~strike~ / `code`', () => {
    const pt = format.toPortableText('*b* _i_ ~s~ `c`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses <url|label> links', () => {
    const pt = format.toPortableText('see <https://example.com|here>');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses bullet (•) and numbered (1.) lists', () => {
    const pt = format.toPortableText('• one\n• two\n\n1. first\n2. second');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('round-trips a block quote', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
    ]);
  });

  it('round-trips a code block', () => {
    expectStable([{ _type: 'code', code: 'a\nb', language: null }]);
  });

  it('detects Slack-style markup', () => {
    expect(format.detect('*bold* and <https://x|y>')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose without markup')).toBe(0);
  });
});
