import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { logseqFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('logseq format', () => {
  it('parses flat outline as bullet list at level 1', () => {
    const pt = format.toPortableText('- one\n- two\n- three');
    expect(pt.length).toBe(3);
    for (const block of pt) {
      expect((block as { listItem?: string }).listItem).toBe('bullet');
      expect((block as { level?: number }).level).toBe(1);
    }
  });

  it('uses 2-space indent to drive nesting depth', () => {
    const pt = format.toPortableText('- a\n  - b\n    - c\n  - d');
    const levels = pt.map(b => (b as { level: number }).level);
    expect(levels).toEqual([1, 2, 3, 2]);
  });

  it('parses inline `**bold**` / `*em*` / `~~s~~` / `==hi==` / `` `c` ``', () => {
    const pt = format.toPortableText('- plain **b** *i* ~~s~~ ==h== `c`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'h')?.marks).toEqual(['highlight']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses `[[Page Name]]` wiki links and `[text](url)` markdown links', () => {
    const pt = format.toPortableText('- see [[Other Page]] and [docs](https://example.com)');
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    const hrefs = block.markDefs.map(m => m.href).sort();
    expect(hrefs).toEqual(['https://example.com', 'logseq://page/Other Page']);
  });

  it('parses leading `key:: value` lines as page properties', () => {
    const pt = format.toPortableText('title:: My Page\ntags:: foo, bar\n\n- first block');
    expect((pt[0] as { _type: string })._type).toBe('logseq:page-properties');
    const props = (pt[0] as { properties: Record<string, string> }).properties;
    expect(props.title).toBe('My Page');
    expect(props.tags).toBe('foo, bar');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses block-level properties under a bullet', () => {
    const pt = format.toPortableText('- a task\n  status:: in-progress\n  priority:: high');
    const block = pt[0] as { properties?: Record<string, string> };
    expect(block.properties?.status).toBe('in-progress');
    expect(block.properties?.priority).toBe('high');
  });

  it('round-trips a representative outline with properties and links', () => {
    expectStable([
      { _type: 'logseq:page-properties', properties: { title: 'Notes' } },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'parent', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 2,
        children: [
          { _type: 'span', text: 'child with ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
    ] as unknown as PortableTextDocument);
  });

  it('detects Logseq markers', () => {
    expect(format.detect('title:: My Note\n\n- item')).toBeGreaterThan(0.4);
    expect(format.detect('- a [[Linked Page]]\n  - b')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
