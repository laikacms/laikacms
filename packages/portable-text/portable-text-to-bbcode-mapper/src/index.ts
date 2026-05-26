import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

// --- shared helpers --------------------------------------------------------

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

const INLINE_DECORATORS: Record<string, string> = {
  b: 'strong',
  i: 'em',
  u: 'underline',
  s: 'strike-through',
  strike: 'strike-through',
  code: 'code',
};

// --- PT -> BBCode ---------------------------------------------------------

function escapeBracket(text: string): string {
  // BBCode has no escape syntax, but stray brackets would re-trigger parsing
  // on the round-trip. We bias toward safety: only the opening `[` matters.
  return text.replace(/\[/g, '\\[');
}

function spansToBbcode(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  const defKeys = new Set(markDefs.map(d => d._key));
  let out = '';
  for (const child of block.children ?? []) {
    if ((child as { _type?: string })._type !== 'span') continue;
    const span = child as PortableTextSpan;
    const marks = span.marks ?? [];
    let text = escapeBracket(span.text ?? '');
    // Wrap decorators outermost-to-innermost for deterministic output.
    const order: string[] = ['strong', 'em', 'underline', 'strike-through', 'code'];
    for (const decorator of [...order].reverse()) {
      if (!marks.includes(decorator)) continue;
      const tag = decorator === 'strong'
        ? 'b'
        : decorator === 'em'
        ? 'i'
        : decorator === 'underline'
        ? 'u'
        : decorator === 'strike-through'
        ? 's'
        : 'code';
      text = `[${tag}]${text}[/${tag}]`;
    }
    const linkKey = marks.find(m => defKeys.has(m));
    if (linkKey) {
      const def = markDefs.find(d => d._key === linkKey);
      if (def && def._type === 'link') {
        text = `[url=${String(def.href ?? '')}]${text}[/url]`;
      }
    }
    out += text;
  }
  return out;
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

function renderListRun(run: PortableTextBlock[]): string {
  // Group consecutive list blocks of the same `listItem` at the same `level`.
  // Nested levels open a fresh `[list]` inside the previous `[*]`.
  let out = '';
  let i = 0;
  while (i < run.length) {
    const first = run[i]!;
    const listItem = first.listItem === 'number' ? '[list=1]' : '[list]';
    out += listItem;
    while (i < run.length && (run[i]!.listItem ?? '') === (first.listItem ?? '')) {
      out += `[*]${spansToBbcode(run[i]!)}`;
      i += 1;
    }
    out += '[/list]';
  }
  return out;
}

function blockToBbcode(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToBbcode(tb);
    if (style === 'blockquote') return `[quote]${inner}[/quote]`;
    if (/^h[1-6]$/.test(style)) return `[${style}]${inner}[/${style}]`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `[code]${code}[/code]`;
  }
  return '';
}

export function portableTextToBbcode(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: PortableTextBlock[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        run.push(doc[i] as PortableTextBlock);
        i += 1;
      }
      parts.push(renderListRun(run));
      continue;
    }
    const out = blockToBbcode(block);
    if (out) parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- BBCode -> PT ---------------------------------------------------------

interface InlineToken {
  kind: 'text' | 'open' | 'close';
  name?: string;
  attr?: string;
  value?: string;
}

function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /\[(\/?)([a-z][a-z0-9]*)(?:=([^\]]*))?\]/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: input.slice(lastIndex, match.index) });
    }
    const close = match[1] === '/';
    const name = (match[2] ?? '').toLowerCase();
    tokens.push(close ? { kind: 'close', name } : { kind: 'open', name, attr: match[3] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < input.length) tokens.push({ kind: 'text', value: input.slice(lastIndex) });
  return tokens;
}

