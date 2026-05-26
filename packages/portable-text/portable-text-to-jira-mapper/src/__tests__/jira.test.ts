import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { jiraFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('jira / confluence wiki format', () => {
  it('round-trips heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('round-trips a block quote and a code block (with language)', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
      { _type: 'code', code: 'print(1)', language: 'python' },
    ]);
  });

  it('parses *bold* / _italic_ / -strike- / {{mono}}', () => {
    const pt = format.toPortableText('*b* _i_ -s- {{c}}');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses ~sub~ and ^sup^', () => {
    const pt = format.toPortableText('H~2~O E=mc^2^');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === '2')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === '2')?.marks).toEqual(['sub']);
  });

  it('parses [label|url] into a link annotation', () => {
    const pt = format.toPortableText('see [here|https://example.com]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses * bullets and # numbered items', () => {
    const pt = format.toPortableText('* one\n* two\n\n# first\n# second');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses {code:lang}…{code} into a code block', () => {
    const pt = format.toPortableText('{code:js}\nconsole.log(1)\n{code}');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('console.log(1)');
    expect((pt[0] as { language?: string }).language).toBe('js');
  });

  it('detects JIRA wiki markup', () => {
    expect(format.detect('h1. Title\n\n{code}\nx\n{code}\n\n[a|http://x]')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
