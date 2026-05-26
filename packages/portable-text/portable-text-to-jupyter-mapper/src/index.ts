import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * Jupyter Notebook (`.ipynb`) <-> Portable Text.
 *
 * A notebook is a JSON document with a `cells` array. Each cell has a
 * `cell_type` of `markdown`, `code`, or `raw`. We map them to PT:
 *
 *   - **markdown cell**: parsed with `@portabletext/markdown`; its block(s)
 *     flow into the output document. The leading cell of each markdown run
 *     is tagged with a `jupyterCellStart` flag so PT → Notebook can group
 *     consecutive blocks back into one cell.
 *   - **code cell**: emitted as a single PT `code` block. The cell's
 *     `language` (or the notebook's kernel language) is preserved, and the
 *     raw `outputs` JSON array is captured on the PT block.
 *   - **raw cell**: emitted as a custom `jupyter:raw` block with `mime` (the
 *     `metadata.raw_mimetype`, if any) and `content` (the cell source).
 *
 * Notebook metadata (kernel info, language info) is preserved on a single
 * `jupyter:notebook-meta` block at the top of the document; the PT → Notebook
 * pass reads it back to keep `nbformat`, `nbformat_minor`, and the kernel
 * metadata stable.
 *
 * The `source` field of every cell may be either a single string or an array
 * of strings (one per line). Both forms are accepted on parse; we normalise
 * to a single string. On serialize we always emit an array (the canonical
 * Jupyter form).
 */

interface JupyterCell {
  cell_type: 'markdown' | 'code' | 'raw';
  metadata?: Record<string, unknown>;
  source?: string | string[];
  outputs?: unknown[];
  execution_count?: number | null;
}

interface JupyterNotebook {
  cells?: JupyterCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

function joinSource(src: string | string[] | undefined): string {
  if (Array.isArray(src)) return src.join('');
  return src ?? '';
}
function splitSource(text: string): string[] {
  // Canonical Jupyter form: each entry ends with \n, except possibly the last.
  if (text === '') return [];
  const lines = text.split('\n');
  return lines.map((l, i) => (i === lines.length - 1 ? l : `${l}\n`));
}

function languageFromMetadata(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const lang = (meta as { language_info?: { name?: unknown } }).language_info?.name;
  if (typeof lang === 'string' && lang) return lang;
  const kernel = (meta as { kernelspec?: { language?: unknown } }).kernelspec?.language;
  if (typeof kernel === 'string' && kernel) return kernel;
  return null;
}

// --- Notebook -> PT -------------------------------------------------------

export function jupyterToPortableText(input: string | JupyterNotebook): PortableTextDocument {
  const keys = createKeyGenerator('b');
  let nb: JupyterNotebook;
  if (typeof input === 'string') {
    try {
      nb = JSON.parse(input) as JupyterNotebook;
    } catch {
      return [];
    }
  } else {
    nb = input;
  }
  const out: PortableTextDocument = [];
  const notebookLang = languageFromMetadata(nb.metadata);

  // Notebook metadata always goes first so round-trip can restore it.
  out.push(
    {
      _type: 'jupyter:notebook-meta',
      _key: keys(),
      metadata: nb.metadata ?? {},
      nbformat: typeof nb.nbformat === 'number' ? nb.nbformat : 4,
      nbformat_minor: typeof nb.nbformat_minor === 'number' ? nb.nbformat_minor : 5,
    } as unknown as PortableTextDocument[number],
  );

  for (const cell of nb.cells ?? []) {
    if (cell.cell_type === 'code') {
      const language = languageFromMetadata(cell.metadata) ?? notebookLang;
      out.push(
        {
          _type: 'code',
          _key: keys(),
          code: joinSource(cell.source),
          language: language ?? null,
          outputs: cell.outputs ?? [],
          execution_count: cell.execution_count ?? null,
          jupyterCellStart: true,
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    if (cell.cell_type === 'raw') {
      const mime = (cell.metadata as { raw_mimetype?: unknown } | undefined)?.raw_mimetype;
      out.push(
        {
          _type: 'jupyter:raw',
          _key: keys(),
          content: joinSource(cell.source),
          mime: typeof mime === 'string' ? mime : null,
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    // markdown cell.
    const blocks = markdownToPortableText(joinSource(cell.source), {
      keyGenerator: createKeyGenerator('k'),
    }) as unknown as PortableTextDocument;
    if (blocks.length === 0) {
      // Preserve empty markdown cells so they round-trip.
      out.push(
        {
          _type: 'block',
          _key: keys(),
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', _key: keys(), text: '', marks: [] }],
          jupyterCellStart: true,
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i] as Record<string, unknown>;
      if (i === 0) (block as { jupyterCellStart?: boolean }).jupyterCellStart = true;
      out.push(block as unknown as PortableTextDocument[number]);
    }
  }
  return out;
}

// --- PT -> Notebook -------------------------------------------------------

export function portableTextToJupyter(doc: PortableTextDocument): string {
  let metadata: Record<string, unknown> = {};
  let nbformat = 4;
  let nbformatMinor = 5;
  const cells: JupyterCell[] = [];

  // Buffer for markdown cell content (PT blocks that should be re-serialised
  // back to Markdown via `@portabletext/markdown`).
  let mdBuf: PortableTextDocument = [];
  const flushMarkdown = (): void => {
    if (mdBuf.length === 0) return;
    const md = portableTextToMarkdown(mdBuf as unknown as TypedObject[]);
    cells.push({
      cell_type: 'markdown',
      metadata: {},
      source: splitSource(md),
    });
    mdBuf = [];
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'jupyter:notebook-meta') {
      const m = (block as { metadata?: unknown }).metadata;
      metadata = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {};
      const fmt = (block as { nbformat?: unknown }).nbformat;
      if (typeof fmt === 'number') nbformat = fmt;
      const fmtMinor = (block as { nbformat_minor?: unknown }).nbformat_minor;
      if (typeof fmtMinor === 'number') nbformatMinor = fmtMinor;
      continue;
    }
    if (t === 'code') {
      flushMarkdown();
      const language = (block as { language?: unknown }).language;
      const outputs = (block as { outputs?: unknown }).outputs;
      const code = String((block as { code?: unknown }).code ?? '');
      const executionCount = (block as { execution_count?: unknown }).execution_count;
      const cellMeta: Record<string, unknown> = {};
      if (typeof language === 'string' && language) {
        cellMeta.language_info = { name: language };
      }
      cells.push({
        cell_type: 'code',
        metadata: cellMeta,
        source: splitSource(code),
        outputs: Array.isArray(outputs) ? (outputs as unknown[]) : [],
        execution_count: typeof executionCount === 'number' ? executionCount : null,
      });
      continue;
    }
    if (t === 'jupyter:raw') {
      flushMarkdown();
      const mime = (block as { mime?: unknown }).mime;
      const content = String((block as { content?: unknown }).content ?? '');
      const cellMeta: Record<string, unknown> = {};
      if (typeof mime === 'string' && mime) cellMeta.raw_mimetype = mime;
      cells.push({
        cell_type: 'raw',
        metadata: cellMeta,
        source: splitSource(content),
      });
      continue;
    }
    // Markdown blocks: group into cells; a `jupyterCellStart` flag closes the
    // previous cell before this block joins a new buffer.
    if ((block as { jupyterCellStart?: boolean }).jupyterCellStart && mdBuf.length > 0) {
      flushMarkdown();
    }
    mdBuf.push(block);
  }
  flushMarkdown();

  const notebook: JupyterNotebook = {
    cells,
    metadata,
    nbformat,
    nbformat_minor: nbformatMinor,
  };
  return JSON.stringify(notebook);
}

// --- Format ---------------------------------------------------------------

export const jupyterFormat: Format = {
  id: 'jupyter',
  label: 'Jupyter Notebook',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return jupyterToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToJupyter(doc);
  },

  detect(value: string): number {
    const s = value.trim();
    if (!s.startsWith('{')) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return 0;
    }
    if (typeof parsed !== 'object' || parsed === null) return 0;
    const obj = parsed as Record<string, unknown>;
    let hits = 0;
    if (Array.isArray(obj.cells)) hits += 2;
    if (typeof obj.nbformat === 'number') hits += 2;
    if (typeof obj.metadata === 'object' && obj.metadata !== null) hits += 1;
    if (Array.isArray(obj.cells)) {
      const first = obj.cells[0] as Record<string, unknown> | undefined;
      if (first && typeof first.cell_type === 'string') hits += 1;
    }
    return Math.min(1, hits * 0.22);
  },
};

export default jupyterFormat;
