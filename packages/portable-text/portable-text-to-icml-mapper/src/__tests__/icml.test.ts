import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { icmlFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

const ENV = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<?aid style="50" type="snippet" ?>\n<Document>${body}</Document>`;

describe('icml format', () => {
  it('parses a basic ParagraphStyleRange + CharacterStyleRange + Content', () => {
    const pt = format.toPortableText(
      ENV(
        '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">'
          + '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">'
          + '<Content>Hello world</Content>'
          + '</CharacterStyleRange>'
          + '</ParagraphStyleRange>',
      ),
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Hello world');
    expect((pt[0] as { style?: string }).style).toBe('normal');
  });

  it('maps Heading 1..6 paragraph styles to h1..h6', () => {
    const psrs = [1, 2, 3, 4, 5, 6]
      .map(
        n =>
          `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Heading ${n}">`
          + `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">`
          + `<Content>H${n}</Content>`
          + `</CharacterStyleRange>`
          + `</ParagraphStyleRange>`,
      )
      .join('');
    const pt = format.toPortableText(ENV(psrs));
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });

  it('maps BulletList / NumberedList / Quote to list / blockquote', () => {
    const pt = format.toPortableText(
      ENV(
        '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/BulletList">'
          + '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>a</Content></CharacterStyleRange>'
          + '</ParagraphStyleRange>'
          + '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/NumberedList">'
          + '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>b</Content></CharacterStyleRange>'
          + '</ParagraphStyleRange>'
          + '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Quote">'
          + '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>q</Content></CharacterStyleRange>'
          + '</ParagraphStyleRange>',
      ),
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
    expect((pt[2] as { style?: string }).style).toBe('blockquote');
  });

  it('maps Bold / Italic / Bold Italic / Underline / Strikethrough character styles', () => {
    const csr = (name: string, text: string): string =>
      `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/${name}"><Content>${text}</Content></CharacterStyleRange>`;
    const pt = format.toPortableText(
      ENV(
        '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">'
          + csr('$ID/[No character style]', 'plain ')
          + csr('Bold', 'b')
          + csr('Italic', 'i')
          + csr('Bold Italic', 'bi')
          + csr('Underline', 'u')
          + csr('Strikethrough', 's')
          + csr('Superscript', 'x')
          + csr('Subscript', 'y')
          + '</ParagraphStyleRange>',
      ),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'bi')?.marks.sort()).toEqual(['em', 'strong']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sub']);
  });

  it('parses <HyperlinkTextSource> as a markDefs link', () => {
    const pt = format.toPortableText(
      ENV(
        '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">'
          + '<HyperlinkTextSource AppliedHyperlink="https://example.com">'
          + '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>here</Content></CharacterStyleRange>'
          + '</HyperlinkTextSource>'
          + '</ParagraphStyleRange>',
      ),
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('decodes XML entities in <Content>', () => {
    const pt = format.toPortableText(
      ENV(
        '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">'
          + '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">'
          + '<Content>a &amp; b &lt; c</Content>'
          + '</CharacterStyleRange>'
          + '</ParagraphStyleRange>',
      ),
    );
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('a & b < c');
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

  it('detects ICML content', () => {
    expect(
      format.detect(
        ENV(
          '<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Heading 1"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Bold"><Content>x</Content></CharacterStyleRange></ParagraphStyleRange>',
        ),
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
