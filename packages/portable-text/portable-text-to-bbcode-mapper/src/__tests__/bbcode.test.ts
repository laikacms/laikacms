import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { bbcodeFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}

function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('bbcode format', () => {
  it('round-trips a plain paragraph', () => {
    expectStable([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'hello', marks: [] }] },
    ]);
  });

  it('round-trips a heading and blockquote', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'quote', marks: [] }] },
    ]);
  });

  it('round-trips a simple bullet list', () => {
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
  });

  it('parses bold/italic/underline tags into decorator marks', () => {
    const pt = format.toPortableText('[b]bold[/b] and [i]italic[/i]');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'italic')?.marks).toEqual(['em']);
  });

  it('parses [url=...] into a link annotation', () => {
    const pt = format.toPortableText('see [url=https://x.com]here[/url]');
    const block = pt[0] as {
      markDefs: { _type: string, href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs).toHaveLength(1);
    expect(block.markDefs[0]).toMatchObject({ _type: 'link', href: 'https://x.com' });
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('detects BBCode markup', () => {
    expect(format.detect('[b]hi[/b]')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('# markdown heading')).toBe(0);
  });

  it('serialises a heading to [h1] / [/h1]', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    expect(out).toBe('[h1]Hi[/h1]');
  });
});
