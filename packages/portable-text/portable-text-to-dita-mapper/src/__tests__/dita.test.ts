import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { ditaFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('dita format', () => {
  it('parses <topic><title> as an h1 heading', () => {
    const pt = format.toPortableText(
      `<topic id="t"><title>Topic Title</title><body><p>Body</p></body></topic>`,
    );
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('uses nested <section> depth for nested heading levels', () => {
    const pt = format.toPortableText(
      `<topic><title>Top</title><body><section><title>Inner</title></section></body></topic>`,
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2']);
  });

  it('parses <b>/<i>/<u>/<sub>/<sup>/<codeph> inline decorators', () => {
    const pt = format.toPortableText(
      `<topic><body><p>plain <b>bold</b> <i>em</i> <u>u</u> <sub>x</sub> <sup>y</sup> <codeph>c</codeph></p></body></topic>`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses <xref href="…"> as a markDefs link', () => {
    const pt = format.toPortableText(
      `<topic><body><p>see <xref href="https://example.com">here</xref></p></body></topic>`,
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses <ul> / <ol> of <li> as PT list blocks', () => {
    const pt = format.toPortableText(
      `<topic><body><ul><li>a</li><li>b</li></ul><ol><li>x</li></ol></body></topic>`,
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses <codeblock outputclass="lang"> as a code block', () => {
    const pt = format.toPortableText(
      `<topic><body><codeblock outputclass="python">x = 1\ny = 2</codeblock></body></topic>`,
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('parses <note type="warning"><p>…</p></note> as a dita:note', () => {
    const pt = format.toPortableText(
      `<topic><body><note type="warning"><p>Careful!</p></note></body></topic>`,
    );
    expect((pt[0] as { _type: string })._type).toBe('dita:note');
    expect((pt[0] as { noteType: string }).noteType).toBe('warning');
  });

  it('round-trips a representative topic', () => {
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
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ]);
  });

  it('detects DITA content', () => {
    expect(
      format.detect(
        `<?xml version="1.0"?><topic id="t"><title>X</title><body><codeblock>c</codeblock></body></topic>`,
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
