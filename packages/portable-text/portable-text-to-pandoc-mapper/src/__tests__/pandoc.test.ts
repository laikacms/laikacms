import { describe, expect, it } from 'vitest';

import { pandocFormat as format } from '../index';

describe('pandoc markdown format', () => {
  it('passes plain markdown through', () => {
    const pt = format.toPortableText('# Title\n\nBody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('parses ~~strike~~ into a strike-through decorator', () => {
    const pt = format.toPortableText('plain ~~gone~~ text');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'gone')?.marks).toContain('strike-through');
  });

  it('parses ^sup^ and ~sub~ into sup / sub decorators', () => {
    const pt = format.toPortableText('H~2~O E=mc^2^');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === '2' && s.marks.includes('sub'))).toBeTruthy();
    expect(spans.find(s => s.text === '2' && s.marks.includes('sup'))).toBeTruthy();
  });

  it('extracts footnote definitions as a `pandoc:footnote` custom block', () => {
    const pt = format.toPortableText('A statement[^a].\n\n[^a]: a clarification.');
    const note = pt.find(b => (b as { _type?: string })._type === 'pandoc:footnote') as { id?: string, body?: string };
    expect(note?.id).toBe('a');
    expect(note?.body).toBe('a clarification.');
  });

  it('serialises ~~strike~~ / ^sup^ / ~sub~ back from PT spans', () => {
    const out = format.fromPortableText([
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'gone', marks: ['strike-through'] },
          { _type: 'span', text: ' a', marks: [] },
          { _type: 'span', text: '2', marks: ['sup'] },
        ],
      },
    ]);
    expect(out).toContain('~~gone~~');
    expect(out).toContain('^2^');
  });

  it('serialises a `pandoc:footnote` block as `[^id]: body` after the body', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'a[^1]', marks: [] }] },
      { _type: 'pandoc:footnote', id: '1', body: 'a note' },
    ]);
    expect(out).toContain('[^1]: a note');
  });

  it('detects Pandoc-flavoured input', () => {
    expect(format.detect('Text with a footnote[^x].\n\n[^x]: body')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
