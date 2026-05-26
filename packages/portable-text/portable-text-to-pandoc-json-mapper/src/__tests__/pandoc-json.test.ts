import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { pandocJsonFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('pandoc-json format', () => {
  it('parses Header(level, attr, inlines) into h1..h6', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [1, 3, 6].map(level => ({
        t: 'Header',
        c: [level, ['', [], []], [{ t: 'Str', c: `H${level}` }]],
      })),
    });
    const pt = format.toPortableText(doc);
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h3', 'h6']);
  });

  it('parses Para with Str / Space / Emph / Strong / Underline / Strikeout', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Para',
          c: [
            { t: 'Str', c: 'plain' },
            { t: 'Space' },
            { t: 'Strong', c: [{ t: 'Str', c: 'bold' }] },
            { t: 'Space' },
            { t: 'Emph', c: [{ t: 'Str', c: 'em' }] },
            { t: 'Space' },
            { t: 'Underline', c: [{ t: 'Str', c: 'u' }] },
            { t: 'Space' },
            { t: 'Strikeout', c: [{ t: 'Str', c: 's' }] },
          ],
        },
      ],
    });
    const pt = format.toPortableText(doc);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
  });

  it('parses Code(attr, text) inline as a code decorator', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Code', c: [['', [], []], 'foo()'] }] }],
    });
    const pt = format.toPortableText(doc);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans[0]?.text).toBe('foo()');
    expect(spans[0]?.marks).toEqual(['code']);
  });

  it('parses Link(attr, inlines, [url, title]) as a markDefs link', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Para',
          c: [
            { t: 'Str', c: 'see' },
            { t: 'Space' },
            {
              t: 'Link',
              c: [
                ['', [], []],
                [{ t: 'Str', c: 'here' }],
                ['https://example.com', ''],
              ],
            },
          ],
        },
      ],
    });
    const pt = format.toPortableText(doc);
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses BulletList and OrderedList of Para items', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'BulletList', c: [[{ t: 'Para', c: [{ t: 'Str', c: 'a' }] }]] },
        {
          t: 'OrderedList',
          c: [[1, { t: 'Decimal' }, { t: 'Period' }], [[{ t: 'Para', c: [{ t: 'Str', c: 'x' }] }]]],
        },
      ],
    });
    const pt = format.toPortableText(doc);
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses CodeBlock with language from attr classes', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'CodeBlock', c: [['', ['python'], []], 'print(1)\nprint(2)'] }],
    });
    const pt = format.toPortableText(doc);
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('parses BlockQuote(Para) as blockquote and HorizontalRule as hr', () => {
    const doc = JSON.stringify({
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'BlockQuote', c: [{ t: 'Para', c: [{ t: 'Str', c: 'said' }] }] },
        { t: 'HorizontalRule' },
      ],
    });
    const pt = format.toPortableText(doc);
    expect((pt[0] as { style?: string }).style).toBe('blockquote');
    expect((pt[1] as { _type: string })._type).toBe('hr');
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

  it('detects Pandoc JSON', () => {
    expect(
      format.detect(
        JSON.stringify({
          'pandoc-api-version': [1, 23],
          meta: {},
          blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'x' }] }],
        }),
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
