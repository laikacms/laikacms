import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Discord markdown <-> Portable Text.
 *
 * Discord uses a CommonMark-ish dialect with a few extras:
 *  - Headings:    `# H1`, `## H2`, `### H3`   (only three levels)
 *  - Bold:        `**bold**`
 *  - Italic:      `*italic*`
 *  - Underline:   `__underline__`
 *  - Strike:      `~~strike~~`
 *  - Inline code: `` `code` ``
 *  - Code block:  triple-backticks (with optional language)
 *  - Link:        `[label](url)`
 *  - Block quote: `> text` (line-level)
 *  - Bullet list: `- item` / `* item`
 *  - Numbered:    `1. item`
 *
 * `||spoiler||` is intentionally treated as plain text — Portable Text has no
 * dedicated spoiler decorator and Lexical doesn't either.
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

// --- PT -> Discord ---------------------------------------------------------

function spanToDiscord(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '`' + text + '`';
  if (decorators.has('strike-through')) text = `~~${text}~~`;
  if (decorators.has('underline')) text = `__${text}__`;
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

function spansToDiscord(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToDiscord(span, markDefs))
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

function blockToDiscord(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToDiscord(tb);
    if (style === 'h1' || style === 'h2' || style === 'h3') {
      const hashes = style === 'h1' ? '#' : style === 'h2' ? '##' : '###';
      return `${hashes} ${inner}`;
    }
    if (/^h[4-6]$/.test(style)) return `### ${inner}`; // collapse h4..h6 to h3
    if (style === 'blockquote') {
      return inner.split('\n').map(line => `> ${line}`).join('\n');
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    return '```' + (language ?? '') + '\n' + code + '\n```';
  }
  return '';
}

export function portableTextToDiscord(doc: PortableTextDocument): string {
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
          run.push(`${counter}. ${spansToDiscord(b)}`);
          counter += 1;
        } else {
          counter = 1;
          run.push(`- ${spansToDiscord(b)}`);
        }
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToDiscord(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Discord -> PT ---------------------------------------------------------

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

  // Order: longest delimiters first so `**` beats `*` and `__` beats `_`.
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|__([^_\n]+)__|~~([^~\n]+)~~/g;
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

export function discordToPortableText(input: string): PortableTextDocument {
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

    // Triple-backtick code block (optionally with a language).
    const codeOpen = /^```(\w+)?\s*$/.exec(line);
    if (codeOpen) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: codeLines.join('\n'), language: codeOpen[1] ?? null });
      i += 1;
      continue;
    }

    // Heading: `#`/`##`/`###` followed by space.
    if (line.startsWith('### ')) {
      out.push(makeTextBlock(line.slice(4), 'h3', keys));
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(makeTextBlock(line.slice(3), 'h2', keys));
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      out.push(makeTextBlock(line.slice(2), 'h1', keys));
      i += 1;
      continue;
    }

    // Block quote: consecutive `> ` lines.
    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        quote.push(lines[i]!.slice(2));
        i += 1;
      }
      out.push(makeTextBlock(quote.join(' '), 'blockquote', keys));
      continue;
    }

    // List item.
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      while (i < lines.length) {
        const ln = lines[i]!;
        const b = /^[-*]\s+(.+)$/.exec(ln);
        const n = /^\d+\.\s+(.+)$/.exec(ln);
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
      if (/^(```|#{1,3}\s|>\s|[-*]\s|\d+\.\s)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ----------------------------------------------------------------

export const discordFormat: Format = {
  id: 'discord',
  label: 'Discord markdown',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return discordToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToDiscord(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/\*\*[^*\n]+\*\*/.test(value)) hits += 1;
    if (/__[^_\n]+__/.test(value)) hits += 1;
    if (/~~[^~\n]+~~/.test(value)) hits += 1;
    if (/^#{1,3}\s+\S/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    if (/^>\s/m.test(value)) hits += 1;
    if (/\[[^\]\n]+\]\([^)\s]+\)/.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default discordFormat;
