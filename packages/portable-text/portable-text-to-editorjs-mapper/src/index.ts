import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Editor.js JSON <-> Portable Text.
 *
 * Editor.js (https://editorjs.io) stores content as `{ blocks: [...] }` where
 * each block has a `type` and a `data` payload. Inline marks within `data.text`
 * are encoded as HTML tags (`<b>`, `<i>`, `<code>`, `<u>`, `<a href="…">`).
 *
 * Supported block types:
 *  - `header` (`data.level` 1–6)        → h1..h6
 *  - `paragraph`                        → normal
 *  - `quote` (`data.text`)              → blockquote
 *  - `code` (`data.code`)               → code block
 *  - `list` (`data.style`/`items`)      → bullet / numbered list
 *  - `delimiter`                        → dropped (horizontal rule)
 *
 * Unknown block types pass through as Portable Text `editorjs:<type>` custom
 * blocks, with their `data` fields preserved.
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

interface EJBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
}

// --- PT -> Editor.js ------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function spanToEjHtml(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let html = escapeHtml(span.text ?? '');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) html = `<code>${html}</code>`;
  if (decorators.has('em')) html = `<i>${html}</i>`;
  if (decorators.has('strong')) html = `<b>${html}</b>`;
  if (decorators.has('underline')) html = `<u>${html}</u>`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      html = `<a href="${escapeHtml(String(def.href ?? ''))}">${html}</a>`;
    }
  }
  return html;
}

function spansToEjHtml(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToEjHtml(span, markDefs))
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

function blockToEj(block: PortableTextBlock | Record<string, unknown>): EJBlock | null {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const text = spansToEjHtml(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return { type: 'header', data: { text, level: Number(m[1]) } };
    if (style === 'blockquote') return { type: 'quote', data: { text, caption: '' } };
    return { type: 'paragraph', data: { text } };
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return { type: 'code', data: { code } };
  }
  if (type && type.startsWith('editorjs:')) {
    const passThrough = block as Record<string, unknown>;
    const { _type, _key, ...rest } = passThrough;
    void _type;
    void _key;
    return { type: type.slice('editorjs:'.length), data: rest };
  }
  return null;
}

export function portableTextToEditorJs(doc: PortableTextDocument): {
  time: number,
  blocks: EJBlock[],
  version: string,
} {
  const blocks: EJBlock[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const first = block;
      const style = first.listItem === 'number' ? 'ordered' : 'unordered';
      const items: string[] = [];
      while (
        i < doc.length
        && isListBlock(doc[i])
        && ((doc[i] as PortableTextBlock).listItem === first.listItem)
      ) {
        items.push(spansToEjHtml(doc[i] as PortableTextBlock));
        i += 1;
      }
      blocks.push({ type: 'list', data: { style, items } });
      continue;
    }
    const out = blockToEj(block);
    if (out) blocks.push(out);
    i += 1;
  }
  return { time: 0, blocks, version: '2.0.0' };
}

// --- Editor.js -> PT ------------------------------------------------------

function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function htmlInlineToSpans(
  html: string,
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

  const stack: string[] = [];
  const linkStack: string[] = [];
  const re = /<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const token = match[0]!;
    if (token.startsWith('</')) {
      const name = /<\/([a-zA-Z]+)/.exec(token)![1]!.toLowerCase();
      if (name === 'a') linkStack.pop();
      else {
        const decorator = htmlTagToDecorator(name);
        if (decorator) {
          const idx = stack.lastIndexOf(decorator);
          if (idx !== -1) stack.splice(idx, 1);
        }
      }
    } else if (token.startsWith('<')) {
      const m = /<([a-zA-Z]+)([^>]*)>/.exec(token);
      if (m) {
        const name = m[1]!.toLowerCase();
        if (name === 'br') {
          emit('\n', [...stack, ...linkStack]);
        } else if (name === 'a') {
          const hrefMatch = /href\s*=\s*"([^"]*)"/.exec(m[2] ?? '');
          const key = keys.mark();
          markDefs.push({ _type: 'link', _key: key, href: hrefMatch ? unescapeHtml(hrefMatch[1]!) : '' });
          linkStack.push(key);
        } else {
          const decorator = htmlTagToDecorator(name);
          if (decorator) stack.push(decorator);
        }
      }
    } else {
      emit(unescapeHtml(token), [...stack, ...linkStack]);
    }
  }
  flush();
  return spans;
}

