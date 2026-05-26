import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * reStructuredText (RST) <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:    underlined with `=`/`-`/`~`/`^`/`"`/`'` for h1..h6
 *  - Bold:        `**bold**`
 *  - Italic:      `*italic*`
 *  - Inline code: ` ``code`` `
 *  - Link:        `` `label <url>`_ ``
 *  - Bullet list: lines starting with `- ` or `* `
 *  - Numbered:    lines starting with `#. `  (auto-numbered)
 *  - Code block:  `.. code-block:: LANG\n\n    indented lines`
 *  - Block quote: a paragraph that follows `:: ` lines (literal) — out of scope
 *                 in this subset; `.. note::` and admonitions are also skipped.
 */

const UNDERLINE_TO_LEVEL: Record<string, number> = {
  '=': 1,
  '-': 2,
  '~': 3,
  '^': 4,
  '"': 5,
  "'": 6,
};

const LEVEL_TO_UNDERLINE = ['=', '-', '~', '^', '"', "'"];

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

// --- PT -> RST -------------------------------------------------------------

function spanToRst(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '``' + text + '``';
  if (decorators.has('em')) text = `*${text}*`;
  if (decorators.has('strong')) text = `**${text}**`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = '`' + text + ' <' + String(def.href ?? '') + '>`_';
    }
  }
  return text;
}

function spansToRst(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToRst(span, markDefs))
    .join('');
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

function blockToRst(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToRst(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) {
      const level = Number(m[1]);
      const char = LEVEL_TO_UNDERLINE[level - 1] ?? '=';
      return `${inner}\n${char.repeat(Math.max(inner.length, 3))}`;
    }
    if (style === 'blockquote') return `    ${inner}`; // indented paragraph
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    const header = language ? `.. code-block:: ${language}` : '.. code-block::';
    const indented = code.split('\n').map(l => `    ${l}`).join('\n');
    return `${header}\n\n${indented}`;
  }
  return '';
}

export function portableTextToRst(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? '#.' : '-';
        run.push(`${marker} ${spansToRst(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToRst(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- RST -> PT -------------------------------------------------------------

function inlineToSpans(
  text: string,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  let current: { text: string, marks: string[], key: string } | null = null;
  const flush = (): void => {
    if (!current) return;
    spans.push({ _type: 'span', _key: keys.span(), text: current.text, marks: current.marks });
    current = null;
  };
  const emit = (chunk: string, marks: string[]): void => {
    const key = marks.join(' ');
    if (current && current.key === key) current.text += chunk;
    else {
      flush();
      current = { text: chunk, marks: [...marks], key };
    }
  };

  // Order matters: longest delimiters first (``…``, **…**) before *…*.
  const re = /``([^`]+)``|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+?)\s<([^>]+)>`_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) emit(match[1], ['code']);
    else if (match[2] !== undefined) emit(match[2], ['strong']);
    else if (match[3] !== undefined) emit(match[3], ['em']);
    else if (match[4] !== undefined && match[5] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[5] });
      emit(match[4], [key]);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) emit(text.slice(lastIndex), []);
  flush();
  return spans;
}

function makeTextBlock(
  text: string,
  style: string,
  keys: Keys,
  listItem?: 'bullet' | 'number',
  level?: number,
): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = inlineToSpans(text, markDefs, keys);
  const block: PortableTextBlock = { _type: 'block', _key: keys.block(), style, markDefs, children };
  if (listItem) {
    block.listItem = listItem;
    block.level = level ?? 1;
  }
  return block;
}

export function rstToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Code block directive: `.. code-block:: LANG`
    const codeOpen = /^\.\. code-block::\s*(\S+)?\s*$/.exec(line);
    if (codeOpen) {
      i += 1;
      while (i < lines.length && lines[i]!.trim() === '') i += 1;
      const code: string[] = [];
      while (i < lines.length && /^(\s{4,})/.test(lines[i]!)) {
        code.push(lines[i]!.replace(/^ {4}/, ''));
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: codeOpen[1] ?? null });
      continue;
    }

    // Heading: a line followed by an underline of the same length.
    const nextLine = lines[i + 1];
    if (
      nextLine !== undefined
      && nextLine.length >= line.length
      && line.trim() !== ''
      && /^([=\-~^"'])\1+$/.test(nextLine)
    ) {
      const char = nextLine[0]!;
      const level = UNDERLINE_TO_LEVEL[char] ?? 1;
      out.push(makeTextBlock(line, `h${level}`, keys));
      i += 2;
      continue;
    }

    // List item
    const bullet = /^([-*])\s+(.+)$/.exec(line);
    const numbered = /^#\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      while (i < lines.length) {
        const ln = lines[i]!;
        const b = /^([-*])\s+(.+)$/.exec(ln);
        const n = /^#\.\s+(.+)$/.exec(ln);
        if (!b && !n) break;
        const text = b ? b[2]! : n![1]!;
        const kind: 'bullet' | 'number' = n ? 'number' : 'bullet';
        out.push(makeTextBlock(text, 'normal', keys, kind, 1));
        i += 1;
      }
      continue;
    }

    // Plain paragraph (gather non-blank lines).
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^\.\. code-block::/.test(next)) break;
      // Stop if the NEXT line is an underline (this paragraph is a heading).
      const after = lines[j + 1];
      if (after !== undefined && /^([=\-~^"'])\1+$/.test(after) && after.length >= next.length) break;
      if (/^([-*]|#\.)\s+/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ----------------------------------------------------------------

export const rstFormat: Format = {
  id: 'rst',
  label: 'reStructuredText',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return rstToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToRst(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^.+\n[=\-~^"']{3,}\s*$/m.test(value)) hits += 2;
    if (/\.\. code-block::/.test(value)) hits += 2;
    if (/`[^`]+\s<[^>]+>`_/.test(value)) hits += 1;
    if (/^#\.\s/m.test(value)) hits += 1;
    if (/^[-*]\s/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default rstFormat;
