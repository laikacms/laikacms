import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Perl POD (Plain Old Documentation) <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:   `=head1 …` ... `=head4 …`  (POD natively defines 1..4)
 *  - Bold:       `B<bold>`
 *  - Italic:     `I<italic>`
 *  - Inline code:`C<code>`
 *  - Underline:  `U<underline>`  (non-standard but seen in modern POD)
 *  - Link:       `L<https://url>` / `L<text|https://url>` / `L<text|module>`
 *  - Lists:      `=over` / `=item *` / `=item 1.` / `=back`
 *  - Code block: indented paragraphs *or* explicit `=begin code` blocks
 *
 * Paragraphs are separated by blank lines and POD is line-oriented; we keep
 * `=cut` and other directives out of scope (they only matter in source files).
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

// --- PT -> POD ------------------------------------------------------------

function spanToPod(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `C<${text}>`;
  if (decorators.has('em')) text = `I<${text}>`;
  if (decorators.has('strong')) text = `B<${text}>`;
  if (decorators.has('underline')) text = `U<${text}>`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = `L<${text}|${href}>`;
    }
  }
  return text;
}

function spansToPod(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToPod(span, markDefs))
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

function blockToPod(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToPod(tb);
    const m = /^h([1-4])$/.exec(style);
    if (m) return `=head${m[1]} ${inner}`;
    if (/^h[5-6]$/.test(style)) return `=head4 ${inner}`; // POD only natively defines 1..4
    if (style === 'blockquote') {
      return inner.split('\n').map(l => `    ${l}`).join('\n');
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return code.split('\n').map(l => `    ${l}`).join('\n');
  }
  return '';
}

export function portableTextToPod(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const items: string[] = ['=over 4'];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? `${counter}.` : '*';
        if (b.listItem === 'number') counter += 1;
        else counter = 1;
        items.push(`=item ${marker}`);
        items.push('');
        items.push(spansToPod(b));
        items.push('');
        i += 1;
      }
      items.push('=back');
      parts.push(items.join('\n'));
      continue;
    }
    const out = blockToPod(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- POD -> PT ------------------------------------------------------------

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

  // POD inline: `X<...>` where X is one of B I C U L.
  // The contents may not contain unmatched `<` / `>`, so a non-greedy match
  // matches what real-world POD looks like in practice.
  const re = /([BICUL])<([^<>]+)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    const tag = match[1]!;
    const inner = match[2]!;
    if (tag === 'B') emit(inner, ['strong']);
    else if (tag === 'I') emit(inner, ['em']);
    else if (tag === 'C') emit(inner, ['code']);
    else if (tag === 'U') emit(inner, ['underline']);
    else if (tag === 'L') {
      // `L<text|url>` or `L<url>`.
      const pipe = inner.indexOf('|');
      const label = pipe === -1 ? inner : inner.slice(0, pipe);
      const href = pipe === -1 ? inner : inner.slice(pipe + 1);
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href });
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

export function podToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const paragraphs = input.replace(/\r\n?/g, '\n').split(/\n{2,}/);

  let i = 0;
  while (i < paragraphs.length) {
    const rawPara = paragraphs[i]!;

    // Verbatim code block: every non-empty line begins with 4 spaces or a tab.
    // Detect this BEFORE trimming so the indentation survives.
    const rawLines = rawPara.split('\n').filter(l => l !== '');
    if (rawLines.length > 0 && rawLines.every(l => /^(?: {4}|\t)/.test(l))) {
      const code = rawLines.map(l => l.replace(/^(?: {4}|\t)/, '')).join('\n');
      out.push({ _type: 'code', _key: keys.block(), code, language: null });
      i += 1;
      continue;
    }

    const para = rawPara.replace(/^\s+|\s+$/g, '');
    if (para === '') {
      i += 1;
      continue;
    }

    // Heading
    const heading = /^=head([1-4])\s+([\s\S]+)$/.exec(para);
    if (heading) {
      out.push(makeTextBlock(heading[2]!.replace(/\s+/g, ' '), `h${heading[1]}`, keys));
      i += 1;
      continue;
    }

    // List: `=over … =back` (we don't enforce indentation level).
    if (/^=over\b/.test(para)) {
      i += 1;
      while (i < paragraphs.length && !/^=back\b/.test(paragraphs[i]!)) {
        const item = paragraphs[i]!.replace(/^\s+|\s+$/g, '');
        const itemMatch = /^=item\s+(.+?)(?:\n\n([\s\S]+))?$/m.exec(item);
        if (itemMatch) {
          const marker = itemMatch[1]!.trim();
          const body = itemMatch[2] ? itemMatch[2].replace(/\s+/g, ' ') : '';
          const listItem: 'bullet' | 'number' = /^\d+\.?$/.test(marker) ? 'number' : 'bullet';
          out.push(makeTextBlock(body || marker, 'normal', keys, listItem));
        } else if (/^=item\b/.test(item)) {
          const inline = item.replace(/^=item\s+/, '');
          const listItem: 'bullet' | 'number' = /^\d+\.?/.test(inline) ? 'number' : 'bullet';
          out.push(makeTextBlock(inline.replace(/^\*\s*|^\d+\.\s*/, ''), 'normal', keys, listItem));
        } else if (item !== '') {
          // A continuation paragraph for the previous item — append to the
          // last block's first span.
          const last = out[out.length - 1];
          if (last && (last as { _type?: string })._type === 'block') {
            const block = last as PortableTextBlock;
            const span = (block.children ?? [])[0] as PortableTextSpan | undefined;
            if (span) span.text = (span.text ?? '') + ' ' + item.replace(/\s+/g, ' ');
          }
        }
        i += 1;
      }
      i += 1; // skip `=back`
      continue;
    }

    // Plain paragraph.
    out.push(makeTextBlock(para.replace(/\s+/g, ' '), 'normal', keys));
    i += 1;
  }

  return out;
}

// --- Format --------------------------------------------------------------

export const podFormat: Format = {
  id: 'pod',
  label: 'Perl POD',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return podToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToPod(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^=head[1-4]\s/m.test(value)) hits += 2;
    if (/^=over\b/m.test(value)) hits += 1;
    if (/^=item\b/m.test(value)) hits += 1;
    if (/[BICUL]<[^<>\n]+>/.test(value)) hits += 1;
    if (/^=cut\b/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default podFormat;
