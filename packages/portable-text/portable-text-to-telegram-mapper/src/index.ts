import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Telegram MarkdownV2 <-> Portable Text.
 *
 * MarkdownV2 (https://core.telegram.org/bots/api#markdownv2-style) is what
 * Telegram bots speak. It is a strict dialect with mandatory escaping of
 * `_ * [ ] ( ) ~ \` > # + - = | { } . !` outside special constructs.
 *
 * Supported subset:
 *  - Bold:        `*bold*`
 *  - Italic:      `_italic_`
 *  - Underline:   `__underline__`
 *  - Strike:      `~strike~`
 *  - Spoiler:     `||spoiler||`     (custom Portable Text decorator)
 *  - Inline code: `` `code` ``
 *  - Code block:  triple-backticks (with optional language)
 *  - Link:        `[label](url)`
 *  - Block quote: lines starting with `> `
 *
 * Telegram has no native heading or list syntax; we emit headings as bold
 * paragraphs and list blocks as bullet-prefixed lines (round-tripping a
 * heading or a list flattens to a plain paragraph).
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

/** Characters that MUST be escaped in plain text per the MarkdownV2 spec. */
const ESCAPE_RE = /([_*[\]()~`>#+\-=|{}.!\\])/g;

function escape(text: string): string {
  return text.replace(ESCAPE_RE, '\\$1');
}

function unescape(text: string): string {
  return text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
}

// --- PT -> Telegram --------------------------------------------------------

function spanToTelegram(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escape(span.text ?? '');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '`' + (span.text ?? '').replace(/`/g, '\\`') + '`';
  if (decorators.has('spoiler')) text = `||${text}||`;
  if (decorators.has('strike-through')) text = `~${text}~`;
  if (decorators.has('underline')) text = `__${text}__`;
  if (decorators.has('em')) text = `_${text}_`;
  if (decorators.has('strong')) text = `*${text}*`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `[${text}](${String(def.href ?? '')})`;
    }
  }
  return text;
}

function spansToTelegram(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToTelegram(span, markDefs))
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

function blockToTelegram(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToTelegram(tb);
    if (/^h[1-6]$/.test(style)) return `*${inner}*`;
    if (style === 'blockquote') {
      return inner.split('\n').map(line => `>${line}`).join('\n');
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    return '```' + (language ?? '') + '\n' + code + '\n```';
  }
  return '';
}

export function portableTextToTelegram(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? `${counter}\\.` : '•';
        if (b.listItem === 'number') counter += 1;
        else counter = 1;
        run.push(`${marker} ${spansToTelegram(b)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToTelegram(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Telegram -> PT --------------------------------------------------------

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

  // Tokenise. Order: link, code, double-delim (__ ~~? || **? — here only __ is double; ||spoiler||),
  // then single *…* and _..._  and ~…~.
  const re =
    /\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\|\|([^|\n]+)\|\||__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(unescape(text.slice(lastIndex, match.index)), []);
    if (match[1] !== undefined && match[2] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[2] });
      emit(unescape(match[1]), [key]);
    } else if (match[3] !== undefined) emit(match[3].replace(/\\`/g, '`'), ['code']);
    else if (match[4] !== undefined) emit(unescape(match[4]), ['spoiler']);
    else if (match[5] !== undefined) emit(unescape(match[5]), ['underline']);
    else if (match[6] !== undefined) emit(unescape(match[6]), ['strong']);
    else if (match[7] !== undefined) emit(unescape(match[7]), ['em']);
    else if (match[8] !== undefined) emit(unescape(match[8]), ['strike-through']);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) emit(unescape(text.slice(lastIndex)), []);
  flush();
  return spans;
}

function makeTextBlock(text: string, style: string, keys: Keys): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = inlineToSpans(text, markDefs, keys);
  return { _type: 'block', _key: keys.block(), style, markDefs, children };
}

export function telegramToPortableText(input: string): PortableTextDocument {
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

    // Triple-backtick code block.
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

    // Block quote
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quote.push(lines[i]!.slice(1));
        i += 1;
      }
      out.push(makeTextBlock(quote.join(' '), 'blockquote', keys));
      continue;
    }

    // Plain paragraph.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(```|>)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const telegramFormat: Format = {
  id: 'telegram',
  label: 'Telegram MarkdownV2',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return telegramToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTelegram(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/\|\|[^|\n]+\|\|/.test(value)) hits += 2; // spoiler is distinctive
    if (/__[^_\n]+__/.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    if (/(^|\s)\*[^*\n\s][^*\n]*\*(\s|$)/.test(value)) hits += 1;
    if (/\\[_*[\]()~`>#+\-=|{}.!]/.test(value)) hits += 1; // mandatory-escape evidence
    return Math.min(1, hits * 0.2);
  },
};

export default telegramFormat;
