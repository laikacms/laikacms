import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { zimFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('zim format', () => {
  it('parses inverse-equals heading levels (6 = → h1, 2 = → h5)', () => {
    const pt = format.toPortableText(
      '====== H1 ======\n===== H2 =====\n==== H3 ====\n=== H4 ===\n== H5 ==',
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
  });

  it("parses inline `**` / `//` / `__` / `~~` / `''` decorators", () => {
    const pt = format.toPortableText("plain **b** //i// __u__ ~~s~~ ''c''");
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses `_{sub}` and `^{sup}` decorators', () => {
    const pt = format.toPortableText('H_{2}O E=mc^{2}');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === '2' && s.marks.includes('sub'))).toBeTruthy();
    expect(spans.find(s => s.text === '2' && s.marks.includes('sup'))).toBeTruthy();
  });

  it('parses `[[Target]]` and `[[Target|Label]]` wiki links', () => {
    const pt = format.toPortableText('see [[OtherPage]] and [[OtherPage|the page]]');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('zim://page/OtherPage');
    expect(block.markDefs[1]?.href).toBe('zim://page/OtherPage');
    expect(block.children.find(c => c.text === 'the page')?.marks).toHaveLength(1);
  });

  it('parses `* ` and `1. ` lists with 2-space indent nesting', () => {
    const pt = format.toPortableText('* a\n  * b\n1. one\n  1. two');
    expect((pt[0] as { listItem?: string, level?: number }).listItem).toBe('bullet');
    expect((pt[0] as { level?: number }).level).toBe(1);
    expect((pt[1] as { level?: number }).level).toBe(2);
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[3] as { listItem?: string, level?: number }).listItem).toBe('number');
    expect((pt[3] as { level?: number }).level).toBe(2);
  });

  it("parses `'''` ... `'''` fenced verbatim as code block", () => {
    const pt = format.toPortableText("'''\nx = 1\ny = 2\n'''");
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
  });

  it('parses `{{image.png}}` as an image block and `----` as hr', () => {
    const pt = format.toPortableText('{{photo.jpg}}\n\n----');
    expect((pt[0] as { _type: string })._type).toBe('image');
    expect((pt[0] as { url?: string }).url).toBe('photo.jpg');
    expect((pt[1] as { _type: string })._type).toBe('hr');
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

  it('detects ZIM content', () => {
    expect(format.detect('====== Title ======\n\nbody')).toBeGreaterThan(0.4);
    expect(format.detect("'''\ncode\n'''")).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
