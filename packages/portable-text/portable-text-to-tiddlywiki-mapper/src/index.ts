import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * TiddlyWiki5 WikiText <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:    `! H1` ... `!!!!!! H6`   (one `!` = h1)
 *  - Bold:        `''bold''`               (two single-quotes, *not* MediaWiki italic)
 *  - Italic:      `//italic//`
 *  - Underline:   `__underline__`
 *  - Strike:      `~~strike~~`
 *  - Code:        `` ``code`` ``           (two backticks)
 *  - Link:        `[[target]]` / `[[label|target]]`
 *  - Bullet list: lines beginning with `* ` (one or more `*` for nesting)
 *  - Numbered:    lines beginning with `# `
 *  - Block quote: `<<<` … `<<<`
 *  - Code block:  triple-backticks (optionally with language)
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

// --- PT -> TiddlyWiki ----------------------------------------------------

function spanToTw(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '``' + text + '``';
  if (decorators.has('strike-through')) text = `~~${text}~~`;
  if (decorators.has('underline')) text = `__${text}__`;
  if (decorators.has('em')) text = `//${text}//`;
  if (decorators.has('strong')) text = `''${text}''`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === href ? `[[${href}]]` : `[[${text}|${href}]]`;
    }
  }
  return text;
}

function spansToTw(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToTw(span, markDefs))
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

function blockToTw(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToTw(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `${'!'.repeat(Number(m[1]))} ${inner}`;
    if (style === 'blockquote') return `<<<\n${inner}\n<<<`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    return '```' + (language ?? '') + '\n' + code + '\n```';
  }
  return '';
}

export function portableTextToTiddlyWiki(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? '#' : '*';
        const level = typeof b.level === 'number' && b.level > 0 ? b.level : 1;
        run.push(`${marker.repeat(level)} ${spansToTw(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToTw(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- TiddlyWiki -> PT ----------------------------------------------------

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

  // Order: link first (longest), then `\`\`code\`\``, then double-delim marks.
  const re =
    /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]|``([^`\n]+)``|''([^'\n]+)''|\/\/([^/\n]+)\/\/|__([^_\n]+)__|~~([^~\n]+)~~/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      // `[[A]]` -> label = href = A
      // `[[A|B]]` -> label = A, href = B   (TiddlyWiki spec: pipe order is reversed from MediaWiki)
      const label = match[1]!;
      const href = match[2] ?? match[1]!;
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href });
      emit(label, [key]);
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

export function tiddlyWikiToPortableText(input: string): PortableTextDocument {
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

    // Triple-backtick code block (optionally with language).
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

    // `<<<` block quote `<<<`
    if (line === '<<<') {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== '<<<') {
        body.push(lines[i]!);
        i += 1;
      }
      out.push(makeTextBlock(body.join(' '), 'blockquote', keys));
      i += 1;
      continue;
    }

    // Heading: leading `!` run (1..6) then space.
    const heading = /^(!{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      out.push(makeTextBlock(heading[2]!, `h${heading[1]!.length}`, keys));
      i += 1;
      continue;
    }

    // List: `*` (bullet) or `#` (numbered) optionally repeated for nesting.
    const list = /^([*#]+)\s+(.+)$/.exec(line);
    if (list && /^([*]+|[#]+)$/.test(list[1]!)) {
      while (i < lines.length) {
        const m = /^([*#]+)\s+(.+)$/.exec(lines[i]!);
        if (!m || !/^([*]+|[#]+)$/.test(m[1]!)) break;
        const marker = m[1]![0];
        const listItem: 'bullet' | 'number' = marker === '#' ? 'number' : 'bullet';
        out.push(makeTextBlock(m[2]!, 'normal', keys, listItem, m[1]!.length));
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
      if (/^(!{1,6}\s|[*#]+\s|<<<$|```)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format --------------------------------------------------------------

export const tiddlyWikiFormat: Format = {
  id: 'tiddlywiki',
  label: 'TiddlyWiki5',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return tiddlyWikiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTiddlyWiki(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^!{1,6}\s+\S/m.test(value)) hits += 2;
    if (/''[^'\n]+''/.test(value)) hits += 1;
    if (/\/\/[^/\n]+\/\//.test(value)) hits += 1;
    if (/``[^`\n]+``/.test(value)) hits += 1;
    if (/\[\[[^\]\n|]+(?:\|[^\]\n]+)?\]\]/.test(value)) hits += 1;
    if (/^<<<$/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default tiddlyWikiFormat;
