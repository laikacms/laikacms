import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { rtfFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('rtf format', () => {
  it('parses plain paragraphs separated by `\\par`', () => {
    const pt = format.toPortableText(`{\\rtf1\\ansi One\\par Two\\par}`);
    expect(pt.length).toBe(2);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('One');
    expect((pt[1] as { children: { text: string }[] }).children[0]?.text).toBe('Two');
  });

  it('parses `\\b` / `\\b0` toggles into strong decorators', () => {
    const pt = format.toPortableText(`{\\rtf1\\ansi plain \\b bold\\b0  end\\par}`);
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    const bold = spans.find(s => s.text.includes('bold'));
    expect(bold?.marks).toContain('strong');
  });

  it('parses `\\i` / `\\ul` / `\\strike` / `\\super` / `\\sub` toggles', () => {
    const pt = format.toPortableText(
      `{\\rtf1\\ansi \\i em\\i0  \\ul u\\ulnone  \\strike s\\strike0  \\super x\\nosupersub  \\sub y\\nosupersub \\par}`,
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text.trim() === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text.trim() === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text.trim() === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text.trim() === 'x')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text.trim() === 'y')?.marks).toEqual(['sub']);
  });

  it('parses `\\s1`..`\\s6` paragraph styles as heading levels', () => {
    const pt = format.toPortableText(
      `{\\rtf1\\ansi \\s1 Title\\par\\s2 Sub\\par\\s6 Tiny\\par}`,
    );
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h6']);
  });

  it('parses a HYPERLINK field into a markDefs link', () => {
    const pt = format.toPortableText(
      `{\\rtf1\\ansi see {\\field{\\*\\fldinst HYPERLINK "https://example.com"}{\\fldrslt here}} done\\par}`,
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('skips `\\fonttbl` / `\\colortbl` / `\\stylesheet` destinations', () => {
    const pt = format.toPortableText(
      `{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}{\\stylesheet{\\s1 h1;}}Body\\par}`,
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Body');
  });

  it('decodes `\\\\`, `\\{`, `\\}` escapes', () => {
    const pt = format.toPortableText(`{\\rtf1\\ansi a\\{b\\}c\\\\d\\par}`);
    const text = (pt[0] as { children: { text: string }[] }).children.map(c => c.text).join('');
    expect(text).toBe('a{b}c\\d');
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
    ]);
  });

  it('detects RTF content', () => {
    expect(
      format.detect(`{\\rtf1\\ansi\\ansicpg1252 hello\\par}`),
    ).toBeGreaterThan(0.6);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