function inlineToSpans(
  input: string,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const tokens = tokenizeInline(input);
  const spans: PortableTextSpan[] = [];
  let current: { text: string, marks: string[], key: string } | null = null;
  const flush = (): void => {
    if (!current) return;
    spans.push({ _type: 'span', _key: keys.span(), text: current.text, marks: current.marks });
    current = null;
  };
  const emit = (text: string, marks: string[]): void => {
    const key = marks.join(' ');
    if (current && current.key === key) current.text += text;
    else {
      flush();
      current = { text, marks: [...marks], key };
    }
  };

  const decoratorStack: string[] = [];
  const linkStack: string[] = [];

  for (const token of tokens) {
    if (token.kind === 'text') {
      const text = (token.value ?? '').replace(/\\\[/g, '[');
      if (text) emit(text, [...decoratorStack, ...linkStack]);
    } else if (token.kind === 'open') {
      const decorator = INLINE_DECORATORS[token.name ?? ''];
      if (decorator) {
        decoratorStack.push(decorator);
      } else if (token.name === 'url') {
        const key = keys.mark();
        markDefs.push({ _type: 'link', _key: key, href: token.attr ?? '' });
        linkStack.push(key);
      }
    } else if (token.kind === 'close') {
      const decorator = INLINE_DECORATORS[token.name ?? ''];
      if (decorator) {
        const idx = decoratorStack.lastIndexOf(decorator);
        if (idx !== -1) decoratorStack.splice(idx, 1);
      } else if (token.name === 'url') {
        linkStack.pop();
      }
    }
  }

  flush();
  // A trailing-`[url]` form (`[url]http://x[/url]`) has no `=`-attribute; in
  // that case the inner text is the href. Fix up markDefs whose href is empty.
  for (const def of markDefs) {
    if (def._type === 'link' && !def.href) {
      const owner = spans.find(s => (s.marks ?? []).includes(def._key));
      if (owner) (def as { href?: string }).href = owner.text;
    }
  }
  return spans;
}

function makeTextBlock(
  text: string,
  style: string,
  keys: Keys,
): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = inlineToSpans(text, markDefs, keys);
  return { _type: 'block', _key: keys.block(), style, markDefs, children };
}

/** A pair of `[tag]` ... `[/tag]` indices, used to split block-level tags. */
function findBlock(
  input: string,
  openTag: RegExp,
  closeTag: string,
): { start: number, openEnd: number, closeStart: number, closeEnd: number, attr?: string } | null {
  openTag.lastIndex = 0;
  const open = openTag.exec(input);
  if (!open) return null;
  const closeIndex = input.indexOf(closeTag, open.index + open[0].length);
  if (closeIndex === -1) return null;
  return {
    start: open.index,
    openEnd: open.index + open[0].length,
    closeStart: closeIndex,
    closeEnd: closeIndex + closeTag.length,
    attr: open[1],
  };
}

const BLOCK_TAGS = ['quote', 'code', 'list', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function buildListBlocks(content: string, listItem: 'bullet' | 'number', keys: Keys): PortableTextBlock[] {
  // BBCode list items are delimited by `[*]`. Trailing whitespace per item is
  // trimmed; an empty item is preserved as an empty block.
  const items = content.split(/\[\*\]/).slice(1);
  return items.map(raw => {
    const text = raw.replace(/^\s+|\s+$/g, '');
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = inlineToSpans(text, markDefs, keys);
    return {
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      listItem,
      level: 1,
      markDefs,
      children,
    };
  });
}

function parseChunk(chunk: string, out: PortableTextDocument, keys: Keys): void {
  // Greedy: while a recognised block tag occurs at the start of the chunk
  // (after whitespace), consume it; otherwise treat remaining text as
  // paragraphs separated by blank lines.
  const trimmed = chunk.replace(/^\s+/, '');
  for (const tag of BLOCK_TAGS) {
    if (!trimmed.toLowerCase().startsWith(`[${tag}`)) continue;
    const openRe = new RegExp(`^\\[${tag}(?:=([^\\]]*))?\\]`, 'i');
    const block = findBlock(trimmed, openRe, `[/${tag}]`);
    if (!block || block.start !== 0) continue;
    const before = '';
    const inside = trimmed.slice(block.openEnd, block.closeStart);
    const after = trimmed.slice(block.closeEnd);
    if (before.trim()) parseChunk(before, out, keys);
    if (tag === 'quote') {
      out.push(makeTextBlock(inside.trim(), 'blockquote', keys));
    } else if (tag === 'code') {
      out.push({ _type: 'code', _key: keys.block(), code: inside, language: null });
    } else if (tag === 'list') {
      const listItem = block.attr === '1' ? 'number' : 'bullet';
      out.push(...buildListBlocks(inside, listItem, keys));
    } else {
      out.push(makeTextBlock(inside.trim(), tag, keys));
    }
    if (after.trim()) parseChunk(after, out, keys);
    return;
  }
  // No block tag at this position — fall through to paragraph splitting.
  const paragraphs = trimmed.split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') continue;
    out.push(makeTextBlock(paragraph, 'normal', keys));
  }
}

export function bbcodeToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const doc: PortableTextDocument = [];
  parseChunk(input, doc, keys);
  return doc;
}

// --- Format ---------------------------------------------------------------

export const bbcodeFormat: Format = {
  id: 'bbcode',
  label: 'BBCode',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return bbcodeToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToBbcode(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    const matches = value.match(/\[\/?(?:b|i|u|s|code|url|quote|list|h[1-6]|strike)(?:=[^\]]*)?\]/gi);
    if (!matches) return 0;
    // Heavier weight when both an opening and a closing tag of the same name appear.
    return Math.min(1, 0.4 + matches.length * 0.05);
  },
};

export default bbcodeFormat;
