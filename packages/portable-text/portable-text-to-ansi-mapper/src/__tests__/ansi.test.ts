import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { ansiFormat as format } from '../index';

const ESC = '\x1b';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('ansi format', () => {
  it('parses SGR `\\x1b[1m`/`22m` as strong decorator', () => {
    const pt = format.toPortableText(`plain ${ESC}[1mbold${ESC}[22m end`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
  });

  it('parses italic / underline / strike SGR codes', () => {
    const pt = format.toPortableText(
      `${ESC}[3mem${ESC}[23m ${ESC}[4mu${ESC}[24m ${ESC}[9ms${ESC}[29m`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
  });

  it('combines multiple SGR parameters in one escape', () => {
    const pt = format.toPortableText(`${ESC}[1;3mboth${ESC}[0m end`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    const both = spans.find(s => s.text === 'both');
    expect(both?.marks).toContain('strong');
    expect(both?.marks).toContain('em');
  });

  it('resets all on `\\x1b[0m`', () => {
    const pt = format.toPortableText(`${ESC}[1m bold ${ESC}[0m plain`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    const plain = spans.find(s => s.text.trim() === 'plain');
    expect(plain?.marks).toEqual([]);
  });

  it('drops colour SGR codes (30-37, 38;5;N, 38;2;R;G;B)', () => {
    const pt = format.toPortableText(
      `${ESC}[31mred${ESC}[0m ${ESC}[38;5;208morange${ESC}[0m ${ESC}[38;2;100;200;255mrgb${ESC}[0m`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'red')?.marks).toEqual([]);
    expect(spans.find(s => s.text === 'orange')?.marks).toEqual([]);
    expect(spans.find(s => s.text === 'rgb')?.marks).toEqual([]);
  });

  it('parses OSC 8 hyperlinks into markDefs', () => {
    const pt = format.toPortableText(
      `see ${ESC}]8;;https://example.com${ESC}\\here${ESC}]8;;${ESC}\\ done`,
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
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

  it('detects ANSI content', () => {
    expect(format.detect(`${ESC}[1mbold${ESC}[0m`)).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
