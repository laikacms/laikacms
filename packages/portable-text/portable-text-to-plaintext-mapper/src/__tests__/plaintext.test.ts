import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { plainTextFormat as format } from '../index';

describe('plaintext format', () => {
  it('splits on blank lines into paragraphs', () => {
    const pt = format.toPortableText('one\n\ntwo\n\nthree');
    expect(pt).toHaveLength(3);
    expect((pt[0] as any).children[0].text).toBe('one');
    expect((pt[2] as any).children[0].text).toBe('three');
  });

  it('round-trips paragraphs', () => {
    const text = 'one\n\ntwo\n\nthree';
    expect(format.fromPortableText(format.toPortableText(text))).toBe(text);
  });

  it('drops marks and unknown blocks on output', () => {
    const doc: PortableTextDocument = [
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'bold ', marks: ['strong'] },
          { _type: 'span', text: 'plain', marks: [] },
        ],
      },
      { _type: 'image', src: '/x.png' },
    ];
    expect(format.fromPortableText(doc)).toBe('bold plain');
  });

  it('treats empty input as an empty document', () => {
    expect(format.toPortableText('')).toEqual([]);
  });

  it('scores low but non-zero on featureless input', () => {
    const score = format.detect('just words here');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.4);
  });

  it('matches the stripKeys-stable shape on a single paragraph round-trip', () => {
    const text = 'hello world';
    const pt = format.toPortableText(text);
    expect(stripKeys(pt)).toEqual([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', text: 'hello world', marks: [] }],
      },
    ]);
  });
});
