import { describe, expect, it } from 'vitest';

import { mdxFormat as format } from '../index';

describe('mdx format', () => {
  it('passes through plain markdown', () => {
    const pt = format.toPortableText('# Title\n\nBody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('extracts a self-closing JSX component as a custom block', () => {
    const pt = format.toPortableText('Hello\n\n<Callout type="info" />\n\nWorld');
    const callout = pt[1] as { _type: string, type?: string };
    expect(callout._type).toBe('Callout');
    expect(callout.type).toBe('info');
  });

  it('extracts a paired JSX component, capturing its children text', () => {
    const pt = format.toPortableText('<Box>Hello inside</Box>');
    const box = pt[0] as { _type: string, children?: string };
    expect(box._type).toBe('Box');
    expect(box.children).toBe('Hello inside');
  });

  it('strips top-level import / export lines', () => {
    const pt = format.toPortableText("import X from 'x'\n\n# Heading");
    expect(pt).toHaveLength(1);
    expect((pt[0] as { style?: string }).style).toBe('h1');
  });

  it('reads expression-valued props as `{...}` strings', () => {
    const pt = format.toPortableText('<Chart data={[1,2,3]} />');
    expect((pt[0] as { data?: unknown }).data).toBe('{[1,2,3]}');
  });

  it('serialises a custom block to JSX', () => {
    const out = format.fromPortableText([
      { _type: 'Callout', type: 'warn', children: 'Heads up' },
    ]);
    expect(out).toContain('<Callout');
    expect(out).toContain('type="warn"');
    expect(out).toContain('>Heads up</Callout>');
  });

  it('detects MDX input', () => {
    expect(format.detect("import X from 'x'\n\n# Hi\n\n<Component />")).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
