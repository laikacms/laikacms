import { describe, expect, it } from 'vitest';

import { markdocFormat as format } from '../index';

describe('markdoc format', () => {
  it('passes plain markdown through', () => {
    const pt = format.toPortableText('# Title\n\nBody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('parses a self-closing `{% tag /%}` as a custom block', () => {
    const pt = format.toPortableText('Hello\n\n{% callout type="note" /%}\n\nWorld');
    const callout = pt[1] as { _type: string, type?: string };
    expect(callout._type).toBe('markdoc:callout');
    expect(callout.type).toBe('note');
  });

  it('parses a paired `{% tag %}body{% /tag %}` with children captured', () => {
    const pt = format.toPortableText('{% box %}Hi there{% /box %}');
    const box = pt[0] as { _type: string, children?: string };
    expect(box._type).toBe('markdoc:box');
    expect(box.children).toBe('Hi there');
  });

  it('coerces numeric and boolean attribute values', () => {
    const pt = format.toPortableText('{% gauge value=42 expanded=true /%}');
    const gauge = pt[0] as { value?: unknown, expanded?: unknown };
    expect(gauge.value).toBe(42);
    expect(gauge.expanded).toBe(true);
  });

  it('serialises a `markdoc:<name>` block back to a Markdoc tag', () => {
    const out = format.fromPortableText([
      { _type: 'markdoc:callout', type: 'warn', children: 'Heads up' },
    ]);
    expect(out).toContain('{% callout');
    expect(out).toContain('type="warn"');
    expect(out).toContain('{% /callout %}');
  });

  it('detects Markdoc input', () => {
    expect(format.detect('# Hi\n\n{% callout /%}\n\nBody')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
