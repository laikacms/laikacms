import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Textile <-> Portable Text.
 *
 * Textile is the wiki-style markup used by Redmine, GitLab Wiki and historic
 * Movable Type / TextPattern installs.
 *
 * Supported subset:
 *  - Headings:     `h1. Heading` ... `h6. Heading`
 *  - Bold:         `*bold*`
 *  - Italic:       `_italic_`
 *  - Strike:       `-strike-`
 *  - Code:         `@code@` (inline)
 *  - Link:         `"label":url`
 *  - Bullet list:  lines starting with `* `
 *  - Numbered:     lines starting with `# `
 *  - Block quote:  paragraphs prefixed `bq. `
 *  - Code block:   paragraphs prefixed `bc. `
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

// --- PT -> Textile --------------------------------------------------------

function spanToTextile(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `@${text}@`;
  if (decorators.has('strike-through')) text = `-${text}-`;
  if (decorators.has('em')) text = `_${text}_`;
  if (decorators.has('strong')) text = `*${text}*`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `"${text}":${String(def.href ?? '')}`;
    }
  }
  return text;
}

function spansToTextile(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToTextile(span, markDefs))
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

function blockToTextile(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToTextile(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `h${m[1]}. ${inner}`;
    if (style === 'blockquote') return `bq. ${inner}`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `bc. ${code}`;
  }
  return '';
}

export function portableTextToTextile(doc: PortableTextDocument): string {
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
        run.push(`${marker.repeat(level)} ${spansToTextile(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToTextile(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Textile -> PT --------------------------------------------------------

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

  // "label":url | *bold* | _italic_ | -strike- | @code@
  const re = /"([^"\n]+)":(\S+)|\*([^*\n]+)\*|_([^_\n]+)_|-([^\-\n]+)-|@([^@\n]+)@/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[2] ?? '' });
      emit(match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['strong']);
    else if (match[4] !== undefined) emit(match[4], ['em']);
    else if (match[5] !== undefined) emit(match[5], ['strike-through']);
    else if (match[6] !== undefined) emit(match[6], ['code']);
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

export function textileToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  // Textile is paragraph-oriented: split on blank lines.
  const paragraphs = input.replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const raw of paragraphs) {
    const trimmed = raw.replace(/^\s+|\s+$/g, '');
    if (trimmed === '') continue;

    // List paragraph: every line begins with `*`/`#` markers.
    if (/^(\s*[*#]+\s+)/.test(trimmed)) {
      for (const line of trimmed.split('\n')) {
        const m = /^([*#]+)\s+(.+)$/.exec(line);
        if (!m) continue;
        const last = m[1]![m[1]!.length - 1]!;
        const listItem: 'bullet' | 'number' = last === '#' ? 'number' : 'bullet';
        out.push(makeTextBlock(m[2]!, 'normal', keys, listItem, m[1]!.length));
      }
      continue;
    }

    // Headings hN.
    const heading = /^h([1-6])\.\s+([\s\S]+)$/.exec(trimmed);
    if (heading) {
      out.push(makeTextBlock(heading[2]!.replace(/\s+/g, ' '), `h${heading[1]}`, keys));
      continue;
    }

    // Block quote `bq.`
    if (/^bq\.\s+/.test(trimmed)) {
      out.push(makeTextBlock(trimmed.replace(/^bq\.\s+/, '').replace(/\s+/g, ' '), 'blockquote', keys));
      continue;
    }

    // Code block `bc.`
    if (/^bc\.\s+/.test(trimmed)) {
      out.push({ _type: 'code', _key: keys.block(), code: trimmed.replace(/^bc\.\s+/, ''), language: null });
      continue;
    }

    // Plain paragraph
    out.push(makeTextBlock(trimmed.replace(/\s+/g, ' '), 'normal', keys));
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const textileFormat: Format = {
  id: 'textile',
  label: 'Textile',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return textileToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTextile(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^h[1-6]\.\s+\S/m.test(value)) hits += 2;
    if (/^bq\.\s+/m.test(value)) hits += 1;
    if (/^bc\.\s+/m.test(value)) hits += 1;
    if (/"[^"\n]+":\S+/.test(value)) hits += 1;
    if (/^[*#]\s/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default textileFormat;
