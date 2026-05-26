import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { quillFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('quill delta format', () => {
  it('parses inline attribute marks into decorators', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        ops: [
          { insert: 'plain ' },
          { insert: 'bold', attributes: { bold: true } },
          { insert: ' ' },
          { insert: 'italic', attributes: { italic: true } },
          { insert: '\n' },
        ],
      }),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'italic')?.marks).toEqual(['em']);
  });

  it('parses header line attribute into h1..h6', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        ops: [
          { insert: 'Title' },
          { insert: '\n', attributes: { header: 2 } },
        ],
      }),
    );
    expect((pt[0] as { style?: string }).style).toBe('h2');
  });

  it('parses list / blockquote line attributes', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        ops: [
          { insert: 'one' },
          { insert: '\n', attributes: { list: 'bullet' } },
          { insert: 'two' },
          { insert: '\n', attributes: { list: 'ordered' } },
          { insert: 'said' },
          { insert: '\n', attributes: { blockquote: true } },
        ],
      }),
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('number');
    expect((pt[2] as { style?: string }).style).toBe('blockquote');
  });

  it('parses `code-block` line runs into a single code block', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        ops: [
          { insert: 'x = 1' },
          { insert: '\n', attributes: { 'code-block': true } },
          { insert: 'y = 2' },
          { insert: '\n', attributes: { 'code-block': true } },
        ],
      }),
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
  });

  it('parses inline link attribute as a link annotation', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        ops: [
          { insert: 'see ' },
          { insert: 'here', attributes: { link: 'https://example.com' } },
          { insert: '\n' },
        ],
      }),
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('round-trips a heading + paragraph through Delta', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('detects Quill Delta input', () => {
    expect(format.detect('{"ops":[{"insert":"hi\\n"}]}')).toBe(1);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
    expect(format.detect('plain prose')).toBe(0);
  });
});
