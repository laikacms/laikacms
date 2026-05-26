import { stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { rstFormat as format } from '../index';

describe('rst format', () => {
  it('parses an underlined heading', () => {
    const pt = format.toPortableText('Title\n=====\n\nBody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('parses **bold** / *italic* / ``code``', () => {
    const pt = format.toPortableText('**b** *i* ``c``');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses `label <url>`_ link references', () => {
    const pt = format.toPortableText('see `here <https://example.com>`_');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(s => s.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses bullet and numbered lists', () => {
    const pt = format.toPortableText('- one\n- two\n\n#. first\n#. second');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses a `.. code-block::` directive', () => {
    const pt = format.toPortableText('.. code-block:: python\n\n    print("hi")\n    x = 1');
    expect((pt[0] as { _type: string, code?: string, language?: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('print("hi")\nx = 1');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('serialises an h2 with `-` underline of matching length', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Section', marks: [] }] },
    ]);
    expect(out).toBe('Section\n-------');
  });

  it('detects RST input', () => {
    expect(format.detect('Title\n=====\n\nBody with `link <http://x>`_')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });

  it('round-trips a heading + code block', () => {
    const doc = [
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
      { _type: 'code', code: 'a\nb', language: 'js' },
    ] as const;
    expect(stripKeys(format.toPortableText(format.fromPortableText(doc as any)))).toEqual(stripKeys(doc as any));
  });
});
