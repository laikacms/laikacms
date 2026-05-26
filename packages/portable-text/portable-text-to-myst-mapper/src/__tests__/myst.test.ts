import { describe, expect, it } from 'vitest';

import { mystFormat as format } from '../index';

describe('myst markdown format', () => {
  it('passes plain markdown through unchanged', () => {
    const pt = format.toPortableText('# Title\n\nBody');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('normal');
  });

  it('parses {sub} and {sup} inline roles into sub/sup decorators', () => {
    const pt = format.toPortableText('H{sub}`2`O E=mc{sup}`2`');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === '2' && s.marks.includes('sub'))).toBeTruthy();
    expect(spans.find(s => s.text === '2' && s.marks.includes('sup'))).toBeTruthy();
  });

  it('maps {kbd} role to the code decorator', () => {
    const pt = format.toPortableText('press {kbd}`Ctrl+C` to copy');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'Ctrl+C')?.marks).toContain('code');
  });

  it('extracts :::{directive} blocks as `myst:<name>` custom PT blocks', () => {
    const pt = format.toPortableText(':::{note}\nWatch your step.\n:::');
    const block = pt[0] as { _type: string, body?: string };
    expect(block._type).toBe('myst:note');
    expect(block.body).toBe('Watch your step.');
  });

  it('captures directive arguments and bodies', () => {
    const pt = format.toPortableText(':::{admonition} Heads up\nbe careful\n:::');
    const block = pt[0] as { _type: string, arg?: string, body?: string };
    expect(block._type).toBe('myst:admonition');
    expect(block.arg).toBe('Heads up');
    expect(block.body).toBe('be careful');
  });

  it('serialises a custom myst: block back to a `:::{name}` directive', () => {
    const out = format.fromPortableText([
      { _type: 'myst:note', arg: '', body: 'Hi there' },
    ]);
    expect(out).toContain(':::{note}');
    expect(out).toContain('Hi there');
    expect(out).toMatch(/:::\s*$/);
  });

  it('detects MyST input', () => {
    expect(format.detect(':::{note}\nhi\n:::\n\n{kbd}`q`')).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
  });
});
