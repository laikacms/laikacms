import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { fb2Format as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('fb2 format', () => {
  it('parses `<section><title><p>…</p></title>` as a heading', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><title><p>Chapter One</p></title></section></body></FictionBook>`,
    );
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Chapter One');
  });

  it('uses nested `<section>` depth for heading level', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><title><p>Top</p></title><section><title><p>Nested</p></title></section></section></body></FictionBook>`,
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2']);
  });

  it('parses inline `<emphasis>` / `<strong>` / `<strikethrough>` / `<sub>` / `<sup>`', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><p>plain <strong>bold</strong> <emphasis>em</emphasis> <strikethrough>s</strikethrough> <sup>x</sup> <sub>y</sub></p></section></body></FictionBook>`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sub']);
  });

  it('parses `<a l:href="…">` into a markDefs link', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><p>see <a l:href="https://example.com">here</a></p></section></body></FictionBook>`,
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses `<empty-line/>` as an `hr` block', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><p>before</p><empty-line/><p>after</p></section></body></FictionBook>`,
    );
    expect(pt.map(b => (b as { _type: string })._type)).toEqual(['block', 'hr', 'block']);
  });

  it('parses `<cite><p>` as a blockquote', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><cite><p>said the fox</p></cite></section></body></FictionBook>`,
    );
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
  });

  it('parses `<code>…</code>` block as a code block', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><code>line 1\nline 2</code></section></body></FictionBook>`,
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('line 1\nline 2');
  });

  it('decodes XML entities in text', () => {
    const pt = format.toPortableText(
      `<FictionBook><body><section><p>a &amp; b &lt; c</p></section></body></FictionBook>`,
    );
    const spans = (pt[0] as { children: { text: string }[] }).children;
    expect(spans.map(s => s.text).join('')).toBe('a & b < c');
  });

  it('round-trips a representative document', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
      {
        _type: 'block',
        style: 'blockquote',
        markDefs: [],
        children: [{ _type: 'span', text: 'said', marks: [] }],
      },
    ]);
  });

  it('detects FB2 content', () => {
    expect(
      format.detect(
        `<?xml version="1.0"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink"><body><section><p>x</p></section></body></FictionBook>`,
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
