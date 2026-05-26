import type { PortableTextDocument } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { portableTextFormat as format } from '../index';

const doc: PortableTextDocument = [
  { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
  { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
];

describe('portabletext format', () => {
  it('round-trips a document exactly', () => {
    expect(format.toPortableText(format.fromPortableText(doc))).toEqual(doc);
  });

  it('treats empty input as an empty document', () => {
    expect(format.toPortableText('')).toEqual([]);
  });

  it('detects Portable Text JSON and rejects other formats', () => {
    expect(format.detect(JSON.stringify(doc))).toBeGreaterThan(0.9);
    expect(format.detect('# a markdown heading')).toBe(0);
    expect(format.detect('<p>html</p>')).toBe(0);
  });
});
