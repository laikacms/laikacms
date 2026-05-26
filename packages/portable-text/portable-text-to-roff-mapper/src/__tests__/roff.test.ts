import { describe, expect, it } from 'vitest';

import { roffFormat as format } from '../index';

describe('roff / man-page format', () => {
  it('parses .SH → h1 and .SS → h2', () => {
    const pt = format.toPortableText('.SH NAME\n\n.SS Section');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('h2');
  });

  it('parses \\fB...\\fR / \\fI...\\fR / \\fC...\\fR inline marks', () => {
    const pt = format.toPortableText('plain \\fBb\\fR and \\fIi\\fR and \\fCc\\fR');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses .IP "marker" list items', () => {
    const pt = format.toPortableText('.IP "*" 4\nApple\n.IP "*" 4\nPear');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses .IP "1." as a numbered list item', () => {
    const pt = format.toPortableText('.IP "1." 4\nFirst\n.IP "2." 4\nSecond');
    expect((pt[0] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses .EX / .EE as a code block', () => {
    const pt = format.toPortableText('.EX\nls -la\necho hi\n.EE');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('ls -la\necho hi');
  });

  it('parses .UR / .UE as a link annotation', () => {
    const pt = format.toPortableText('.UR https://example.com\nhere\n.UE');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children[0]?.text).toBe('here');
  });

  it('serialises h1 / h2 to .SH / .SS', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'NAME', marks: [] }] },
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Sub', marks: [] }] },
    ]);
    expect(out).toContain('.SH NAME');
    expect(out).toContain('.SS Sub');
  });

  it('detects roff input', () => {
    expect(format.detect('.SH NAME\n\nfoo \\fBbar\\fR')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
