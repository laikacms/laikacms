import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { editorJsFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('editor.js format', () => {
  it('round-trips heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('round-trips a quote and a code block', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
      { _type: 'code', code: 'console.log(1)', language: null },
    ]);
  });

  it('round-trips a bullet and a numbered list', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        listItem: 'bullet',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'a', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        listItem: 'bullet',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'b', marks: [] }],
      },
    ]);
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        listItem: 'number',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'x', marks: [] }],
      },
    ]);
  });

  it('parses inline <b>/<i>/<code>/<u> as decorators', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [{
          type: 'paragraph',
          data: { text: 'plain <b>bold</b> <i>italic</i> <code>code</code> <u>under</u>' },
        }],
      }),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'italic')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'code')?.marks).toEqual(['code']);
    expect(spans.find(s => s.text === 'under')?.marks).toEqual(['underline']);
  });

  it('parses <a href="…"> inline as a link annotation', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [{ type: 'paragraph', data: { text: 'see <a href="https://example.com">here</a>' } }],
      }),
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('serialises to an Editor.js `{ blocks: [...] }` JSON envelope', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    const parsed = JSON.parse(out) as { blocks: Array<{ type: string, data: { level?: number } }> };
    expect(parsed.blocks[0]?.type).toBe('header');
    expect(parsed.blocks[0]?.data.level).toBe(1);
  });

  it('detects Editor.js input', () => {
    expect(format.detect('{"blocks":[{"type":"paragraph","data":{"text":"hi"}}]}')).toBe(1);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
    expect(format.detect('plain prose')).toBe(0);
  });
});
