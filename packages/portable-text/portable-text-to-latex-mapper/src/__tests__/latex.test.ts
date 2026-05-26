import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { latexFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('latex format', () => {
  it('round-trips a heading + paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it('round-trips a code block', () => {
    expectStable([{ _type: 'code', code: 'x = 1\ny = 2', language: null }]);
  });

  it('round-trips a block quote', () => {
    expectStable([
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'wisdom', marks: [] }] },
    ]);
  });

  it('round-trips a bullet list', () => {
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

  it('parses \\textbf / \\textit / \\texttt into marks', () => {
    const pt = format.toPortableText('\\textbf{b} \\textit{i} \\texttt{c}');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses \\href{url}{label} into a link annotation', () => {
    const pt = format.toPortableText('see \\href{https://example.com}{here}');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('serialises h1 to \\section{...}', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    expect(out).toBe('\\section{Hi}');
  });

  it('detects LaTeX input', () => {
    expect(format.detect('\\section{Title}\n\n\\textbf{bold}')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
