import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Emacs Org-mode <-> Portable Text.
 *
 * Supported subset:
 *  - Headings:   `* H1` ... `****** H6`
 *  - Bold:       `*bold*`
 *  - Italic:     `/italic/`
 *  - Underline:  `_underline_`
 *  - Strike:     `+strike+`
 *  - Code:       `~code~` (inline)
 *  - Link:       `[[https://url][label]]` or `[[https://url]]`
 *  - Bullet:     lines starting with `- `
 *  - Numbered:   lines starting with `1. ` (any digits)
 *  - Code block: `#+begin_src LANG` ... `#+end_src`
 *  - Block quote:`#+begin_quote` ... `#+end_quote`
 *
 * TODO blocks, TAGS, drawers and tables are out of scope.
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

// --- PT -> Org-mode -------------------------------------------------------

function spanToOrg(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  // Order: innermost-first by reading-order convention (code, then strike, …).
  if (decorators.has('code')) text = `~${text}~`;
  if (decorators.has('strike-through')) text = `+${text}+`;
  if (decorators.has('underline')) text = `_${text}_`;
  if (decorators.has('em')) text = `/${text}/`;
  if (decorators.has('strong')) text = `*${text}*`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === href ? `[[${href}]]` : `[[${href}][${text}]]`;
    }
  }
  return text;
}

function spansToOrg(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToOrg(span, markDefs))
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

function blockToOrg(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToOrg(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return `${'*'.repeat(Number(m[1]))} ${inner}`;
    if (style === 'blockquote') return `#+begin_quote\n${inner}\n#+end_quote`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    const tag = language ? `#+begin_src ${language}` : '#+begin_src';
    return `${tag}\n${code}\n#+end_src`;
  }
  return '';
}

export function portableTextToOrgmode(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const level = typeof b.level === 'number' && b.level > 0 ? b.level : 1;
        const indent = '  '.repeat(level - 1);
        const marker = b.listItem === 'number' ? `${counter}.` : '-';
        if (b.listItem === 'number') counter += 1;
        else counter = 1;
        run.push(`${indent}${marker} ${spansToOrg(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToOrg(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Org-mode -> PT -------------------------------------------------------

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

  // Capture: link [[url][label]] or [[url]]; then decorator runs.
  const re = /\[\[([^\]]+)\](?:\[([^\]]*)\])?\]|\*([^*\n]+)\*|\/([^/\n]+)\/|_([^_\n]+)_|\+([^+\n]+)\+|~([^~\n]+)~/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[1] });
      emit(match[2] ?? match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['strong']);
    else if (match[4] !== undefined) emit(match[4], ['em']);
    else if (match[5] !== undefined) emit(match[5], ['underline']);
    else if (match[6] !== undefined) emit(match[6], ['strike-through']);
    else if (match[7] !== undefined) emit(match[7], ['code']);
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

export function orgmodeToPortableText(input: string): PortableTextDocument {
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

    // Code block
    const srcOpen = /^#\+begin_src(?:\s+(\S+))?\s*$/i.exec(line);
    if (srcOpen) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^#\+end_src\s*$/i.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: srcOpen[1] ?? null });
      i += 1;
      continue;
    }

    // Block quote
    if (/^#\+begin_quote\s*$/i.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^#\+end_quote\s*$/i.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      out.push(makeTextBlock(body.join(' '), 'blockquote', keys));
      i += 1;
      continue;
    }

    // Heading: leading `*` runs followed by space.
    const heading = /^(\*{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      out.push(makeTextBlock(heading[2]!, `h${heading[1]!.length}`, keys));
      i += 1;
      continue;
    }

    // List: `-` (bullet) or `N.` (numbered).
    const bullet = /^(\s*)-\s+(.+)$/.exec(line);
    const numbered = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      while (i < lines.length) {
        const lineN = lines[i]!;
        const b = /^(\s*)-\s+(.+)$/.exec(lineN);
        const n = /^(\s*)\d+\.\s+(.+)$/.exec(lineN);
        if (!b && !n) break;
        const indent = (b ?? n)![1]!.length;
        const level = Math.floor(indent / 2) + 1;
        const text = (b ?? n)![2]!;
        const listItem: 'bullet' | 'number' = n ? 'number' : 'bullet';
        out.push(makeTextBlock(text, 'normal', keys, listItem, level));
        i += 1;
      }
      continue;
    }

    // Plain paragraph: gather until a blank line or a recognised block start.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(\*{1,6}\s|\s*-\s|\s*\d+\.\s|#\+begin_)/i.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const orgmodeFormat: Format = {
  id: 'orgmode',
  label: 'Org-mode',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return orgmodeToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToOrgmode(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^\*{1,6}\s+\S/m.test(value)) hits += 2;
    if (/#\+begin_(src|quote)/i.test(value)) hits += 1;
    if (/\[\[[^\]]+\](?:\[[^\]]*\])?\]/.test(value)) hits += 1;
    if (/\/[^/\n]+\//.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default orgmodeFormat;
