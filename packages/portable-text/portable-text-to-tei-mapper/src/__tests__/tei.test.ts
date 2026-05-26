import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { teiFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('tei format', () => {
  it('parses <div><head> as a heading at the right depth', () => {
    const pt = format.toPortableText(
      `<TEI><text><body><div><head>Chapter</head><div><head>Section</head></div></div></body></text></TEI>`,
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2']);
  });

  it('parses <hi rend="bold|italic|underline|strikethrough|sub|sup">', () => {
    const pt = format.toPortableText(
      `<TEI><text><body><p>plain <hi rend="bold">b</hi> <hi rend="italic">i</hi> <hi rend="underline">u</hi> <hi rend="strikethrough">s</hi> <hi rend="sub">x</hi> <hi rend="sup">y</hi></p></body></text></TEI>`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sup']);
  });

  it('parses <ref target="…"> as a markDefs link', () => {
    const pt = format.toPortableText(
      `<TEI><text><body><p>see <ref target="https://example.com">here</ref></p></body></text></TEI>`,
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses <list type="ordered"> and bare <list> of <item>', () => {
    const pt = format.toPortableText(
      `<TEI><text><body><list><item>a</item><item>b</item></list><list type="ordered"><item>x</item></list></body></text></TEI>`,
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses <code> block as a code block', () => {
    const pt = format.toPortableText(
      `<TEI><text><body><code>line 1\nline 2</code></body></text></TEI>`,
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('line 1\nline 2');
  });

  it('parses <quote><p>…</p></quote> as a blockquote', () => {
    const pt = format.toPortableText(
      `<TEI><text><body><quote><p>said</p></quote></body></text></TEI>`,
    );
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
  });

  it('drops the <teiHeader>', () => {
    const pt = format.toPortableText(
      `<TEI><teiHeader><fileDesc/></teiHeader><text><body><p>body</p></body></text></TEI>`,
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { style?: string }).style).toBe('normal');
  });

  it('round-trips a representative document', () => {
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

  it('detects TEI content', () => {
    expect(
      format.detect(
        `<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader/><text><body><p>x</p></body></text></TEI>`,
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
