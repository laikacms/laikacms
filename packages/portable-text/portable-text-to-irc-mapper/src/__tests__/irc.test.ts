import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { ircFormat as format } from '../index';

const B = '\x02';
const I = '\x1d';
const U = '\x1f';
const S = '\x1e';
const M = '\x11';
const R = '\x0f';
const C = '\x03';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('irc format', () => {
  it('parses bold/italic/underline/strike/code toggle bytes', () => {
    const pt = format.toPortableText(
      `plain ${B}bold${B} ${I}em${I} ${U}u${U} ${S}s${S} ${M}c${M}`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('combines nested toggles into multi-decorator spans', () => {
    const pt = format.toPortableText(`${B}${I}both${I}${B}`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    const both = spans.find(s => s.text === 'both');
    expect(both?.marks).toContain('strong');
    expect(both?.marks).toContain('em');
  });

  it('resets every active style on \\x0f', () => {
    const pt = format.toPortableText(`${B}${I}both${R} plain`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    const plain = spans.find(s => s.text.includes('plain'));
    expect(plain?.marks).toEqual([]);
  });

  it('drops colour codes (\\x03N or \\x03N,M)', () => {
    const pt = format.toPortableText(`${C}04red${C} ${C}03,02green-on-red${C} plain`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.every(s => s.marks.length === 0)).toBe(true);
    expect(spans.map(s => s.text).join('')).toBe('red green-on-red plain');
  });

  it('drops reverse-video toggle bytes', () => {
    const pt = format.toPortableText('\x16reversed\x16');
    expect((pt[0] as { children: { text: string }[] }).children.map(c => c.text).join('')).toBe('reversed');
  });

  it('splits paragraphs on blank lines', () => {
    const pt = format.toPortableText('one\n\ntwo\n\nthree');
    expect(pt.length).toBe(3);
  });

  it('round-trips a representative document', () => {
    expectStable([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
          { _type: 'span', text: ' done', marks: [] },
        ],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'em+u', marks: ['em', 'underline'] },
        ],
      },
    ]);
  });

  it('detects IRC content', () => {
    expect(format.detect(`${B}bold${B}`)).toBeGreaterThan(0.2);
    expect(format.detect(`${C}04coloured${C}`)).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