function htmlTagToDecorator(name: string): string | null {
  switch (name) {
    case 'b':
    case 'strong':
      return 'strong';
    case 'i':
    case 'em':
      return 'em';
    case 'code':
      return 'code';
    case 'u':
      return 'underline';
    case 's':
    case 'del':
    case 'strike':
      return 'strike-through';
    case 'sub':
      return 'sub';
    case 'sup':
      return 'sup';
    case 'mark':
      return 'highlight';
    default:
      return null;
  }
}

function makeTextBlock(html: string, style: string, keys: Keys): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = htmlInlineToSpans(html, markDefs, keys);
  return { _type: 'block', _key: keys.block(), style, markDefs, children };
}

function makeListItemBlock(
  html: string,
  listItem: 'bullet' | 'number',
  keys: Keys,
): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = htmlInlineToSpans(html, markDefs, keys);
  return {
    _type: 'block',
    _key: keys.block(),
    style: 'normal',
    listItem,
    level: 1,
    markDefs,
    children,
  };
}

export function editorJsToPortableText(input: string | { blocks?: EJBlock[] }): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  let data: { blocks?: EJBlock[] } | null;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input) as { blocks?: EJBlock[] };
    } catch {
      return out;
    }
  } else {
    data = input;
  }
  if (!data || !Array.isArray(data.blocks)) return out;

  for (const block of data.blocks) {
    if (!block || typeof block.type !== 'string') continue;
    const ej = block.data ?? {};
    if (block.type === 'header') {
      const level = Math.max(1, Math.min(6, (ej.level as number) ?? 1));
      out.push(makeTextBlock(String(ej.text ?? ''), `h${level}`, keys));
    } else if (block.type === 'paragraph') {
      out.push(makeTextBlock(String(ej.text ?? ''), 'normal', keys));
    } else if (block.type === 'quote') {
      out.push(makeTextBlock(String(ej.text ?? ''), 'blockquote', keys));
    } else if (block.type === 'code') {
      out.push({ _type: 'code', _key: keys.block(), code: String(ej.code ?? ''), language: null });
    } else if (block.type === 'list') {
      const listItem: 'bullet' | 'number' = ej.style === 'ordered' ? 'number' : 'bullet';
      for (const item of (ej.items as unknown[]) ?? []) {
        out.push(makeListItemBlock(String(item), listItem, keys));
      }
    } else if (block.type === 'delimiter') {
      // Skip horizontal rules — Portable Text has no canonical representation.
    } else {
      // Unknown block type — round-trip via a custom `editorjs:<type>` block.
      out.push({
        _type: `editorjs:${block.type}`,
        _key: keys.block(),
        ...(ej as Record<string, unknown>),
      });
    }
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const editorJsFormat: Format = {
  id: 'editorjs',
  label: 'Editor.js',

  toPortableText(value: string): PortableTextDocument {
    if (value.trim() === '') return [];
    return editorJsToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(portableTextToEditorJs(doc), null, 2);
  },

  detect(value: string): number {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return 0;
    try {
      const parsed = JSON.parse(trimmed) as { blocks?: unknown[] };
      if (Array.isArray(parsed.blocks)) {
        const looksEditorJs = parsed.blocks.every(
          b =>
            !!b && typeof (b as { type?: string }).type === 'string'
            && typeof (b as { data?: unknown }).data === 'object',
        );
        return looksEditorJs ? 1 : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  },
};

export default editorJsFormat;
