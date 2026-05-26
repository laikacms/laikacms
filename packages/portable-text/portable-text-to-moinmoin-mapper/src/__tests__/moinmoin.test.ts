import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { moinMoinFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('moinmoin format', () => {
  it('parses balanced-equals headings', () => {
    const pt = format.toPortableText('= H1 =\n== H2 ==\n===== H5 =====');
    expect(pt.map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h5']);
  });

  it('parses inline decorators', () => {
    const pt = format.toPortableText(
      "plain '''bold''' ''em'' __u__ --(s)-- ^sup^ ,,sub,, {{{c}}}",
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'bold')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'em')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'sup')?.marks).toEqual(['sup']);
    expect(spans.find(s => s.text === 'sub')?.marks).toEqual(['sub']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses [[target|description]] links', () => {
    const pt = format.toPortableText('see [[https://example.com|here]]');
    const block = pt[0] as {
      markDefs: { href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses leading-space `* `/`1. ` list items', () => {
    const pt = format.toPortableText(' * a\n * b\n 1. one\n 1. two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('number');
    expect((pt[3] as { listItem?: string }).listItem).toBe('number');
  });

  it('parses `{{{` ... `}}}` code blocks with #!language hint', () => {
    const pt = format.toPortableText('{{{\n#!python\nprint(1)\n}}}');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('print(1)');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('parses `----` horizontal rules', () => {
    const pt = format.toPortableText('before\n----\nafter');
    expect((pt[1] as { _type: string })._type).toBe('hr');
  });

  it('round-trips a representative document', () => {
    expectStable([
      {
        _type: 'block',
        style: 'h2',
        markDefs: [],
        children: [{ _type: 'span', text: 'Title', marks: [] }],
      },
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

  it('detects MoinMoin markup', () => {
    expect(format.detect('= Title =\n\nbody')).toBeGreaterThan(0.2);
    expect(format.detect("'''bold''' and [[link|x]]")).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
  });
});
