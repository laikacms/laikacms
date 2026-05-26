import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { txt2tagsFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('txt2tags format', () => {
  it('parses balanced-equals headings', () => {
    const pt = format.toPortableText('= H1 =\n== H2 ==\n===== H5 =====');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h5']);
  });

  it('parses numbered `+ … +` headings', () => {
    const pt = format.toPortableText('+ N1 +\n++ N2 ++\n+++ N3 +++');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3']);
  });

  it('parses inline `**` / `//` / `__` / `--` / ``` `` ``` decorators', () => {
    const pt = format.toPortableText(
      'plain **bold** //em// __u__ --s-- ``c``',
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses `[label url]` and `[url]` link forms', () => {
    const pt1 = format.toPortableText('see [here https://example.com]');
    const b1 = pt1[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(b1.markDefs[0]?.href).toBe('https://example.com');
    expect(b1.children.find(c => c.text === 'here')?.marks).toHaveLength(1);

    const pt2 = format.toPortableText('and [https://example.com]');
    const b2 = pt2[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(b2.markDefs[0]?.href).toBe('https://example.com');
  });

  it('parses `- ` bullets and `+ ` numbered list items', () => {
    const pt = format.toPortableText('- a\n- b\n+ x\n+ y');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[3] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses ``` fenced code blocks', () => {
    const pt = format.toPortableText('```\nline 1\nline 2\n```');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('line 1\nline 2');
  });

  it('parses 20+ dashes / equals as a horizontal rule', () => {
    const pt = format.toPortableText('before\n--------------------\nafter');
    expect((pt[1] as { _type: string })._type).toBe('hr');
  });

  it('drops `%` line comments', () => {
    const pt = format.toPortableText('% a comment\n= Title =\nBody.');
    expect(pt).toHaveLength(2);
    expect((pt[0] as { style?: string }).style).toBe('h1');
  });

  it('round-trips a representative document', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ]);
  });

  it('detects txt2tags content', () => {
    expect(format.detect('+ Heading +\n\n**body**')).toBeGreaterThan(0.4);
    expect(format.detect('%!target: html\n\n= H =')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
