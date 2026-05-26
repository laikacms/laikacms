import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { obsidianFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('obsidian markdown format', () => {
  it('round-trips a heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('round-trips a ==highlight== span', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'see ', marks: [] },
          { _type: 'span', text: 'this', marks: ['highlight'] },
        ],
      },
    ]);
  });

  it('parses [[Page|alias]] wikilinks into a link annotation', () => {
    const pt = format.toPortableText('see [[Home Page|home]] for more');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('obsidian://Home Page');
    expect(block.children.find(s => s.text === 'home')?.marks).toHaveLength(1);
  });

  it('parses [[Page]] (no alias) using the page name as the label', () => {
    const pt = format.toPortableText('[[Home]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('obsidian://Home');
    expect(block.children[0]?.text).toBe('Home');
  });

  it('parses normal [label](url) links', () => {
    const pt = format.toPortableText('[here](https://example.com)');
    const block = pt[0] as { markDefs: { href: string }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
  });

  it('round-trips code blocks with language', () => {
    expectStable([{ _type: 'code', code: 'print(1)', language: 'python' }]);
  });

  it('detects Obsidian-specific markup', () => {
    expect(format.detect('[[Home]] and ==highlight==')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });

  it('round-trips wikilinks end-to-end', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'obsidian://Home Page' }],
        children: [{ _type: 'span', text: 'home', marks: ['m0'] }],
      },
    ]);
  });
});
