import { describe, expect, it } from 'vitest';

import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';

import { lexicalToPortableText } from '../bridge/lexicalToPortableText';
import { portableTextToLexical } from '../bridge/portableTextToLexical';

/** PT -> Lexical -> PT, with keys stripped for comparison. */
function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(lexicalToPortableText(portableTextToLexical(doc)));
}

function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('PT <-> Lexical round-trip', () => {
  it('preserves headings and paragraphs', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'h3', markDefs: [], children: [{ _type: 'span', text: 'Sub', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('preserves blockquotes', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'quote', marks: [] }] },
    ]);
  });

  it('preserves decorator marks', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
          { _type: 'span', text: ' and ', marks: [] },
          { _type: 'span', text: 'bold-italic-code', marks: ['strong', 'em', 'code'] },
        ],
      },
    ]);
  });

  it('preserves links as mark annotations', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'https://example.com' }],
        children: [
          { _type: 'span', text: 'see ', marks: [] },
          { _type: 'span', text: 'here', marks: ['m0'] },
        ],
      },
    ]);
  });

  it('preserves soft line breaks within a span', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', text: 'line one\nline two', marks: [] }],
      },
    ]);
  });

  it('preserves nested lists', () => {
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
        listItem: 'bullet',
        level: 2,
        markDefs: [],
        children: [{ _type: 'span', text: 'one-a', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        listItem: 'number',
        level: 1,
        markDefs: [],
        children: [{ _type: 'span', text: 'two', marks: [] }],
      },
    ]);
  });

  it('preserves code blocks', () => {
    expectStable([
      { _type: 'code', code: 'const x = 1;\nconsole.log(x);', language: 'js' },
    ]);
  });

  it('preserves custom blocks via their _type', () => {
    expectStable([
      { _type: 'image', src: '/photo.png', alt: 'A photo' },
    ]);
  });

  it('normalizes an empty document to a single empty paragraph', () => {
    expect(stripKeys(lexicalToPortableText(portableTextToLexical([])))).toEqual([
      { _type: 'block', style: 'normal', markDefs: [], children: [] },
    ]);
  });
});
