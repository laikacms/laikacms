import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Obsidian-flavoured markdown <-> Portable Text.
 *
 * Obsidian extends CommonMark with:
 *  - `[[Page]]` / `[[Page|alias]]`  internal "wikilinks"
 *  - `==highlight==`                yellow highlight decorator
 *  - `> [!note]` / `> [!warning]`   "callouts" (we serialise as blockquotes
 *                                   tagged with `dataset.callout`)
 *
 * Plus the regular CommonMark subset (headings, marks, links, lists, code blocks,
 * block quotes). Internal `[[wikilinks]]` produce a Portable Text link annotation
 * with an `obsidian://` URL so they round-trip without a wiki context.
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

/** URI scheme used to mark a link as an internal Obsidian wikilink. */
const WIKILINK_SCHEME = 'obsidian://';

// --- PT -> Obsidian ------------------------------------------------------

function spanToObsidian(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '`' + text + '`';
  if (decorators.has('strike-through')) text = `~~${text}~~`;
  if (decorators.has('highlight')) text = `==${text}==`;
  if (decorators.has('em')) text = `*${text}*`;
  if (decorators.has('strong')) text = `**${text}**`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      if (href.startsWith(WIKILINK_SCHEME)) {
        const target = href.slice(WIKILINK_SCHEME.length);
        text = text === target ? `[[${target}]]` : `[[${target}|${text}]]`;
      } else {
        text = `[${text}](${href})`;
      }
    }
  }
  return text;
}

function spansToObsidian(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToObsidian(span, markDefs))
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

function blockToObsidian(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToObsidian(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `${'#'.repeat(Number(m[1]))} ${inner}`;
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

export function portableTextToObsidian(doc: PortableTextDocument): string {
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
          run.push(`${counter}. ${spansToObsidian(b)}`);
          counter += 1;
        } else {
          counter = 1;
          run.push(`- ${spansToObsidian(b)}`);
        }
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToObsidian(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Obsidian -> PT ------------------------------------------------------

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

  // Order: wikilink, regular link, code, double-delimited (**…**, ==…==, ~~…~~), then single *…*.
  const re =
    /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]|\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|==([^=\n]+)==|~~([^~\n]+)~~|\*([^*\n]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: WIKILINK_SCHEME + match[1] });
      emit(match[2] ?? match[1], [key]);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[4] });
      emit(match[3], [key]);
    } else if (match[5] !== undefined) emit(match[5], ['code']);
    else if (match[6] !== undefined) emit(match[6], ['strong']);
    else if (match[7] !== undefined) emit(match[7], ['highlight']);
    else if (match[8] !== undefined) emit(match[8], ['strike-through']);
    else if (match[9] !== undefined) emit(match[9], ['em']);
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

export function obsidianToPortableText(input: string): PortableTextDocument {
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

    // Code block (with optional language).
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

    // Heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      out.push(makeTextBlock(heading[2]!, `h${heading[1]!.length}`, keys));
      i += 1;
      continue;
    }

    // Block quote (handles `> [!note]` callouts as plain block quotes).
    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        quote.push(lines[i]!.slice(2));
        i += 1;
      }
      out.push(makeTextBlock(quote.join(' '), 'blockquote', keys));
      continue;
    }

    // List items.
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
      if (/^(```|#{1,6}\s|>\s|[-*]\s|\d+\.\s)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format --------------------------------------------------------------

export const obsidianFormat: Format = {
  id: 'obsidian',
  label: 'Obsidian markdown',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return obsidianToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToObsidian(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/\[\[[^\]\n|]+(?:\|[^\]\n]+)?\]\]/.test(value)) hits += 2; // wikilink
    if (/==[^=\n]+==/.test(value)) hits += 2; // highlight
    if (
      /^>\s\[!(note|warning|tip|info|todo|abstract|important|caution|danger|bug|example|quote|cite|success|failure|question|attention|help|hint|fail|missing|error|fail|done|check)/im
        .test(value)
    ) hits += 2;
    if (/^#{1,6}\s/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    if (/\*\*[^*\n]+\*\*/.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default obsidianFormat;
