import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * TWiki / Foswiki Topic Markup Language (TML) <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:    `---+ H1` ... `---++++++ H6`  (count of `+` after `---`)
 *  - Bold:        `*bold*`
 *  - Italic:      `_italic_`
 *  - Bold-italic: `__bold-italic__`
 *  - Fixed:       `=fixed=`        (mapped to the code decorator)
 *  - Bold-fixed:  `==bold-fixed==` (bold + code)
 *  - Link:        `[[url][label]]`  (also bare `[[url]]`)
 *  - Bullet:      `   * item`   (three-space indent for the first level)
 *  - Numbered:    `   1 item`   (TWiki uses bare digits, no period)
 *  - Code block:  `<verbatim>` ... `</verbatim>`
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

// --- PT -> TWiki ----------------------------------------------------------

function spanToTwiki(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  // TWiki has a combined `==…==` for bold-fixed (strong + code) — emit that
  // explicitly so it round-trips cleanly.
  if (decorators.has('code') && decorators.has('strong')) text = `==${text}==`;
  else if (decorators.has('code')) text = `=${text}=`;
  else if (decorators.has('em') && decorators.has('strong')) text = `__${text}__`;
  else if (decorators.has('em')) text = `_${text}_`;
  else if (decorators.has('strong')) text = `*${text}*`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === href ? `[[${href}]]` : `[[${href}][${text}]]`;
    }
  }
  return text;
}

function spansToTwiki(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToTwiki(span, markDefs))
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

function blockToTwiki(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToTwiki(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `${'---' + '+'.repeat(Number(m[1]))} ${inner}`;
    if (style === 'blockquote') return inner.split('\n').map(l => `> ${l}`).join('\n');
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `<verbatim>\n${code}\n</verbatim>`;
  }
  return '';
}

export function portableTextToTwiki(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const level = typeof b.level === 'number' && b.level > 0 ? b.level : 1;
        const indent = '   '.repeat(level);
        if (b.listItem === 'number') {
          run.push(`${indent}${counter} ${spansToTwiki(b)}`);
          counter += 1;
        } else {
          counter = 1;
          run.push(`${indent}* ${spansToTwiki(b)}`);
        }
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToTwiki(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- TWiki -> PT ----------------------------------------------------------

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

  // Order: link, then double-delim marks (== __), then single-delim (= * _).
  const re = /\[\[([^\]\n]+)\](?:\[([^\]\n]+)\])?\]|==([^=\n]+)==|__([^_\n]+)__|=([^=\n]+)=|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[1] });
      emit(match[2] ?? match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['strong', 'code']);
    else if (match[4] !== undefined) emit(match[4], ['strong', 'em']);
    else if (match[5] !== undefined) emit(match[5], ['code']);
    else if (match[6] !== undefined) emit(match[6], ['strong']);
    else if (match[7] !== undefined) emit(match[7], ['em']);
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

export function twikiToPortableText(input: string): PortableTextDocument {
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

    // `<verbatim>` ... `</verbatim>` code block.
    if (/^<verbatim>\s*$/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^<\/verbatim>\s*$/.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: null });
      i += 1;
      continue;
    }

    // Heading: `---+`...`---++++++` followed by space.
    const heading = /^---(\+{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(makeTextBlock(heading[2]!, `h${level}`, keys));
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

    // List item: leading spaces (multiple of three) then `*` or a bare digit.
    const listMatch = /^((?: {3})+)(\*|\d+)\s+(.+)$/.exec(line);
    if (listMatch) {
      while (i < lines.length) {
        const m = /^((?: {3})+)(\*|\d+)\s+(.+)$/.exec(lines[i]!);
        if (!m) break;
        const level = m[1]!.length / 3;
        const listItem: 'bullet' | 'number' = /^\d+$/.test(m[2]!) ? 'number' : 'bullet';
        out.push(makeTextBlock(m[3]!, 'normal', keys, listItem, level));
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
      if (/^(---\+{1,6}\s|>\s|<verbatim>$|(?: {3})+(?:\*|\d+)\s)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const twikiFormat: Format = {
  id: 'twiki',
  label: 'TWiki / Foswiki',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return twikiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTwiki(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^---\+{1,6}\s/m.test(value)) hits += 2;
    if (/<verbatim>/i.test(value)) hits += 2;
    if (/==[^=\n]+==/.test(value)) hits += 1;
    if (/__[^_\n]+__/.test(value)) hits += 1;
    if (/=[^=\n\s][^=\n]*=/.test(value)) hits += 1;
    if (/\[\[[^\]\n]+\](?:\[[^\]\n]+\])?\]/.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default twikiFormat;
