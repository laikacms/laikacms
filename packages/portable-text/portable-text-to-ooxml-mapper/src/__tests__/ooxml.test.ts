import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { ooxmlFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

const ENV = (body: string): string =>
  `<?xml version="1.0"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;

describe('ooxml format', () => {
  it('parses a plain paragraph', () => {
    const pt = format.toPortableText(
      ENV('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'),
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Hello world');
  });

  it('parses Heading1..Heading6 paragraph styles', () => {
    const pt = format.toPortableText(
      ENV(
        ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6']
          .map(
            s => `<w:p><w:pPr><w:pStyle w:val="${s}"/></w:pPr><w:r><w:t>${s}</w:t></w:r></w:p>`,
          )
          .join(''),
      ),
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });

  it('parses bold/italic/underline/strike/sup/sub run properties', () => {
    const pt = format.toPortableText(
      ENV(
        '<w:p>'
          + '<w:r><w:t xml:space="preserve">plain </w:t></w:r>'
          + '<w:r><w:rPr><w:b/></w:rPr><w:t>b</w:t></w:r>'
          + '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
          + '<w:r><w:rPr><w:i/></w:rPr><w:t>i</w:t></w:r>'
          + '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>u</w:t></w:r>'
          + '<w:r><w:rPr><w:strike/></w:rPr><w:t>s</w:t></w:r>'
          + '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>x</w:t></w:r>'
          + '<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>y</w:t></w:r>'
          + '</w:p>',
      ),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sub']);
  });

  it('parses ListBullet / ListNumber pStyles as list blocks', () => {
    const pt = format.toPortableText(
      ENV(
        '<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>'
          + '<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>b</w:t></w:r></w:p>',
      ),
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses Quote / IntenseQuote as blockquote', () => {
    const pt = format.toPortableText(
      ENV(
        '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>said</w:t></w:r></w:p>'
          + '<w:p><w:pPr><w:pStyle w:val="IntenseQuote"/></w:pPr><w:r><w:t>loudly</w:t></w:r></w:p>',
      ),
    );
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
    expect((pt[1] as { style?: string }).style).toBe('blockquote');
  });

  it('parses <w:hyperlink> as a markDefs link', () => {
    const pt = format.toPortableText(
      ENV(
        '<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>'
          + '<w:hyperlink r:id="rId7"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>',
      ),
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('ooxml://rel/rId7');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses <w:tab/> as a tab character and <w:br/> as a newline', () => {
    const pt = format.toPortableText(
      ENV('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>'),
    );
    const text = (pt[0] as { children: { text: string }[] }).children.map(c => c.text).join('');
    expect(text).toBe('a\tb\nc');
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

  it('detects WordprocessingML content', () => {
    expect(format.detect(ENV('<w:p><w:r><w:t>x</w:t></w:r></w:p>'))).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
