import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { pollenFormat as format } from '../index';

const L = '◊';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('pollen format', () => {
  it('parses ◊h1..◊h6 / ◊p / ◊blockquote into block styles', () => {
    const pt = format.toPortableText(`${L}h1{A}\n${L}h3{B}\n${L}p{p}\n${L}blockquote{q}`);
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h3', 'normal', 'blockquote']);
  });

  it('parses inline ◊strong / ◊em / ◊u / ◊del / ◊sub / ◊sup / ◊code decorators', () => {
    const pt = format.toPortableText(
      `${L}p{plain ${L}strong{b} ${L}em{i} ${L}u{u} ${L}del{s} ${L}sub{x} ${L}sup{y} ${L}code{c}}`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'x')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === 'y')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses ◊link["url"]{text} as a markDefs link', () => {
    const pt = format.toPortableText(`${L}p{see ${L}link["https://example.com"]{here}}`);
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses ◊ul / ◊ol of ◊item as list blocks', () => {
    const pt = format.toPortableText(`${L}ul{${L}item{a} ${L}item{b}} ${L}ol{${L}item{x}}`);
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses ◊code-block{…} as a code block', () => {
    const pt = format.toPortableText(`${L}code-block{print(1)\nprint(2)}`);
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
  });

  it('strips line and block ◊; comments', () => {
    const pt = format.toPortableText(`${L};{this is a comment}\n${L}p{Body.}\n${L}; trailing\n`);
    expect(pt).toHaveLength(1);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Body.');
  });

  it('strips a leading `#lang pollen` shebang', () => {
    const pt = format.toPortableText(`#lang pollen\n${L}h1{Title}\n${L}p{body}`);
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
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

  it('detects Pollen content', () => {
    expect(format.detect(`${L}h1{Title}\n${L}p{body}`)).toBeGreaterThan(0.4);
    expect(format.detect(`#lang pollen\n${L}p{x}`)).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
