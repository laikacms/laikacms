import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Quill Delta JSON <-> Portable Text.
 *
 * Quill stores documents as a sequence of `{ insert, attributes }` ops. Inline
 * attributes attach to the inserted text; line-level attributes attach to the
 * trailing `\n` that closes a block.
 *
 * Supported inline attributes:
 *  - `bold` → strong
 *  - `italic` → em
 *  - `underline` → underline
 *  - `strike` → strike-through
 *  - `code` → code
 *  - `script: 'sub' | 'super'` → sub / sup
 *  - `link: '<url>'` → link annotation
 *
 * Supported line-level attributes:
 *  - `header: 1..6` → h1..h6
 *  - `list: 'bullet' | 'ordered' | 'checked' | 'unchecked'` → list block
 *  - `blockquote: true` → blockquote
 *  - `code-block: true` → code block (lines accumulate until the next non-code line)
 */

interface Keys {
  block: () => string;
  span: () => string;
  mark: () => string;
}

function newKeys(): Keys {
  return {
    block: createKeyGenerator('b'),
    span: createKeyGenerator('s'),
    mark: createKeyGenerator('m'),
  };
}

interface QuillOp {
  insert: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

// --- PT -> Quill Delta ----------------------------------------------------

function spanToOps(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): QuillOp[] {
  const attrs: Record<string, unknown> = {};
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('strong')) attrs.bold = true;
  if (decorators.has('em')) attrs.italic = true;
  if (decorators.has('underline')) attrs.underline = true;
  if (decorators.has('strike-through')) attrs.strike = true;
  if (decorators.has('code')) attrs.code = true;
  if (decorators.has('sub')) attrs.script = 'sub';
  if (decorators.has('sup')) attrs.script = 'super';
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') attrs.link = String(def.href ?? '');
  }
  const insert = span.text ?? '';
  if (insert === '') return [];
  return [Object.keys(attrs).length ? { insert, attributes: attrs } : { insert }];
}

