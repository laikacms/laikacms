import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Setext-only Markdown <-> Portable Text.
 *
 * The original (pre-Gruber-ATX) flavour of Markdown only had setext-style
 * underlined headings — no `#`/`##` ATX form. This format mirrors that
 * intentionally minimal feel:
 *
 *  - Headings:    `Title\n=====` (h1)  /  `Title\n-----` (h2). Only two levels.
 *  - Bold:        `**bold**`
 *  - Italic:      `*italic*`
 *  - Inline code: `` `code` ``
 *  - Link:        `[label](url)`
 *  - Bullet:      `- item` / `* item`
 *  - Numbered:    `1. item`
 *  - Block quote: `> text`
 *  - Code block:  four-space-indented paragraphs (no fences)
 *
 * h3..h6 collapse to bold-italic paragraphs (the format only knows two heading levels).
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

// --- PT -> Setext ---------------------------------------------------------

function spanToSetext(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '`' + text + '`';
  if (decorators.has('em')) text = `*${text}*`;
  if (decorators.has('strong')) text = `**${text}**`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `[${text}](${String(def.href ?? '')})`;
    }
  }
  return text;
}

function spansToSetext(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToSetext(span, markDefs))
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

function blockToSetext(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToSetext(tb);
    if (style === 'h1') return `${inner}\n${'='.repeat(Math.max(inner.length, 3))}`;
    if (style === 'h2') return `${inner}\n${'-'.repeat(Math.max(inner.length, 3))}`;
    if (/^h[3-6]$/.test(style)) return `***${inner}***`; // bold-italic flatten
    if (style === 'blockquote') return inner.split('\n').map(l => `> ${l}`).join('\n');
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return code.split('\n').map(l => `    ${l}`).join('\n');
  }
  return '';
}

export function portableTextToSetext(doc: PortableTextDocument): string {
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
          run.push(`${counter}. ${spansToSetext(b)}`);
          counter += 1;
        } else {
          counter = 1;
          run.push(`- ${spansToSetext(b)}`);
        }
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToSetext(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Setext -> PT ---------------------------------------------------------

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

  // Order: link, code, `**…**` (longer than `*…*`), then `*…*`.
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined && match[2] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[2] });
      emit(match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['code']);
    else if (match[4] !== undefined) emit(match[4], ['strong']);
    else if (match[5] !== undefined) emit(match[5], ['em']);
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

export function setextToPortableText(input: string): PortableTextDocument {
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

    // Setext heading: a line followed by `===` (h1) or `---` (h2) of equal-or-greater length.
    const nextLine = lines[i + 1];
    if (
      nextLine !== undefined
      && nextLine.length >= line.length
      && line.trim() !== ''
      && /^(={3,}|-{3,})\s*$/.test(nextLine)
    ) {
      const style = nextLine[0] === '=' ? 'h1' : 'h2';
      out.push(makeTextBlock(line, style, keys));
      i += 2;
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

    // List items
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      while (i < lines.length) {
        const ln = lines[i]!;
        const b = /^[-*+]\s+(.+)$/.exec(ln);
        const n = /^\d+\.\s+(.+)$/.exec(ln);
        if (!b && !n) break;
        const text = b ? b[1]! : n![1]!;
        const kind: 'bullet' | 'number' = n ? 'number' : 'bullet';
        out.push(makeTextBlock(text, 'normal', keys, kind));
        i += 1;
      }
      continue;
    }

    // 4-space-indented code block (every non-empty line indented).
    if (/^ {4}/.test(line)) {
      const codeLines: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]!) || lines[i] === '')) {
        if (lines[i] === '' && (i + 1 >= lines.length || !/^ {4}/.test(lines[i + 1]!))) break;
        codeLines.push(lines[i]!.replace(/^ {4}/, ''));
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: codeLines.join('\n'), language: null });
      continue;
    }

    // Plain paragraph.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(>\s|[-*+]\s|\d+\.\s|\s{4})/.test(next)) break;
      // Stop if the next line is a setext underline (this paragraph is a heading).
      const after = lines[j + 1];
      if (after !== undefined && /^(={3,}|-{3,})\s*$/.test(after) && after.length >= next.length) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const setextFormat: Format = {
  id: 'setext',
  label: 'Setext Markdown',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return setextToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToSetext(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^.+\n={3,}\s*$/m.test(value)) hits += 2;
    if (/^.+\n-{3,}\s*$/m.test(value)) hits += 2;
    // Lower score if it ALSO has ATX `#` headings — that's not setext-only.
    if (/^#{1,6}\s/m.test(value)) hits -= 1;
    if (/\*\*[^*\n]+\*\*/.test(value)) hits += 1;
    if (/\[[^\]\n]+\]\([^)\s]+\)/.test(value)) hits += 1;
    return Math.max(0, Math.min(1, hits * 0.2));
  },
};

export default setextFormat;
