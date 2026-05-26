import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { slateFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('slate format', () => {
  it('parses paragraph + heading element types', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        { type: 'heading-two', children: [{ text: 'Title' }] },
        { type: 'paragraph', children: [{ text: 'Body' }] },
      ]),
    );
    expect((pt[0] as { style?: string }).style).toBe('h2');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('parses leaf mark booleans into decorators', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          type: 'paragraph',
          children: [
            { text: 'plain ' },
            { text: 'b', bold: true },
            { text: ' ' },
            { text: 'i', italic: true },
            { text: ' ' },
            { text: 's', strikethrough: true },
          ],
        },
      ]),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
  });

  it('parses link inline elements into markDefs', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          type: 'paragraph',
          children: [
            { text: 'see ' },
            { type: 'link', url: 'https://example.com', children: [{ text: 'here' }] },
          ],
        },
      ]),
    );
    const block = pt[0] as {
      markDefs: { _type: string, href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    const linked = block.children.find(c => c.text === 'here');
    expect(linked?.marks).toHaveLength(1);
  });

  it('parses bulleted-list of list-items into PT list blocks', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          type: 'bulleted-list',
          children: [
            { type: 'list-item', children: [{ text: 'a' }] },
            { type: 'list-item', children: [{ text: 'b' }] },
          ],
        },
      ]),
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses code-block of code-lines into one code block', () => {
    const pt = format.toPortableText(
      JSON.stringify([
        {
          type: 'code-block',
          language: 'ts',
          children: [
            { type: 'code-line', children: [{ text: 'x = 1' }] },
            { type: 'code-line', children: [{ text: 'y = 2' }] },
          ],
        },
      ]),
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
    expect((pt[0] as { language?: string }).language).toBe('ts');
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

  it('detects Slate JSON', () => {
    expect(
      format.detect(
        JSON.stringify([{ type: 'paragraph', children: [{ text: 'hi' }] }]),
      ),
    ).toBe(1);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
    expect(format.detect('plain prose')).toBe(0);
  });
});
