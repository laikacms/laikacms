import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { mediaWikiFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('mediawiki format', () => {
  it('round-trips a heading and a paragraph', () => {
    expectStable([
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'Body', marks: [] }] },
    ]);
  });

  it("parses ''italic'' / '''bold''' / '''''bold-italic'''''", () => {
    const pt = format.toPortableText("''i'' '''b''' '''''bi'''''");
    const block = pt[0] as { children: { text: string, marks: string[] }[] };
    expect(block.children.find(c => c.text === 'i')?.marks).toEqual(['em']);
    expect(block.children.find(c => c.text === 'b')?.marks).toEqual(['strong']);
    expect(block.children.find(c => c.text === 'bi')?.marks).toEqual(['strong', 'em']);
  });

  it('parses [http://x label] into a link annotation', () => {
    const pt = format.toPortableText('see [https://example.com here]');
    const block = pt[0] as {
      markDefs: { _type: string, href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs).toHaveLength(1);
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses * bullet items into list blocks', () => {
    const pt = format.toPortableText('* one\n* two');
    expect(pt).toHaveLength(2);
    expect((pt[0] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
  });

  it('parses # numbered items', () => {
    const pt = format.toPortableText('# one\n# two');
    expect((pt[0] as { listItem?: string }).listItem).toBe('number');
  });

  it('serialises h3 with === wrappers', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h3', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
    ]);
    expect(out).toBe('=== Hi ===');
  });

  it('detects MediaWiki markup', () => {
    expect(format.detect("== Heading ==\n\n'''bold'''")).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('[b]bbcode[/b]')).toBe(0);
  });
});
