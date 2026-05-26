import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * DocBook XML (subset) <-> Portable Text.
 *
 * DocBook is a venerable SGML/XML schema for technical documentation. We
 * handle a focused subset that covers most short-form usage:
 *
 *  - Headings:    `<section><title>` (h1) / `<sect2>` (h2) / `<sect3>` (h3) /
 *                 `<sect4>` (h4) / `<sect5>` (h5) — `<chapter>` is also accepted
 *                 on read and emitted as h1.
 *  - Paragraph:   `<para>...</para>`
 *  - Bold:        `<emphasis role="bold">...</emphasis>` / `<emphasis role="strong">`
 *  - Italic:      `<emphasis>...</emphasis>`
 *  - Inline code: `<literal>...</literal>` (also `<code>...</code>` on read)
 *  - Link:        `<ulink url="...">label</ulink>`
 *  - Bullet list: `<itemizedlist><listitem><para>...</para></listitem>...</itemizedlist>`
 *  - Numbered:    `<orderedlist>` ... `</orderedlist>`
 *  - Code block:  `<programlisting>...</programlisting>`
 *  - Block quote: `<blockquote><para>...</para></blockquote>`
 *
 * Attributes other than `role` on emphasis and `url` on ulink are ignored.
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

const HEADING_TAG: Record<string, string> = {
  h1: 'sect1',
  h2: 'sect2',
  h3: 'sect3',
  h4: 'sect4',
  h5: 'sect5',
};

const HEADING_FROM_TAG: Record<string, string> = {
  sect1: 'h1',
  sect2: 'h2',
  sect3: 'h3',
  sect4: 'h4',
  sect5: 'h5',
  chapter: 'h1',
  section: 'h1',
};

// --- PT -> DocBook --------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function spanToDocbook(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeXml(span.text ?? '');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `<literal>${text}</literal>`;
  if (decorators.has('em')) text = `<emphasis>${text}</emphasis>`;
  if (decorators.has('strong')) text = `<emphasis role="bold">${text}</emphasis>`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `<ulink url="${escapeXml(String(def.href ?? ''))}">${text}</ulink>`;
    }
  }
  return text;
}

function spansToDocbook(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToDocbook(span, markDefs))
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

function blockToDocbook(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToDocbook(tb);
    if (HEADING_TAG[style]) {
      const tag = HEADING_TAG[style];
      return `<${tag}><title>${inner}</title></${tag}>`;
    }
    if (/^h6$/.test(style)) return `<sect5><title>${inner}</title></sect5>`;
    if (style === 'blockquote') return `<blockquote><para>${inner}</para></blockquote>`;
    return `<para>${inner}</para>`;
  }
  if (type === 'code') {
    const code = escapeXml(String((block as Record<string, unknown>).code ?? ''));
    return `<programlisting>${code}</programlisting>`;
  }
  return '';
}

export function portableTextToDocbook(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const first = block;
      const env = first.listItem === 'number' ? 'orderedlist' : 'itemizedlist';
      const items: string[] = [`<${env}>`];
      while (
        i < doc.length
        && isListBlock(doc[i])
        && ((doc[i] as PortableTextBlock).listItem === first.listItem)
      ) {
        items.push(`<listitem><para>${spansToDocbook(doc[i] as PortableTextBlock)}</para></listitem>`);
        i += 1;
      }
      items.push(`</${env}>`);
      parts.push(items.join('\n'));
      continue;
    }
    const out = blockToDocbook(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- DocBook -> PT --------------------------------------------------------

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

  // Tokenise into recognised inline tags + plain text.
  const re =
    /<emphasis(?:\s+role="(bold|strong)")?>([^<]*)<\/emphasis>|<(?:literal|code)>([^<]*)<\/(?:literal|code)>|<ulink\s+url="([^"]*)">([^<]*)<\/ulink>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(unescapeXml(text.slice(lastIndex, match.index)), parentMarks);
    if (match[1] !== undefined && match[2] !== undefined) {
      emit(unescapeXml(match[2]), [...parentMarks, 'strong']);
    } else if (match[1] === undefined && match[2] !== undefined) {
      emit(unescapeXml(match[2]), [...parentMarks, 'em']);
    } else if (match[3] !== undefined) {
      emit(unescapeXml(match[3]), [...parentMarks, 'code']);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[4] });
      emit(unescapeXml(match[5]), [...parentMarks, key]);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) emit(unescapeXml(text.slice(lastIndex)), parentMarks);
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

/** Iterate matches of `<TAG ...>...</TAG>` for any TAG in the set, top-level only. */
function findElement(
  input: string,
  names: ReadonlyArray<string>,
  start: number,
): { name: string, openEnd: number, closeStart: number, closeEnd: number } | null {
  const re = new RegExp(`<(${names.join('|')})(\\s[^>]*)?>`);
  const slice = input.slice(start);
  const open = re.exec(slice);
  if (!open) return null;
  const name = open[1]!;
  const openStart = start + open.index;
  const openEnd = openStart + open[0].length;
  const closeMarker = `</${name}>`;
  const closeIndex = input.indexOf(closeMarker, openEnd);
  if (closeIndex === -1) return null;
  return { name, openEnd, closeStart: closeIndex, closeEnd: closeIndex + closeMarker.length };
}

