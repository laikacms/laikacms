import { describe, expect, it } from 'vitest';

import { docbookFormat as format } from '../index';

describe('docbook format', () => {
  it('parses <sect1><title> as h1', () => {
    const pt = format.toPortableText('<sect1><title>Top</title><para>Body</para></sect1>');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('parses <emphasis>/<emphasis role="bold">/<literal> inline marks', () => {
    const pt = format.toPortableText(
      '<para><emphasis role="bold">b</emphasis> <emphasis>i</emphasis> <literal>c</literal></para>',
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses <ulink url="..."> as a link annotation', () => {
    const pt = format.toPortableText('<para>see <ulink url="https://example.com">here</ulink></para>');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses <itemizedlist> as bullet list and <orderedlist> as numbered', () => {
    const pt = format.toPortableText(
      '<itemizedlist><listitem><para>a</para></listitem><listitem><para>b</para></listitem></itemizedlist>',
    );
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    const num = format.toPortableText(
      '<orderedlist><listitem><para>1</para></listitem></orderedlist>',
    );
    expect((num[0] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses <programlisting> as a code block', () => {
    const pt = format.toPortableText('<programlisting>console.log(1)</programlisting>');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('console.log(1)');
  });

  it('serialises h1 to <sect1><title>…</title></sect1>', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Top', marks: [] }] },
    ]);
    expect(out).toBe('<sect1><title>Top</title></sect1>');
  });

  it('escapes XML entities in plain text', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'a < b & c', marks: [] }] },
    ]);
    expect(out).toContain('a &lt; b &amp; c');
  });

  it('detects DocBook input', () => {
    expect(format.detect('<para>hi <emphasis>x</emphasis></para>')).toBeGreaterThan(0.3);
    expect(format.detect('plain prose')).toBe(0);
  });
});
