import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Trac WikiFormatting <-> Portable Text.
 *
 * Trac's wiki syntax (https://trac.edgewall.org/wiki/WikiFormatting) is widely
 * used by the Trac issue tracker and several derivative tools.
 *
 * Supported subset:
 *  - Headings:    `= H1 =` ... `====== H6 ======`
 *  - Bold:        `'''bold'''`
 *  - Italic:      `''italic''`
 *  - Underline:   `__underline__`
 *  - Strike:      `~~strike~~`
 *  - Superscript: `^sup^`
 *  - Subscript:   `,,sub,,`
 *  - Inline code: `` `code` `` or `{{{code}}}` (single line)
 *  - Link:        `[http://url label]` (whitespace separates url & label)
 *  - Bullet:      ` * item`  (leading space required)
 *  - Numbered:    ` 1. item`
 *  - Block quote: `> text`
 *  - Code block:  `{{{` ... `}}}` on their own lines
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

// --- PT -> Trac -----------------------------------------------------------

function spanToTrac(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '`' + text + '`';
  if (decorators.has('sub')) text = `,,${text},,`;
  if (decorators.has('sup')) text = `^${text}^`;
  if (decorators.has('strike-through')) text = `~~${text}~~`;
  if (decorators.has('underline')) text = `__${text}__`;
  if (decorators.has('em')) text = `''${text}''`;
  if (decorators.has('strong')) text = `'''${text}'''`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === href ? `[${href}]` : `[${href} ${text}]`;
    }
  }
  return text;
}

function spansToTrac(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToTrac(span, markDefs))
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

function blockToTrac(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToTrac(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) {
      const eq = '='.repeat(Number(m[1]));
      return `${eq} ${inner} ${eq}`;
    }
    if (style === 'blockquote') {
      return inner.split('\n').map(l => `> ${l}`).join('\n');
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `{{{\n${code}\n}}}`;
  }
  return '';
}

export function portableTextToTrac(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        if (b.listItem === 'number') {
          run.push(` ${counter}. ${spansToTrac(b)}`);
          counter += 1;
        } else {
          counter = 1;
          run.push(` * ${spansToTrac(b)}`);
        }
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToTrac(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Trac -> PT -----------------------------------------------------------

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

  // Order: link `[url label]` first, then `'''bold'''` (longest delimiter)
  // before `''italic''`, then the other double-delim marks, then `,,sub,,`,
  // `^sup^`, single-backtick code, and `{{{inline code}}}`.
  const re =
    /\[([^\s\]]+)(?:\s+([^\]\n]+))?\]|'''([^'\n]+)'''|''([^'\n]+)''|__([^_\n]+)__|~~([^~\n]+)~~|,,([^,\n]+),,|\^([^^\n]+)\^|`([^`\n]+)`|\{\{\{([^}\n]+)\}\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[1] });
      emit(match[2] ?? match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['strong']);
    else if (match[4] !== undefined) emit(match[4], ['em']);
    else if (match[5] !== undefined) emit(match[5], ['underline']);
    else if (match[6] !== undefined) emit(match[6], ['strike-through']);
    else if (match[7] !== undefined) emit(match[7], ['sub']);
    else if (match[8] !== undefined) emit(match[8], ['sup']);
    else if (match[9] !== undefined) emit(match[9], ['code']);
    else if (match[10] !== undefined) emit(match[10], ['code']);
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
): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = inlineToSpans(text, markDefs, keys);
  const block: PortableTextBlock = { _type: 'block', _key: keys.block(), style, markDefs, children };
  if (listItem) {
    block.listItem = listItem;
    block.level = 1;
  }
  return block;
}

export function tracToPortableText(input: string): PortableTextDocument {
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

    // Multi-line code block `{{{` / `}}}` each on their own line.
    if (line.trim() === '{{{') {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && lines[i]!.trim() !== '}}}') {
        code.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: null });
      i += 1;
      continue;
    }

    // Heading: leading `=` run, trailing matching `=` run.
    const heading = /^(={1,6})\s+(.+?)\s+\1\s*$/.exec(line);
    if (heading) {
      out.push(makeTextBlock(heading[2]!, `h${heading[1]!.length}`, keys));
      i += 1;
      continue;
    }

    // Block quote: lines starting with `> `.
    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        quote.push(lines[i]!.slice(2));
        i += 1;
      }
      out.push(makeTextBlock(quote.join(' '), 'blockquote', keys));
      continue;
    }

    // List items: leading whitespace then `*` / `N.`.
    const bullet = /^\s+\*\s+(.+)$/.exec(line);
    const numbered = /^\s+\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      while (i < lines.length) {
        const ln = lines[i]!;
        const b = /^\s+\*\s+(.+)$/.exec(ln);
        const n = /^\s+\d+\.\s+(.+)$/.exec(ln);
        if (!b && !n) break;
        const text = b ? b[1]! : n![1]!;
        const kind: 'bullet' | 'number' = n ? 'number' : 'bullet';
        out.push(makeTextBlock(text, 'normal', keys, kind));
        i += 1;
      }
      continue;
    }

    // Plain paragraph.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(={1,6}\s|>\s|\s+(?:\*|\d+\.)\s|\{\{\{$|\}\}\}$)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const tracFormat: Format = {
  id: 'trac',
  label: 'Trac WikiFormatting',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return tracToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTrac(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^={1,6}\s.+?\s={1,6}\s*$/m.test(value)) hits += 2;
    if (/'''[^'\n]+'''/.test(value)) hits += 1;
    if (/''[^'\n]+''/.test(value)) hits += 1;
    if (/,,[^,\n]+,,/.test(value)) hits += 1;
    if (/\^[^^\n]+\^/.test(value)) hits += 1;
    if (/\{\{\{[\s\S]+?\}\}\}/.test(value)) hits += 1;
    if (/^\s+(?:\*|\d+\.)\s/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default tracFormat;
