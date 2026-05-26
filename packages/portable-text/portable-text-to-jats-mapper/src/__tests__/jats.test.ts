import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { jatsFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('jats format', () => {
  it('parses <article-title> as an h1 heading', () => {
    const pt = format.toPortableText(
      `<article><front><article-meta><title-group><article-title>The Paper</article-title></title-group></article-meta></front></article>`,
    );
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('The Paper');
  });

  it('uses nested <sec> depth for heading level', () => {
    const pt = format.toPortableText(
      `<article><body><sec><title>Top</title><sec><title>Nested</title></sec></sec></body></article>`,
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h2', 'h3']);
  });

  it('parses <bold>/<italic>/<underline>/<strike>/<sub>/<sup>/<monospace> decorators', () => {
    const pt = format.toPortableText(
      `<article><body><p>plain <bold>b</bold> <italic>i</italic> <underline>u</underline> <strike>s</strike> <sub>x</sub> <sup>y</sup> <monospace>c</monospace></p></body></article>`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses <ext-link xlink:href="…"> as a markDefs link', () => {
    const pt = format.toPortableText(
      `<article><body><p>see <ext-link xlink:href="https://example.com">here</ext-link></p></body></article>`,
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses <list list-type="bullet|order"> of <list-item>', () => {
    const pt = format.toPortableText(
      `<article><body><list list-type="bullet"><list-item><p>a</p></list-item></list><list list-type="order"><list-item><p>x</p></list-item></list></body></article>`,
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses <code> block as a code block', () => {
    const pt = format.toPortableText(
      `<article><body><code>x = 1\ny = 2</code></body></article>`,
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
  });

  it('parses <disp-quote><p>…</p></disp-quote> as a blockquote', () => {
    const pt = format.toPortableText(
      `<article><body><disp-quote><p>said the fox</p></disp-quote></body></article>`,
    );
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
  });

  it('round-trips a representative article body', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Section', marks: [] }] },
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
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ]);
  });

  it('detects JATS content', () => {
    expect(
      format.detect(
        `<?xml version="1.0"?><article xmlns:xlink="http://www.w3.org/1999/xlink"><body><sec><title>X</title><p>y</p></sec></body></article>`,
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
