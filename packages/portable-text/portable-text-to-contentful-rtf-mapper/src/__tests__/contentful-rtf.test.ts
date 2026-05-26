import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { contentfulRtfFormat as format, contentfulToPortableText, portableTextToContentful } from '../index';

function expectStable(doc: PortableTextDocument): void {
  expect(stripKeys(contentfulToPortableText(portableTextToContentful(doc)))).toEqual(stripKeys(doc));
}

describe('contentful-rtf format', () => {
  it('round-trips headings and paragraphs with marks', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Head', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'x ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
    ]);
  });

  it('round-trips blockquotes', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'quote', marks: [] }] },
    ]);
  });

  it('round-trips links', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'https://example.com' }],
        children: [{ _type: 'span', text: 'here', marks: ['m0'] }],
      },
    ]);
  });

  it('round-trips nested lists', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        listItem: 'bullet',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        listItem: 'number',
        level: 2,
        markDefs: [],
        children: [{ _type: 'span', text: 'nested', marks: [] }],
      },
    ]);
  });

  it('produces a Contentful document and detects it', () => {
    const json = format.fromPortableText([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'hi', marks: [] }] },
    ]);
    expect(JSON.parse(json).nodeType).toBe('document');
    expect(format.detect(json)).toBe(1);
    expect(format.detect('# markdown')).toBe(0);
  });
});