export function docbookToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const text = input.replace(/\r\n?/g, '\n');

  let i = 0;
  while (i < text.length) {
    // Skip whitespace + comments.
    const next = text.slice(i).search(/<[a-zA-Z]/);
    if (next === -1) break;
    i += next;

    // Heading sections.
    const sectionMatch = /^<(sect[1-5]|section|chapter)(\s[^>]*)?>/.exec(text.slice(i));
    if (sectionMatch) {
      const tag = sectionMatch[1]!;
      const closeMarker = `</${tag}>`;
      const closeIndex = text.indexOf(closeMarker, i + sectionMatch[0].length);
      if (closeIndex !== -1) {
        const body = text.slice(i + sectionMatch[0].length, closeIndex);
        // First child should be a <title>.
        const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/.exec(body);
        if (titleMatch) {
          const style = HEADING_FROM_TAG[tag] ?? 'h1';
          out.push(makeTextBlock(titleMatch[1]!.trim(), style, keys));
          // Recurse into the rest of the section.
          const rest = body.slice(titleMatch.index + titleMatch[0].length);
          out.push(...docbookToPortableText(rest));
        }
        i = closeIndex + closeMarker.length;
        continue;
      }
    }

    // List environments.
    const listMatch = /^<(itemizedlist|orderedlist)(\s[^>]*)?>/.exec(text.slice(i));
    if (listMatch) {
      const tag = listMatch[1]!;
      const closeMarker = `</${tag}>`;
      const closeIndex = text.indexOf(closeMarker, i + listMatch[0].length);
      if (closeIndex !== -1) {
        const body = text.slice(i + listMatch[0].length, closeIndex);
        const listItem: 'bullet' | 'number' = tag === 'orderedlist' ? 'number' : 'bullet';
        const itemRe = /<listitem(?:\s[^>]*)?>([\s\S]*?)<\/listitem>/g;
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(body)) !== null) {
          // Take the first <para> inside the item (most common case).
          const para = /<para(?:\s[^>]*)?>([\s\S]*?)<\/para>/.exec(m[1]!);
          const itemText = para ? para[1]! : m[1]!;
          out.push(makeTextBlock(itemText.replace(/\s+/g, ' ').trim(), 'normal', keys, listItem));
        }
        i = closeIndex + closeMarker.length;
        continue;
      }
    }

    // <programlisting> code block.
    if (text.startsWith('<programlisting', i)) {
      const open = /^<programlisting(?:\s[^>]*)?>/.exec(text.slice(i));
      if (open) {
        const closeMarker = '</programlisting>';
        const closeIndex = text.indexOf(closeMarker, i + open[0].length);
        if (closeIndex !== -1) {
          const code = text.slice(i + open[0].length, closeIndex);
          out.push({
            _type: 'code',
            _key: keys.block(),
            code: unescapeXml(code).replace(/^\n/, '').replace(/\n$/, ''),
            language: null,
          });
          i = closeIndex + closeMarker.length;
          continue;
        }
      }
    }

    // <blockquote>
    if (text.startsWith('<blockquote', i)) {
      const open = /^<blockquote(?:\s[^>]*)?>/.exec(text.slice(i));
      if (open) {
        const closeMarker = '</blockquote>';
        const closeIndex = text.indexOf(closeMarker, i + open[0].length);
        if (closeIndex !== -1) {
          const body = text.slice(i + open[0].length, closeIndex);
          const para = /<para(?:\s[^>]*)?>([\s\S]*?)<\/para>/.exec(body);
          const inner = para ? para[1]! : body;
          out.push(makeTextBlock(inner.replace(/\s+/g, ' ').trim(), 'blockquote', keys));
          i = closeIndex + closeMarker.length;
          continue;
        }
      }
    }

    // <para> paragraph.
    if (text.startsWith('<para', i)) {
      const open = /^<para(?:\s[^>]*)?>/.exec(text.slice(i));
      if (open) {
        const closeMarker = '</para>';
        const closeIndex = text.indexOf(closeMarker, i + open[0].length);
        if (closeIndex !== -1) {
          const body = text.slice(i + open[0].length, closeIndex);
          out.push(makeTextBlock(body.replace(/\s+/g, ' ').trim(), 'normal', keys));
          i = closeIndex + closeMarker.length;
          continue;
        }
      }
    }

    // Unknown element — skip to next `>`.
    const nextClose = text.indexOf('>', i);
    if (nextClose === -1) break;
    i = nextClose + 1;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const docbookFormat: Format = {
  id: 'docbook',
  label: 'DocBook XML',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return docbookToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToDocbook(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<(sect[1-5]|section|chapter)\b/.test(value)) hits += 2;
    if (/<para\b/.test(value)) hits += 2;
    if (/<(itemizedlist|orderedlist)\b/.test(value)) hits += 1;
    if (/<programlisting\b/.test(value)) hits += 1;
    if (/<ulink\s+url="/.test(value)) hits += 1;
    if (/<emphasis\b/.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default docbookFormat;
