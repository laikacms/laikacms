import { type PortableTextDocument } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { jupyterFormat as format } from '../index';

describe('jupyter format', () => {
  it('parses a code cell with language metadata', () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          metadata: { language_info: { name: 'python' } },
          source: ['print(1)\n', 'print(2)'],
          outputs: [],
          execution_count: 3,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });
    const pt = format.toPortableText(nb);
    // [0] is the notebook-meta block.
    expect((pt[1] as { _type: string })._type).toBe('code');
    expect((pt[1] as { code?: string }).code).toBe('print(1)\nprint(2)');
    expect((pt[1] as { language?: string }).language).toBe('python');
    expect((pt[1] as { execution_count?: number }).execution_count).toBe(3);
  });

  it('parses markdown cells into PT block(s) with `jupyterCellStart` on the first', () => {
    const nb = JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Title\n', '\n', 'Body'] },
        { cell_type: 'markdown', source: ['Second cell'] },
      ],
      nbformat: 4,
      nbformat_minor: 5,
    });
    const pt = format.toPortableText(nb);
    // After notebook-meta: h1 + p (cell 1) + p (cell 2).
    expect((pt[1] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { jupyterCellStart?: boolean }).jupyterCellStart).toBe(true);
    expect((pt[2] as { jupyterCellStart?: boolean }).jupyterCellStart).toBeFalsy();
    expect((pt[3] as { jupyterCellStart?: boolean }).jupyterCellStart).toBe(true);
  });

  it('parses raw cells into jupyter:raw blocks with mime type', () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: 'raw',
          metadata: { raw_mimetype: 'text/html' },
          source: ['<div>x</div>'],
        },
      ],
    });
    const pt = format.toPortableText(nb);
    expect((pt[1] as { _type: string })._type).toBe('jupyter:raw');
    expect((pt[1] as { mime?: string }).mime).toBe('text/html');
    expect((pt[1] as { content?: string }).content).toBe('<div>x</div>');
  });

  it('captures the notebook metadata + nbformat in a single header block', () => {
    const nb = JSON.stringify({
      cells: [],
      metadata: { kernelspec: { language: 'python', name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    });
    const pt = format.toPortableText(nb);
    expect((pt[0] as { _type: string })._type).toBe('jupyter:notebook-meta');
    expect((pt[0] as { nbformat?: number }).nbformat).toBe(4);
  });

  it('accepts `source` as either a string or an array of strings', () => {
    const nbA = JSON.stringify({ cells: [{ cell_type: 'code', source: 'a = 1' }] });
    const nbB = JSON.stringify({ cells: [{ cell_type: 'code', source: ['a = ', '1'] }] });
    const a = format.toPortableText(nbA);
    const b = format.toPortableText(nbB);
    expect((a[1] as { code?: string }).code).toBe('a = 1');
    expect((b[1] as { code?: string }).code).toBe('a = 1');
  });

  it('round-trips a notebook with markdown + code + raw cells', () => {
    const original: PortableTextDocument = [
      {
        _type: 'jupyter:notebook-meta',
        metadata: { kernelspec: { language: 'python', name: 'python3' } },
        nbformat: 4,
        nbformat_minor: 5,
      },
      {
        _type: 'block',
        style: 'h1',
        markDefs: [],
        children: [{ _type: 'span', text: 'Title', marks: [] }],
        jupyterCellStart: true,
      },
      {
        _type: 'code',
        code: 'x = 1\nprint(x)',
        language: 'python',
        outputs: [],
        execution_count: null,
        jupyterCellStart: true,
      },
      {
        _type: 'jupyter:raw',
        content: '<div>x</div>',
        mime: 'text/html',
      },
    ] as unknown as PortableTextDocument;
    const serialised = format.fromPortableText(original);
    const round = format.toPortableText(serialised);
    // Sanity: code + raw cells survive; markdown cell exists with h1 inside.
    const codeBlock = round.find(b => (b as { _type?: string })._type === 'code');
    const rawBlock = round.find(b => (b as { _type?: string })._type === 'jupyter:raw');
    const heading = round.find(b => (b as { style?: string }).style === 'h1');
    expect(codeBlock).toBeDefined();
    expect(rawBlock).toBeDefined();
    expect(heading).toBeDefined();
    expect((codeBlock as { language?: string }).language).toBe('python');
    expect((rawBlock as { mime?: string }).mime).toBe('text/html');
  });

  it('detects Jupyter Notebook JSON', () => {
    expect(
      format.detect(JSON.stringify({ cells: [{ cell_type: 'code', source: 'x' }], nbformat: 4 })),
    ).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
