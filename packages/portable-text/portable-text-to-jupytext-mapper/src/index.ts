import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * Jupytext percent-format <-> Portable Text.
 *
 * Jupytext lets a Jupyter notebook be stored as a plain Python (or other
 * language) source file by marking cell boundaries with `# %%` comment
 * lines. A cell-type tag in brackets identifies non-code cells:
 *
 *     # %% [markdown]
 *     # # Title
 *     # body paragraph
 *
 *     # %% optional cell title
 *     print(1)
 *
 *     # %% [raw]
 *     # raw content here
 *
 * Cells:
 *   - `# %%` (no tag)        → code cell — body is the cell's verbatim source
 *   - `# %% [markdown]`       → markdown cell — each body line is `# `-prefixed
 *                                 (or blank); we strip the prefix and parse the
 *                                 result as Markdown via `@portabletext/markdown`
 *   - `# %% [raw]`            → raw cell — body uses the same `# `-prefix
 *                                 convention; preserved as a `jupytext:raw`
 *                                 block carrying the cell text
 *
 * On serialize we restore the round-trip shape: markdown blocks get the
 * `# ` prefix back on every line; consecutive markdown blocks share one
 * `# %% [markdown]` cell unless an explicit `jupytextCellStart` flag forces a
 * split.
 *
 * Cell metadata (title text after `# %%`, `tags=…`) is captured as a plain
 * string on the block for stable round-trip.
 */

const CELL_MARKER_RE = /^#\s*%%(?:\s+([^\n]*))?$/;

interface ParsedCell {
  kind: 'code' | 'markdown' | 'raw';
  meta: string;
  source: string;
}

function parseCells(input: string): { headerCell: ParsedCell | null, cells: ParsedCell[] } {
  const lines = input.split(/\r?\n/);
  const cells: ParsedCell[] = [];
  let headerCell: ParsedCell | null = null;
  let current: ParsedCell | null = null;
  let buf: string[] = [];
  const finishCurrent = (): void => {
    if (current === null) return;
    current.source = buf.join('\n');
    cells.push(current);
    current = null;
    buf = [];
  };
  for (const line of lines) {
    const m = CELL_MARKER_RE.exec(line);
    if (m) {
      finishCurrent();
      const meta = (m[1] ?? '').trim();
      // Identify cell type by leading bracketed tag.
      let kind: ParsedCell['kind'] = 'code';
      let metaRest = meta;
      const tagMatch = /^\[([^\]]+)\]\s*(.*)$/.exec(meta);
      if (tagMatch) {
        const tag = tagMatch[1]!.toLowerCase();
        if (tag === 'markdown' || tag === 'md') kind = 'markdown';
        else if (tag === 'raw') kind = 'raw';
        metaRest = tagMatch[2]!;
      }
      current = { kind, meta: metaRest, source: '' };
      continue;
    }
    if (current === null) {
      // Content before the first cell marker → "header" cell (Jupytext stores
      // notebook-level metadata here). We treat it as raw code source.
      if (headerCell === null) headerCell = { kind: 'code', meta: '', source: '' };
      // Append to header buffer via reusing buf/current mechanism would be
      // awkward; track separately.
      if (headerCell.source === '') headerCell.source = line;
      else headerCell.source += `\n${line}`;
      continue;
    }
    buf.push(line);
  }
  finishCurrent();
  return { headerCell, cells };
}

function stripHashPrefix(source: string): string {
  // Each non-blank line is expected to begin with `# `; blank lines stay
  // blank. A line that doesn't start with `#` is passed through verbatim
  // (Jupytext's tolerance for "bare" markdown lines).
  return source
    .split('\n')
    .map(line => {
      if (line === '') return '';
      if (line.startsWith('# ')) return line.slice(2);
      if (line === '#') return '';
      return line;
    })
    .join('\n');
}

function addHashPrefix(text: string): string {
  return text
    .split('\n')
    .map(line => (line === '' ? '' : `# ${line}`))
    .join('\n');
}

// --- Jupytext -> PT -------------------------------------------------------

