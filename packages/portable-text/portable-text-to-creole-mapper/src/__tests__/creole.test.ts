import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { creoleFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('wikicreole format', () => {
  it('round-trips heading + paragraph (single `=` = h1, more `=` = deeper)', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Top', marks: [] }] },
      { _type: 'block', style: 'h3', markDefs: [], children: [{ _type: 'span', text: 'Sub', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('parses **bold** / //italic// / {{{code}}}', () => {
    const pt = format.toPortableText('**b** //i// {{{c}}}');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses [[target|label]] links', () => {
    const pt = format.toPortableText('see [[https://example.com|here]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses * (bullet) and # (numbered) lists', () => {
    const pt = format.toPortableText('* one\n* two\n\n# first\n# second');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('round-trips a {{{ … }}} code block', () => {
    expectStable([{ _type: 'code', code: 'print(1)\nprint(2)', language: null }]);
  });

  it('converts `\\\\` to newlines inside a span', () => {
    const pt = format.toPortableText('line one\\\\line two');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans[0]?.text).toBe('line one\nline two');
  });

  it('detects WikiCreole markup', () => {
    expect(format.detect('= Top =\n\n**bold** //italic// [[a|b]]')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
