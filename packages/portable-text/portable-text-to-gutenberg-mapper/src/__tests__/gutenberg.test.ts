import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { gutenbergFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('gutenberg format', () => {
  it('parses a wp:paragraph block', () => {
    const pt = format.toPortableText('<!-- wp:paragraph --><p>Hello world</p><!-- /wp:paragraph -->');
    expect(pt).toHaveLength(1);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Hello world');
  });

  it('parses wp:heading with {"level":N} into h1..h6', () => {
    const src = [1, 2, 3, 6]
      .map(n => `<!-- wp:heading {"level":${n}} --><h${n}>H${n}</h${n}><!-- /wp:heading -->`)
      .join('\n');
    const pt = format.toPortableText(src);
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3', 'h6']);
  });

  it('parses inline HTML decorators inside a paragraph', () => {
    const pt = format.toPortableText(
      '<!-- wp:paragraph --><p>plain <strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p><!-- /wp:paragraph -->',
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses wp:list bullet / wp:list {"ordered":true} into PT list blocks', () => {
    const pt = format.toPortableText(
      '<!-- wp:list --><ul><li>a</li><li>b</li></ul><!-- /wp:list -->\n<!-- wp:list {"ordered":true} --><ol><li>x</li></ol><!-- /wp:list -->',
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses wp:code and wp:quote and wp:separator', () => {
    const pt = format.toPortableText(
      '<!-- wp:code --><pre class="wp-block-code"><code>x = 1\ny = 2</code></pre><!-- /wp:code -->\n<!-- wp:quote --><blockquote class="wp-block-quote"><p>said</p></blockquote><!-- /wp:quote -->\n<!-- wp:separator --><hr class="wp-block-separator"/><!-- /wp:separator -->',
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
    expect((pt[1] as { style?: string }).style).toBe('blockquote');
    expect((pt[2] as { _type: string })._type).toBe('hr');
  });

  it('parses <a href="…"> as a markDefs link', () => {
    const pt = format.toPortableText(
      '<!-- wp:paragraph --><p>see <a href="https://example.com">here</a></p><!-- /wp:paragraph -->',
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('preserves unknown wp:* blocks as gutenberg:raw', () => {
    const pt = format.toPortableText(
      '<!-- wp:my-plugin/widget {"foo":"bar"} --><div class="widget">payload</div><!-- /wp:my-plugin/widget -->',
    );
    expect((pt[0] as { _type: string })._type).toBe('gutenberg:raw');
    expect((pt[0] as { blockType?: string }).blockType).toBe('my-plugin/widget');
    expect((pt[0] as { attrs?: Record<string, unknown> }).attrs?.foo).toBe('bar');
  });

  it('round-trips a representative document', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
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

  it('detects Gutenberg content', () => {
    expect(
      format.detect('<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->'),
    ).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
