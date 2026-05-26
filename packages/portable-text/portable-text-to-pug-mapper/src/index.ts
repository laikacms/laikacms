import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Pug / Jade <-> Portable Text.
 *
 * Pug is the indentation-based HTML preprocessor (formerly Jade) used in
 * Node.js templates and Express defaults.
 *
 * Supported subset:
 *  - Headings:    `h1 Title` ... `h6 Title`
 *  - Paragraph:   `p Body`
 *  - Bold:        inline `#[strong text]`
 *  - Italic:      inline `#[em text]`
 *  - Inline code: inline `#[code text]`
 *  - Link:        inline `#[a(href="url") label]`
 *  - Bullet list: `ul` + indented `li` children
 *  - Numbered:    `ol` + indented `li` children
 *  - Block quote: `blockquote Text`
 *  - Code block:  `pre.\n  <body>` (the trailing `.` enables the literal block)
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

// --- PT -> Pug ------------------------------------------------------------

function spanToPug(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `#[code ${text}]`;
  if (decorators.has('em')) text = `#[em ${text}]`;
  if (decorators.has('strong')) text = `#[strong ${text}]`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `#[a(href="${String(def.href ?? '')}") ${text}]`;
    }
  }
  return text;
}

function spansToPug(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToPug(span, markDefs))
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

function blockToPug(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToPug(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `h${m[1]} ${inner}`;
    if (style === 'blockquote') return `blockquote ${inner}`;
    return `p ${inner}`;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const indented = code.split('\n').map(l => `  ${l}`).join('\n');
    return `pre.\n${indented}`;
  }
  return '';
}

export function portableTextToPug(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const first = block;
      const tag = first.listItem === 'number' ? 'ol' : 'ul';
      const items: string[] = [tag];
      while (
        i < doc.length
        && isListBlock(doc[i])
        && ((doc[i] as PortableTextBlock).listItem === first.listItem)
      ) {
        items.push(`  li ${spansToPug(doc[i] as PortableTextBlock)}`);
        i += 1;
      }
      parts.push(items.join('\n'));
      continue;
    }
    const out = blockToPug(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n');
}

// --- Pug -> PT ------------------------------------------------------------

/** Strip a balanced `#[…]` interpolation starting at `index`, return inner + end. */
function readInterp(input: string, start: number): { inner: string, end: number } | null {
  if (input[start] !== '#' || input[start + 1] !== '[') return null;
  let depth = 1;
  let i = start + 2;
  while (i < input.length && depth > 0) {
    if (input[i] === '[') depth += 1;
    else if (input[i] === ']') {
      depth -= 1;
      if (depth === 0) return { inner: input.slice(start + 2, i), end: i + 1 };
    }
    i += 1;
  }
  return null;
}

function inlineToSpans(
  text: string,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
  parentMarks: string[] = [],
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

  let i = 0;
  while (i < text.length) {
    if (text[i] === '#' && text[i + 1] === '[') {
      const interp = readInterp(text, i);
      if (interp) {
        // Inside `#[…]` the first token is the tag name with optional `(attrs)`,
        // separated by a space from the inner text.
        const headMatch = /^([a-zA-Z][\w-]*)(?:\(([^)]*)\))?\s*(.*)$/s.exec(interp.inner);
        if (headMatch) {
          const tagName = headMatch[1]!;
          const attrsRaw = headMatch[2] ?? '';
          const inner = headMatch[3] ?? '';
          let marks: string[] = [...parentMarks];
          if (tagName === 'strong' || tagName === 'b') marks = [...marks, 'strong'];
          else if (tagName === 'em' || tagName === 'i') marks = [...marks, 'em'];
          else if (tagName === 'code') marks = [...marks, 'code'];
          else if (tagName === 'a') {
            const hrefMatch = /href\s*=\s*"([^"]*)"/.exec(attrsRaw);
            const href = hrefMatch ? hrefMatch[1]! : '';
            const key = keys.mark();
            markDefs.push({ _type: 'link', _key: key, href });
            marks = [...marks, key];
          }
          const innerSpans = inlineToSpans(inner, markDefs, keys, marks);
          for (const span of innerSpans) emit(span.text, span.marks ?? []);
          i = interp.end;
          continue;
        }
      }
    }
    // Find the next `#[` or end.
    const next = text.indexOf('#[', i + 1);
    const chunk = text.slice(i, next === -1 ? text.length : next);
    if (chunk) emit(chunk, parentMarks);
    i = next === -1 ? text.length : next;
  }
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

function parseLine(line: string): { indent: number, tag: string, rest: string } | null {
  const m = /^( *)([a-zA-Z][\w-]*)(\.)?(?:\s+(.*))?$/.exec(line);
  if (!m) return null;
  return {
    indent: m[1]!.length,
    tag: m[2]!,
    rest: (m[3] === '.' ? '.' : '') + (m[4] ?? ''),
  };
}

export function pugToPortableText(input: string): PortableTextDocument {
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
    const parsed = parseLine(line);
    if (!parsed) {
      i += 1;
      continue;
    }
    const { tag, rest, indent } = parsed;

    // Heading
    const hMatch = /^h([1-6])$/.exec(tag);
    if (hMatch) {
      out.push(makeTextBlock(rest, `h${hMatch[1]}`, keys));
      i += 1;
      continue;
    }

    if (tag === 'p') {
      out.push(makeTextBlock(rest, 'normal', keys));
      i += 1;
      continue;
    }

    if (tag === 'blockquote') {
      out.push(makeTextBlock(rest, 'blockquote', keys));
      i += 1;
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const listItem: 'bullet' | 'number' = tag === 'ol' ? 'number' : 'bullet';
      i += 1;
      // Consume indented `li` children (any indent > parent's).
      while (i < lines.length) {
        const child = parseLine(lines[i]!);
        if (!child || child.indent <= indent || child.tag !== 'li') break;
        out.push(makeTextBlock(child.rest, 'normal', keys, listItem));
        i += 1;
      }
      continue;
    }

    if (tag === 'pre' && (rest === '.' || rest.startsWith('.'))) {
      // `pre.` literal block — children are dedented to the same indent + 2.
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const ln = lines[i]!;
        if (ln.trim() === '') {
          codeLines.push('');
          i += 1;
          continue;
        }
        const leading = /^( *)/.exec(ln)![1]!.length;
        if (leading <= indent) break;
        codeLines.push(ln.slice(indent + 2));
        i += 1;
      }
      // Strip trailing blank lines.
      while (codeLines.length && codeLines[codeLines.length - 1] === '') codeLines.pop();
      out.push({ _type: 'code', _key: keys.block(), code: codeLines.join('\n'), language: null });
      continue;
    }

    // Unknown / unsupported — treat the rest as a paragraph.
    out.push(makeTextBlock(rest, 'normal', keys));
    i += 1;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const pugFormat: Format = {
  id: 'pug',
  label: 'Pug / Jade',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return pugToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToPug(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^h[1-6]\s+\S/m.test(value)) hits += 2;
    if (/^p\s+\S/m.test(value)) hits += 1;
    if (/^(?:ul|ol)\s*$/m.test(value)) hits += 1;
    if (/^pre\.\s*$/m.test(value)) hits += 1;
    if (/#\[\w+/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default pugFormat;
