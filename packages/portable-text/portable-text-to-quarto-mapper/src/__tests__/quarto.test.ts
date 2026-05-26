import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { quartoFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('quarto format', () => {
  it('parses executable `` ```{lang} `` code chunks with the executable flag', () => {
    const pt = format.toPortableText('```{python}\nprint(1)\nprint(2)\n```');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { language?: string }).language).toBe('python');
    expect((pt[0] as { executable?: boolean }).executable).toBe(true);
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
  });

  it('parses `::: {.callout-note}` blocks as quarto:callout', () => {
    const pt = format.toPortableText(
      '::: {.callout-warning title="Be careful"}\nYou\'ve been warned.\n:::',
    );
    expect((pt[0] as { _type: string })._type).toBe('quarto:callout');
    expect((pt[0] as { kind: string }).kind).toBe('warning');
    expect((pt[0] as { title: string }).title).toBe('Be careful');
    expect((pt[0] as { body: string }).body).toBe("You've been warned.");
  });

  it('parses all five canonical callout kinds', () => {
    const src = ['note', 'tip', 'warning', 'important', 'caution']
      .map(k => `::: {.callout-${k}}\nBody.\n:::`)
      .join('\n\n');
    const pt = format.toPortableText(src);
    expect(pt.map(b => (b as { kind?: string }).kind)).toEqual([
      'note',
      'tip',
      'warning',
      'important',
      'caution',
    ]);
  });

  it('parses YAML frontmatter into a quarto:frontmatter block', () => {
    const pt = format.toPortableText('---\ntitle: My Doc\nauthor: me\n---\n\n# H');
    expect((pt[0] as { _type: string })._type).toBe('quarto:frontmatter');
    expect((pt[0] as { content: string }).content).toContain('title: My Doc');
    expect((pt[1] as { style?: string }).style).toBe('h1');
  });

  it('passes standard Markdown through unchanged', () => {
    const pt = format.toPortableText('# Chapter\n\nWith **bold**.');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    const spans = (pt[1] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.some(s => s.marks.includes('strong'))).toBe(true);
  });

  it('round-trips an executable chunk + callout + frontmatter mix', () => {
    expectStable([
      { _type: 'quarto:frontmatter', content: 'title: Test' },
      {
        _type: 'block',
        style: 'h1',
        markDefs: [],
        children: [{ _type: 'span', text: 'Chapter', marks: [] }],
      },
      {
        _type: 'code',
        code: 'print(42)',
        language: 'python',
        executable: true,
      },
      {
        _type: 'quarto:callout',
        kind: 'tip',
        title: null,
        body: 'A useful tip',
      },
    ] as unknown as PortableTextDocument);
  });

  it('detects Quarto markers', () => {
    expect(format.detect('```{python}\nprint(1)\n```')).toBeGreaterThan(0.5);
    expect(format.detect('::: {.callout-note}\nx\n:::')).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
  });
});
