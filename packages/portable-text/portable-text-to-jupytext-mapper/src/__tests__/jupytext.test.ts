import { type PortableTextDocument } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { jupytextFormat as format } from '../index';

describe('jupytext format', () => {
  it('parses a `# %%` code cell into a PT code block', () => {
    const pt = format.toPortableText('# %%\nprint(1)\nprint(2)');
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('print(1)\nprint(2)');
    expect((pt[0] as { language?: string }).language).toBe('python');
  });

  it('parses a `# %% [markdown]` cell into markdown PT blocks', () => {
    const pt = format.toPortableText('# %% [markdown]\n# # Heading\n#\n# Body');
    const heading = pt.find(b => (b as { style?: string }).style === 'h1');
    const para = pt.find(b => (b as { style?: string }).style === 'normal');
    expect(heading).toBeDefined();
    expect(para).toBeDefined();
    expect((heading as { jupytextCellStart?: boolean }).jupytextCellStart).toBe(true);
  });

  it('parses a `# %% [raw]` cell into a jupytext:raw block', () => {
    const pt = format.toPortableText('# %% [raw]\n# <html>raw stuff</html>');
    expect((pt[0] as { _type: string })._type).toBe('jupytext:raw');
    expect((pt[0] as { content?: string }).content).toBe('<html>raw stuff</html>');
  });

  it('captures cell-marker title text as jupytextCellMeta', () => {
    const pt = format.toPortableText('# %% Run analysis\nprint(1)');
    expect((pt[0] as { jupytextCellMeta?: string }).jupytextCellMeta).toBe('Run analysis');
  });

  it('captures content before the first cell marker as a jupytext:header block', () => {
    const pt = format.toPortableText(
      `# ---\n# jupyter:\n#   kernelspec: { name: python3 }\n# ---\n\n# %%\nprint(1)`,
    );
    expect((pt[0] as { _type: string })._type).toBe('jupytext:header');
    expect((pt[0] as { source?: string }).source).toContain('kernelspec');
    expect((pt[1] as { _type: string })._type).toBe('code');
  });

  it('strips `# ` prefix from markdown / raw cell body lines', () => {
    const pt = format.toPortableText('# %% [markdown]\n# Just text');
    const para = pt.find(b => (b as { style?: string }).style === 'normal') as {
      children: { text: string }[],
    } | undefined;
    expect(para?.children[0]?.text).toBe('Just text');
  });

  it('round-trips a notebook with markdown + code + raw cells', () => {
    const original: PortableTextDocument = [
      {
        _type: 'block',
        style: 'h1',
        markDefs: [],
        children: [{ _type: 'span', text: 'Chapter', marks: [] }],
        jupytextCellStart: true,
      },
      {
        _type: 'code',
        code: 'x = 1\nprint(x)',
        language: 'python',
        jupytextCellStart: true,
        jupytextCellMeta: '',
      },
      {
        _type: 'jupytext:raw',
        content: '<div>x</div>',
        meta: '',
      },
    ] as unknown as PortableTextDocument;
    const serialised = format.fromPortableText(original);
    const round = format.toPortableText(serialised);
    expect(round.find(b => (b as { style?: string }).style === 'h1')).toBeDefined();
    expect(round.find(b => (b as { _type?: string })._type === 'code')).toBeDefined();
    expect(round.find(b => (b as { _type?: string })._type === 'jupytext:raw')).toBeDefined();
  });

  it('detects Jupytext percent-format', () => {
    expect(
      format.detect('# %% [markdown]\n# # Title\n\n# %%\nprint(1)'),
    ).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
