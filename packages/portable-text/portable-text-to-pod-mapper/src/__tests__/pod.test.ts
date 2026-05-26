import { describe, expect, it } from 'vitest';

import { podFormat as format } from '../index';

describe('perl POD format', () => {
  it('parses =head1 ... =head4 into h1..h4 blocks', () => {
    const pt = format.toPortableText('=head1 Title\n\n=head3 Subsection');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('h3');
  });

  it('parses B<bold> / I<italic> / C<code> / U<underline>', () => {
    const pt = format.toPortableText('B<b> I<i> C<c> U<u>');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
  });

  it('parses L<text|url> into a link annotation', () => {
    const pt = format.toPortableText('see L<here|https://example.com>');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses =over / =item / =back into list blocks', () => {
    const pt = format.toPortableText('=over 4\n\n=item *\n\nApple\n\n=item *\n\nPear\n\n=back');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses an indented paragraph as a verbatim code block', () => {
    const pt = format.toPortableText('Hello\n\n    let x = 1;\n    let y = 2;');
    expect((pt[0] as { style?: string }).style).toBe('normal');
    expect((pt[1] as { _type: string })._type).toBe('code');
    expect((pt[1] as { code?: string }).code).toBe('let x = 1;\nlet y = 2;');
  });

  it('serialises an h2 with `=head2`', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Section', marks: [] }] },
    ]);
    expect(out).toBe('=head2 Section');
  });

  it('detects POD input', () => {
    expect(format.detect('=head1 Title\n\nB<bold> with L<x|y>')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
