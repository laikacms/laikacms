import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * DokuWiki <-> Portable Text.
 *
 * DokuWiki's wiki syntax (https://www.dokuwiki.org/wiki:syntax) is unusual in
 * that **more** equals signs mean a **bigger** heading — the opposite of every
 * other format we ship: `====== H1 ======` is largest, `= H6 =` smallest.
 *
 * Supported subset:
 *  - Headings:    `====== H1 ======` ... `= H6 =`
 *  - Bold:        `**bold**`
 *  - Italic:      `//italic//`
 *  - Underline:   `__underline__`
 *  - Strike:      `<del>strike</del>`
 *  - Inline code: `''code''`
 *  - Link:        `[[https://url|label]]`  (also bare `[[url]]`)
 *  - Bullet list: lines beginning with `  *` (two-space indent per level)
 *  - Numbered:    lines beginning with `  -`
 *  - Code block:  `<code lang>` ... `</code>`
 *  - Block quote: lines beginning with `> `
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

// --- PT -> DokuWiki -------------------------------------------------------

function spanToDoku(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `''${text}''`;
  if (decorators.has('strike-through')) text = `<del>${text}</del>`;
  if (decorators.has('underline')) text = `__${text}__`;
  if (decorators.has('em')) text = `//${text}//`;
  if (decorators.has('strong')) text = `**${text}**`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === href ? `[[${href}]]` : `[[${href}|${text}]]`;
    }
  }
  return text;
}

function spansToDoku(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToDoku(span, markDefs))
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

function blockToDoku(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToDoku(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) {
      // DokuWiki inverts the level: 7-level=count of `=` chars used.
      const count = 7 - Number(m[1]);
      const eq = '='.repeat(count);
      return `${eq} ${inner} ${eq}`;
    }
    if (style === 'blockquote') {
      return inner.split('\n').map(l => `> ${l}`).join('\n');
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    const tag = language ? `<code ${language}>` : '<code>';
    return `${tag}\n${code}\n</code>`;
  }
  return '';
}

export function portableTextToDokuwiki(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? '-' : '*';
        const level = typeof b.level === 'number' && b.level > 0 ? b.level : 1;
        run.push(`${'  '.repeat(level)}${marker} ${spansToDoku(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToDoku(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- DokuWiki -> PT -------------------------------------------------------

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

  // Order: link first, then `''code''`, double-delimiters (** __ //), then `<del>`.
  const re =
    /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]|''([^'\n]+)''|\*\*([^*\n]+)\*\*|\/\/([^/\n]+)\/\/|__([^_\n]+)__|<del>([^<]+)<\/del>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[1] });
      emit(match[2] ?? match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['code']);
    else if (match[4] !== undefined) emit(match[4], ['strong']);
    else if (match[5] !== undefined) emit(match[5], ['em']);
    else if (match[6] !== undefined) emit(match[6], ['underline']);
    else if (match[7] !== undefined) emit(match[7], ['strike-through']);
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

export function dokuwikiToPortableText(input: string): PortableTextDocument {
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

    // Code block: `<code [lang]>` ... `</code>`
    const codeOpen = /^<code(?:\s+(\S+))?\s*>$/.exec(line);
    if (codeOpen) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== '</code>') {
        codeLines.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: codeLines.join('\n'), language: codeOpen[1] ?? null });
      i += 1; // skip `</code>`
      continue;
    }

    // Heading: leading `=` chars (≥1 ≤6), trailing `=` chars of same count.
    const heading = /^(={1,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (heading) {
      const count = heading[1]!.length;
      const level = 7 - count; // invert: 6 = → h1; 1 = → h6
      out.push(makeTextBlock(heading[2]!, `h${level}`, keys));
      i += 1;
      continue;
    }

    // Block quote
    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        quote.push(lines[i]!.slice(2));
        i += 1;
      }
      out.push(makeTextBlock(quote.join(' '), 'blockquote', keys));
      continue;
    }

    // List: `  * item` (bullet) or `  - item` (numbered), with indent = level*2.
    const listMatch = /^(\s+)([*-])\s+(.+)$/.exec(line);
    if (listMatch) {
      while (i < lines.length) {
        const m = /^(\s+)([*-])\s+(.+)$/.exec(lines[i]!);
        if (!m) break;
        const level = Math.max(1, Math.floor(m[1]!.length / 2));
        const listItem: 'bullet' | 'number' = m[2] === '-' ? 'number' : 'bullet';
        out.push(makeTextBlock(m[3]!, 'normal', keys, listItem, level));
        i += 1;
      }
      continue;
    }

    // Plain paragraph: consume non-blank lines until a structural marker.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(={1,6}\s|<code\b|>\s|\s+[*-]\s)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ----------------------------------------------------------------

export const dokuwikiFormat: Format = {
  id: 'dokuwiki',
  label: 'DokuWiki',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return dokuwikiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToDokuwiki(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^={1,6}\s.+?\s={1,6}\s*$/m.test(value)) hits += 2;
    if (/\/\/[^/\n]+\/\//.test(value)) hits += 1;
    if (/<code(?:\s+\S+)?\s*>/.test(value)) hits += 2;
    if (/\[\[[^\]\n|]+(?:\|[^\]\n]+)?\]\]/.test(value)) hits += 1;
    if (/''[^'\n]+''/.test(value)) hits += 1;
    if (/^\s+[*-]\s/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default dokuwikiFormat;