export function jupytextToPortableText(input: string): PortableTextDocument {
  const keys = createKeyGenerator('b');
  const out: PortableTextDocument = [];
  const { headerCell, cells } = parseCells(input);
  if (headerCell && headerCell.source.trim() !== '') {
    out.push(
      {
        _type: 'jupytext:header',
        _key: keys(),
        source: headerCell.source,
      } as unknown as PortableTextDocument[number],
    );
  }
  for (const cell of cells) {
    if (cell.kind === 'code') {
      out.push(
        {
          _type: 'code',
          _key: keys(),
          code: cell.source.replace(/^\n+|\n+$/g, ''),
          language: 'python',
          jupytextCellMeta: cell.meta,
          jupytextCellStart: true,
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    if (cell.kind === 'raw') {
      out.push(
        {
          _type: 'jupytext:raw',
          _key: keys(),
          content: stripHashPrefix(cell.source.replace(/^\n+|\n+$/g, '')),
          meta: cell.meta,
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    // markdown cell
    const md = stripHashPrefix(cell.source.replace(/^\n+|\n+$/g, ''));
    const blocks = markdownToPortableText(md, {
      keyGenerator: createKeyGenerator('k'),
    }) as unknown as PortableTextDocument;
    if (blocks.length === 0) {
      out.push(
        {
          _type: 'block',
          _key: keys(),
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', _key: keys(), text: '', marks: [] }],
          jupytextCellStart: true,
          jupytextCellMeta: cell.meta,
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i] as Record<string, unknown>;
      if (i === 0) {
        (block as { jupytextCellStart?: boolean }).jupytextCellStart = true;
        if (cell.meta) (block as { jupytextCellMeta?: string }).jupytextCellMeta = cell.meta;
      }
      out.push(block as unknown as PortableTextDocument[number]);
    }
  }
  return out;
}

// --- PT -> Jupytext -------------------------------------------------------

export function portableTextToJupytext(doc: PortableTextDocument): string {
  const segments: string[] = [];
  let header: string | null = null;
  let mdBuf: PortableTextDocument = [];
  let mdMeta = '';
  const flushMarkdown = (): void => {
    if (mdBuf.length === 0) return;
    const md = portableTextToMarkdown(mdBuf as unknown as TypedObject[]);
    const marker = mdMeta ? `# %% [markdown] ${mdMeta}` : '# %% [markdown]';
    segments.push(`${marker}\n${addHashPrefix(md)}`);
    mdBuf = [];
    mdMeta = '';
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'jupytext:header') {
      header = String((block as { source?: unknown }).source ?? '');
      continue;
    }
    if (t === 'code') {
      flushMarkdown();
      const code = String((block as { code?: unknown }).code ?? '');
      const meta = String((block as { jupytextCellMeta?: unknown }).jupytextCellMeta ?? '');
      const marker = meta ? `# %% ${meta}` : '# %%';
      segments.push(`${marker}\n${code}`);
      continue;
    }
    if (t === 'jupytext:raw') {
      flushMarkdown();
      const content = String((block as { content?: unknown }).content ?? '');
      const meta = String((block as { meta?: unknown }).meta ?? '');
      const marker = meta ? `# %% [raw] ${meta}` : '# %% [raw]';
      segments.push(`${marker}\n${addHashPrefix(content)}`);
      continue;
    }
    // Plain PT block — part of a markdown cell run.
    if ((block as { jupytextCellStart?: boolean }).jupytextCellStart && mdBuf.length > 0) {
      flushMarkdown();
    }
    if ((block as { jupytextCellStart?: boolean }).jupytextCellStart) {
      mdMeta = String((block as { jupytextCellMeta?: unknown }).jupytextCellMeta ?? '');
    }
    mdBuf.push(block);
  }
  flushMarkdown();
  const head = header ? `${header}\n\n` : '';
  return `${head}${segments.join('\n\n')}`;
}

// --- Format ---------------------------------------------------------------

export const jupytextFormat: Format = {
  id: 'jupytext',
  label: 'Jupytext (percent script)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return jupytextToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToJupytext(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    const markers = value.match(/^#\s*%%/gm);
    if (markers) hits += Math.min(3, markers.length);
    if (/^#\s*%%\s*\[markdown\]/m.test(value)) hits += 2;
    if (/^#\s*%%\s*\[raw\]/m.test(value)) hits += 2;
    return Math.min(1, hits * 0.22);
  },
};

export default jupytextFormat;
