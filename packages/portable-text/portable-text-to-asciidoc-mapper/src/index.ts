import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * AsciiDoc <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:   `= h1` ... `====== h6` (level = leading `=` count)
 *  - Bold:       `*bold*`
 *  - Italic:     `_italic_`
 *  - Inline code:`\`code\``
 *  - Link:       `link:url[label]`
 *  - Bullet:     lines starting with `* `
 *  - Numbered:   lines starting with `. `
 *  - Code block: delimited by `----` on their own line
 *  - Block quote:delimited by `____` on their own line
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

// --- PT -> AsciiDoc -------------------------------------------------------

function spanToAd(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `\`${text}\``;
  if (decorators.has('em')) text = `_${text}_`;
  if (decorators.has('strong')) text = `*${text}*`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `link:${String(def.href ?? '')}[${text}]`;
    }
  }
  return text;
}

function spansToAd(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToAd(span, markDefs))
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

function blockToAd(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToAd(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `${'='.repeat(Number(m[1]))} ${inner}`;
    if (style === 'blockquote') return `____\n${inner}\n____`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `----\n${code}\n----`;
  }
  return '';
}

export function portableTextToAsciiDoc(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? '.' : '*';
        const level = typeof b.level === 'number' && b.level > 0 ? b.level : 1;
        run.push(`${marker.repeat(level)} ${spansToAd(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToAd(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- AsciiDoc -> PT -------------------------------------------------------

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

  // bold *...*, italic _..._, code `...`, link link:url[label]
  const re = /\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`|link:([^\s[]+)\[([^\]]*)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) emit(match[1], ['strong']);
    else if (match[2] !== undefined) emit(match[2], ['em']);
    else if (match[3] !== undefined) emit(match[3], ['code']);
    else if (match[4] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[4] });
      emit(match[5] ?? match[4], [key]);
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

export function asciiDocToPortableText(input: string): PortableTextDocument {
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

    // Code block: ---- ... ----
    if (line === '----') {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== '----') {
        code.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: null });
      i += 1;
      continue;
    }

    // Block quote: ____ ... ____
    if (line === '____') {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== '____') {
        body.push(lines[i]!);
        i += 1;
      }
      out.push(makeTextBlock(body.join(' '), 'blockquote', keys));
      i += 1;
      continue;
    }

    // Heading: leading `=` chars then space
    const heading = /^(={1,6})\s+(.+)$/.exec(line);
    if (heading) {
      out.push(makeTextBlock(heading[2]!, `h${heading[1]!.length}`, keys));
      i += 1;
      continue;
    }

    // List: `*` or `.` markers possibly repeated for nesting.
    const list = /^([*.]+)\s+(.+)$/.exec(line);
    if (list && /^([*]+|[.]+)$/.test(list[1]!)) {
      while (i < lines.length) {
        const m = /^([*.]+)\s+(.+)$/.exec(lines[i]!);
        if (!m || !/^([*]+|[.]+)$/.test(m[1]!)) break;
        const marker = m[1]![0];
        const listItem: 'bullet' | 'number' = marker === '.' ? 'number' : 'bullet';
        out.push(makeTextBlock(m[2]!, 'normal', keys, listItem, m[1]!.length));
        i += 1;
      }
      continue;
    }

    // Paragraph: consume consecutive non-special lines.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(={1,6}\s|[*.]+\s|----$|____$)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const asciiDocFormat: Format = {
  id: 'asciidoc',
  label: 'AsciiDoc',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return asciiDocToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToAsciiDoc(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^={1,6}\s+\S/m.test(value)) hits += 2;
    if (/^----$/m.test(value)) hits += 1;
    if (/link:[^\s[]+\[/.test(value)) hits += 1;
    if (/^[*.]\s+/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default asciiDocFormat;
