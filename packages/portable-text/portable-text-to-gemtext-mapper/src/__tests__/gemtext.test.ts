import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { gemtextFormat as format } from '../index';

describe('gemtext format', () => {
  it('parses headings, bullets, quotes and code blocks', () => {
    const pt = format.toPortableText(
      ['# Title', '', '* a', '* b', '', '> quote', '', '```', 'console.log(1)', '```'].join('\n'),
    );
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[2] as { listItem?: string }).listItem).toBe('bullet');
    expect((pt[3] as { style?: string }).style).toBe('blockquote');
    expect((pt[4] as { _type?: string })._type).toBe('code');
  });

  it('parses `=> url label` link lines into a link annotation', () => {
    const pt = format.toPortableText('=> https://example.com Example');
    const block = pt[0] as {
      markDefs: { href: string }[],
      children: { text: string, marks: string[] }[],
    };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children[0]?.text).toBe('Example');
    expect(block.children[0]?.marks).toHaveLength(1);
  });

  it('serialises a heading + link block to gemtext line format', () => {
    const out = format.fromPortableText([
      {
        _type: 'block',
        style: 'h2',
        markDefs: [],
        children: [{ _type: 'span', text: 'Title', marks: [] }],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'm0', href: 'https://example.com' }],
        children: [{ _type: 'span', text: 'Example', marks: ['m0'] }],
      },
    ]);
    expect(out).toContain('## Title');
    expect(out).toContain('=> https://example.com Example');
  });

  it('round-trips headings + a code block (lossy on inline marks by design)', () => {
    const doc: PortableTextDocument = [
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Hi', marks: [] }] },
      { _type: 'code', code: 'one\ntwo', language: null },
    ];
    expect(stripKeys(format.toPortableText(format.fromPortableText(doc)))).toEqual(stripKeys(doc));
  });

  it('collapses h4..h6 to h3 (Gemtext only defines three heading levels)', () => {
    const out = format.fromPortableText([
      { _type: 'block', style: 'h5', markDefs: [], children: [{ _type: 'span', text: 'Deep', marks: [] }] },
    ]);
    expect(out).toBe('### Deep');
  });

  it('detects Gemtext input', () => {
    expect(format.detect('# Title\n\n=> https://x label')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose without markers')).toBe(0);
  });
});
