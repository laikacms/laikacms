import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { hamlFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('haml format', () => {
  it('parses %h1..%h6 / %p / %blockquote into block styles', () => {
    const pt = format.toPortableText(['%h1 A', '%h3 B', '%p body', '%blockquote q'].join('\n'));
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h3', 'normal', 'blockquote']);
  });

  it('parses indented inline child tags as marks', () => {
    const pt = format.toPortableText(
      ['%p', '  plain', '  %strong bold', '  more'].join('\n'),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'plain')?.marks).toEqual([]);
  });

  it('parses %a{ href: "…" } into a link markDef', () => {
    const pt = format.toPortableText(
      ['%p', '  see', '  %a{ href: "https://example.com" } here'].join('\n'),
    );
    const block = pt[0] as {
      markDefs: { href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses %ul of %li into PT bullet items', () => {
    const pt = format.toPortableText(['%ul', '  %li one', '  %li two'].join('\n'));
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses %ol of %li into numbered list items', () => {
    const pt = format.toPortableText(['%ol', '  %li a', '  %li b'].join('\n'));
    expect((pt[0] as { listItem?: string }).listItem).toBe('number');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses %pre/%code subtree as a code block', () => {
    const pt = format.toPortableText(['%pre', '  %code', '    line 1', '    line 2'].join('\n'));
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('line 1\nline 2');
  });

  it('parses %hr as an hr block', () => {
    const pt = format.toPortableText(['%p before', '%hr', '%p after'].join('\n'));
    const types = pt.map(b => (b as { _type: string })._type);
    expect(types).toEqual(['block', 'hr', 'block']);
  });

  it('round-trips a representative document', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ]);
  });

  it('detects HAML content', () => {
    expect(format.detect(['%h1 Title', '%p Body'].join('\n'))).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
