import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { notionFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('notion format', () => {
  it('parses heading_1/2/3 into PT h1/h2/h3', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        { object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: 'A' } }] } },
        { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'B' } }] } },
        { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: 'C' } }] } },
      ]),
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3']);
  });

  it('parses rich_text annotations into decorators', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: 'plain ' }, annotations: {} },
              { type: 'text', text: { content: 'b' }, annotations: { bold: true } },
              { type: 'text', text: { content: ' ' }, annotations: {} },
              { type: 'text', text: { content: 's' }, annotations: { strikethrough: true } },
            ],
          },
        },
      ]),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
  });

  it('parses text.link.url into a markDefs link', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: 'see ' } },
              { type: 'text', text: { content: 'here', link: { url: 'https://example.com' } } },
            ],
          },
        },
      ]),
    );
    const block = pt[0] as {
      markDefs: { href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses bulleted_list_item / numbered_list_item', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'a' } }] },
        },
        {
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: [{ type: 'text', text: { content: 'b' } }] },
        },
      ]),
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses code blocks with language', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          object: 'block',
          type: 'code',
          code: { rich_text: [{ type: 'text', text: { content: 'x = 1' } }], language: 'python' },
        },
      ]),
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('parses divider as hr and quote as blockquote', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        { object: 'block', type: 'divider' },
        { object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: 'said' } }] } },
      ]),
    );
    expect((pt[0] as { _type: string })._type).toBe('hr');
    expect((pt[1] as { style?: string }).style).toBe('blockquote');
  });

  it('accepts a `{ results: [...] }` API envelope', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        results: [
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'hi' } }] } },
        ],
      }),
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { style?: string }).style).toBe('normal');
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
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'a', marks: [] }],
      },
    ]);
  });

  it('detects Notion JSON', () => {
    expect(
      format.detect(
        JSON.stringify([
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'hi' } }] } },
        ]),
      ),
    ).toBe(1);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
    expect(format.detect('plain prose')).toBe(0);
  });
});
