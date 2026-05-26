import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * MediaWiki (Wikipedia) wiki-markup <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:   `== H2 ==` ... `====== H6 ======`
 *  - Bold:       `'''bold'''`
 *  - Italic:     `''italic''`
 *  - Inline link `[https://url display text]`  and bare `[https://url]`
 *  - Bullet:     lines beginning with `*`
 *  - Numbered:   lines beginning with `#`
 *  - Code:       `<code>...</code>` (inline) / `<pre>...</pre>` (block)
 *
 * Templates, transclusion, tables, internal `[[...]]` links and nowiki are
 * out of scope — they require wiki context the editor doesn't have.
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

// --- PT -> MediaWiki -------------------------------------------------------

function escapeOutgoing(text: string): string {
  // Aggressive: collapse any literal markup so it survives a round-trip.
  return text;
}

function spanToWiki(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeOutgoing(span.text ?? '');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('em') && decorators.has('strong')) {
    text = `'''''${text}'''''`;
  } else if (decorators.has('strong')) {
    text = `'''${text}'''`;
  } else if (decorators.has('em')) {
    text = `''${text}''`;
  }
  if (decorators.has('code')) text = `<code>${text}</code>`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `[${String(def.href ?? '')} ${text}]`;
    }
  }
  return text;
}

function spansToWiki(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToWiki(span, markDefs))
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

function blockToWiki(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToWiki(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) {
      const eq = '='.repeat(Number(m[1]));
      return `${eq} ${inner} ${eq}`;
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `<pre>${code}</pre>`;
  }
  return '';
}

export function portableTextToMediaWiki(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const prefix = b.listItem === 'number' ? '#' : '*';
        const level = typeof b.level === 'number' && b.level > 0 ? b.level : 1;
        run.push(`${prefix.repeat(level)} ${spansToWiki(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToWiki(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- MediaWiki -> PT -------------------------------------------------------

/** Convert one paragraph's inline wiki markup to Portable Text spans. */
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

  // Tokenise: bold, italic, inline code, links, plain text.
  const re =
    /'''''([^']+)'''''|'''([^']+)'''|''([^']+)''|<code>([^<]+)<\/code>|\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) emit(match[1], ['strong', 'em']);
    else if (match[2] !== undefined) emit(match[2], ['strong']);
    else if (match[3] !== undefined) emit(match[3], ['em']);
    else if (match[4] !== undefined) emit(match[4], ['code']);
    else if (match[5] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[5] });
      const label = match[6] ?? match[5];
      emit(label, [key]);
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

export function mediaWikiToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Skip blank lines (paragraph separators).
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Heading: leading and trailing run of `=` of equal length.
    const heading = /^(={1,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(makeTextBlock(heading[2]!, `h${level}`, keys));
      i += 1;
      continue;
    }

    // `<pre>...</pre>` block on its own paragraph.
    if (/^<pre>/.test(line)) {
      let body = line.replace(/^<pre>/, '');
      while (i + 1 < lines.length && !/<\/pre>/.test(body)) {
        i += 1;
        body += '\n' + lines[i]!;
      }
      const code = body.replace(/<\/pre>\s*$/, '');
      out.push({ _type: 'code', _key: keys.block(), code, language: null });
      i += 1;
      continue;
    }

    // List blocks: consume consecutive `*`/`#`-prefixed lines.
    const listMarker = /^([*#]+)\s+(.*)$/.exec(line);
    if (listMarker) {
      while (i < lines.length) {
        const m = /^([*#]+)\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        const prefix = m[1]!;
        const last = prefix[prefix.length - 1]!;
        const listItem: 'bullet' | 'number' = last === '#' ? 'number' : 'bullet';
        out.push(makeTextBlock(m[2]!, 'normal', keys, listItem, prefix.length));
        i += 1;
      }
      continue;
    }

    // Plain paragraph: take consecutive non-blank lines and join with single space.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() !== '' && !/^(={1,6}|[*#]+|<pre>)/.test(lines[j]!)) {
      para.push(lines[j]!);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const mediaWikiFormat: Format = {
  id: 'mediawiki',
  label: 'MediaWiki',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return mediaWikiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMediaWiki(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^={1,6}\s.+?\s={1,6}\s*$/m.test(value)) hits += 2;
    if (/'''[^']+'''/.test(value)) hits += 1;
    if (/''[^']+''/.test(value)) hits += 1;
    if (/^[*#]\s/m.test(value)) hits += 1;
    if (/\[https?:\/\/[^\s\]]+\s[^\]]+\]/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default mediaWikiFormat;