function spansToOps(block: PortableTextBlock): QuillOp[] {
  const markDefs = block.markDefs ?? [];
  const out: QuillOp[] = [];
  for (const child of block.children ?? []) {
    if ((child as { _type?: string })._type !== 'span') continue;
    out.push(...spanToOps(child as PortableTextSpan, markDefs));
  }
  return out;
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

export function portableTextToQuill(doc: PortableTextDocument): { ops: QuillOp[] } {
  const ops: QuillOp[] = [];
  const closeLine = (attrs?: Record<string, unknown>): void => {
    ops.push(attrs ? { insert: '\n', attributes: attrs } : { insert: '\n' });
  };

  for (const block of doc) {
    const type = (block as { _type?: string })._type;
    if (type === 'block') {
      const tb = block as PortableTextBlock;
      const style = tb.style ?? 'normal';
      ops.push(...spansToOps(tb));
      const m = /^h([1-6])$/.exec(style);
      if (m) closeLine({ header: Number(m[1]) });
      else if (style === 'blockquote') closeLine({ blockquote: true });
      else if (isListBlock(tb)) {
        closeLine({ list: tb.listItem === 'number' ? 'ordered' : 'bullet' });
      } else {
        closeLine();
      }
      continue;
    }
    if (type === 'code') {
      const code = String((block as Record<string, unknown>).code ?? '');
      const lines = code.split('\n');
      for (const line of lines) {
        if (line !== '') ops.push({ insert: line });
        ops.push({ insert: '\n', attributes: { 'code-block': true } });
      }
      continue;
    }
  }
  return { ops };
}

// --- Quill Delta -> PT ----------------------------------------------------

interface LineSpan {
  text: string;
  marks: string[];
}

function decoratorsFromAttrs(attrs: Record<string, unknown> | undefined): string[] {
  if (!attrs) return [];
  const out: string[] = [];
  if (attrs.bold) out.push('strong');
  if (attrs.italic) out.push('em');
  if (attrs.underline) out.push('underline');
  if (attrs.strike) out.push('strike-through');
  if (attrs.code) out.push('code');
  if (attrs.script === 'sub') out.push('sub');
  if (attrs.script === 'super') out.push('sup');
  return out;
}

export function quillToPortableText(input: string | { ops?: QuillOp[] }): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  let data: { ops?: QuillOp[] } | null;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input) as { ops?: QuillOp[] };
    } catch {
      return out;
    }
  } else {
    data = input;
  }
  if (!data || !Array.isArray(data.ops)) return out;

  // Accumulate inline spans for the current line until we see a `\n`.
  let currentSpans: LineSpan[] = [];
  let currentMarkDefs: PortableTextMarkDefinition[] = [];
  let codeBuffer: string[] | null = null;

  const flushTextLine = (lineAttrs: Record<string, unknown> | undefined): void => {
    const header = lineAttrs?.header;
    const list = lineAttrs?.list;
    const blockquote = lineAttrs?.blockquote;
    let style = 'normal';
    let listItem: 'bullet' | 'number' | undefined;
    if (typeof header === 'number' && header >= 1 && header <= 6) style = `h${header}`;
    else if (blockquote === true) style = 'blockquote';
    if (list === 'ordered') listItem = 'number';
    else if (list === 'bullet' || list === 'checked' || list === 'unchecked') listItem = 'bullet';

    const children = currentSpans.map(s => ({
      _type: 'span' as const,
      _key: keys.span(),
      text: s.text,
      marks: s.marks,
    })) as PortableTextSpan[];
    const block: PortableTextBlock = {
      _type: 'block',
      _key: keys.block(),
      style,
      markDefs: currentMarkDefs,
      children,
    };
    if (listItem) {
      block.listItem = listItem;
      block.level = 1;
    }
    out.push(block);
    currentSpans = [];
    currentMarkDefs = [];
  };

  for (const op of data.ops) {
    if (typeof op.insert !== 'string') continue; // skip embeds for now
    const text = op.insert;
    const attrs = op.attributes;
    let cursor = 0;
    while (cursor < text.length) {
      const newline = text.indexOf('\n', cursor);
      if (newline === -1) {
        // Plain inline run.
        const chunk = text.slice(cursor);
        const decorators = decoratorsFromAttrs(attrs);
        const linkHref = typeof attrs?.link === 'string' ? attrs.link : null;
        const marks: string[] = [...decorators];
        if (linkHref) {
          const key = keys.mark();
          currentMarkDefs.push({ _type: 'link', _key: key, href: linkHref });
          marks.push(key);
        }
        if (codeBuffer !== null) codeBuffer[codeBuffer.length - 1] += chunk;
        else currentSpans.push({ text: chunk, marks });
        cursor = text.length;
        continue;
      }
      // Text before the newline.
      if (newline > cursor) {
        const chunk = text.slice(cursor, newline);
        const decorators = decoratorsFromAttrs(attrs);
        const linkHref = typeof attrs?.link === 'string' ? attrs.link : null;
        const marks: string[] = [...decorators];
        if (linkHref) {
          const key = keys.mark();
          currentMarkDefs.push({ _type: 'link', _key: key, href: linkHref });
          marks.push(key);
        }
        if (codeBuffer !== null) codeBuffer[codeBuffer.length - 1] += chunk;
        else currentSpans.push({ text: chunk, marks });
      }
      // Line ends. The attributes on THIS op apply to the line.
      if (attrs?.['code-block']) {
        // The line's text may have been buffered as styled spans before we
        // knew it was code; collapse those into plain text and seed/extend
        // the code buffer with this line, then open a fresh slot for the
        // next line's content (any subsequent inline ops will append to it).
        const pendingLine = currentSpans.map(s => s.text).join('');
        currentSpans = [];
        currentMarkDefs = [];
        if (codeBuffer === null) codeBuffer = [pendingLine];
        else codeBuffer[codeBuffer.length - 1] = (codeBuffer[codeBuffer.length - 1] ?? '') + pendingLine;
        codeBuffer.push('');
      } else {
        if (codeBuffer !== null) {
          // Trailing empty strings come from the loop adding a new line each turn;
          // drop them so the emitted code matches the inserted text.
          while (codeBuffer.length && codeBuffer[codeBuffer.length - 1] === '') codeBuffer.pop();
          out.push({
            _type: 'code',
            _key: keys.block(),
            code: codeBuffer.join('\n'),
            language: null,
          });
          codeBuffer = null;
        }
        flushTextLine(attrs);
      }
      cursor = newline + 1;
    }
  }

  // Trailing buffered code or text.
  if (codeBuffer !== null) {
    while (codeBuffer.length && codeBuffer[codeBuffer.length - 1] === '') codeBuffer.pop();
    out.push({ _type: 'code', _key: keys.block(), code: codeBuffer.join('\n'), language: null });
  }
  if (currentSpans.length > 0) flushTextLine(undefined);

  return out;
}

// --- Format ---------------------------------------------------------------

export const quillFormat: Format = {
  id: 'quill',
  label: 'Quill Delta',

  toPortableText(value: string): PortableTextDocument {
    if (value.trim() === '') return [];
    return quillToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(portableTextToQuill(doc), null, 2);
  },

  detect(value: string): number {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return 0;
    try {
      const parsed = JSON.parse(trimmed) as { ops?: unknown[] };
      if (Array.isArray(parsed.ops)) {
        const looksQuill = parsed.ops.every(
          op =>
            !!op
            && typeof op === 'object'
            && 'insert' in (op as object)
            && (typeof (op as { insert?: unknown }).insert === 'string'
              || typeof (op as { insert?: unknown }).insert === 'object'),
        );
        return looksQuill ? 1 : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  },
};

export default quillFormat;
