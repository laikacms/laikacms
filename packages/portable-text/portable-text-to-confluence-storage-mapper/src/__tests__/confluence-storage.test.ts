import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { confluenceStorageFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('confluence-storage format', () => {
  it('parses <h1>..<h6>, <p>, <blockquote>', () => {
    const pt = format.toPortableText('<h1>A</h1><h3>B</h3><p>p</p><blockquote>q</blockquote>');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h3', 'normal', 'blockquote']);
  });

  it('parses HTML inline decorators', () => {
    const pt = format.toPortableText(
      '<p>plain <strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <sub>x</sub> <sup>y</sup> <code>c</code></p>',
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

  it('parses <a href="…"> as a link', () => {
    const pt = format.toPortableText('<p>see <a href="https://example.com">here</a></p>');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses <ac:link><ri:page><ac:plain-text-link-body> as a confluence:// link', () => {
    const pt = format.toPortableText(
      '<p>see <ac:link><ri:page ri:space-key="DOCS" ri:content-title="Other Page"/><ac:plain-text-link-body><![CDATA[the page]]></ac:plain-text-link-body></ac:link></p>',
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('confluence://page/DOCS/Other Page');
    expect(block.children.find(c => c.text === 'the page')?.marks).toHaveLength(1);
  });

  it('parses the `code` macro with a `language` parameter into a code block', () => {
    const pt = format.toPortableText(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">python</ac:parameter><ac:plain-text-body><![CDATA[print(1)\nprint(2)]]></ac:plain-text-body></ac:structured-macro>',
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { language?: string }).language).toBe('python');
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
  });

  it('parses the `info` / `note` / `tip` / `warning` panel macros as confluence:macro blocks', () => {
    const pt = format.toPortableText(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>An info panel</p></ac:rich-text-body></ac:structured-macro><ac:structured-macro ac:name="warning"><ac:rich-text-body><p>Watch out</p></ac:rich-text-body></ac:structured-macro>',
    );
    expect((pt[0] as { _type: string })._type).toBe('confluence:macro');
    expect((pt[0] as { macroName: string }).macroName).toBe('info');
    expect((pt[1] as { macroName: string }).macroName).toBe('warning');
  });

  it('parses <ul> and <ol> of <li> as list blocks', () => {
    const pt = format.toPortableText('<ul><li>a</li><li>b</li></ul><ol><li>x</li></ol>');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
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
        _type: 'confluence:macro',
        macroName: 'info',
        markDefs: [],
        children: [{ _type: 'span', text: 'An info panel', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ] as unknown as PortableTextDocument);
  });

  it('detects Confluence Storage content', () => {
    expect(
      format.detect(
        '<h1>Title</h1><p>x</p><ac:structured-macro ac:name="info"><ac:rich-text-body><p>y</p></ac:rich-text-body></ac:structured-macro>',
      ),
    ).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
