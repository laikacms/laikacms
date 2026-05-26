import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { proseMirrorFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('prosemirror / tiptap JSON format', () => {
  it('round-trips heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('round-trips marks (bold / italic / strike / code / underline)', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'b', marks: ['strong'] },
          { _type: 'span', text: 'i', marks: ['em'] },
          { _type: 'span', text: 's', marks: ['strike-through'] },
          { _type: 'span', text: 'c', marks: ['code'] },
          { _type: 'span', text: 'u', marks: ['underline'] },
        ],
      },
    ]);
  });

  it('round-trips a link annotation', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'https://example.com' }],
        children: [{ _type: 'span', text: 'here', marks: ['m0'] }],
      },
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
        children: [{ _type: 'span', text: '1', marks: [] }],
      },
    ]);
  });

  it('round-trips a code block with language', () => {
    expectStable([{ _type: 'code', code: 'print(1)', language: 'python' }]);
  });

  it('serialises to ProseMirror-style JSON', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('doc');
    expect(parsed.content[0].type).toBe('heading');
    expect(parsed.content[0].attrs.level).toBe(1);
  });

  it('detects ProseMirror JSON', () => {
    expect(format.detect('{"type":"doc","content":[]}')).toBe(1);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
