// @vitest-environment happy-dom
import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { htmlFormat as format } from '../index';

function expectStable(doc: PortableTextDocument): void {
  const html = format.fromPortableText(doc);
  expect(stripKeys(format.toPortableText(html))).toEqual(stripKeys(doc));
}

describe('html format', () => {
  it('round-trips headings, paragraphs and marks', () => {
    expectStable([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'a ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
          { _type: 'span', text: ' and ', marks: [] },
          { _type: 'span', text: 'emphasis', marks: ['em'] },
        ],
      },
    ]);
  });

  it('round-trips links', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'https://example.com' }],
        children: [
          { _type: 'span', text: 'go ', marks: [] },
          { _type: 'span', text: 'there', marks: ['m0'] },
        ],
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
        listItem: 'bullet',
        level: 2,
        markDefs: [],
        children: [{ _type: 'span', text: 'nested', marks: [] }],
      },
    ]);
  });

  it('round-trips code blocks', () => {
    expectStable([{ _type: 'code', code: 'const x = 1;', language: 'js' }]);
  });

  it('detects HTML and rejects other formats', () => {
    expect(format.detect('<p>hello</p>')).toBeGreaterThan(0.5);
    expect(format.detect('# markdown')).toBe(0);
  });
});
