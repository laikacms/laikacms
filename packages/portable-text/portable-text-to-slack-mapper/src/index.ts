import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Slack mrkdwn <-> Portable Text.
 *
 * Slack's mrkdwn is a deliberately minimal dialect:
 *  - Bold:        `*bold*`   (single asterisk — *not* `**bold**` like CommonMark)
 *  - Italic:      `_italic_`
 *  - Strike:      `~strike~`
 *  - Inline code: `` `code` ``
 *  - Code block:  triple backticks
 *  - Block quote: lines starting with `> `
 *  - Bullet list: lines starting with `• ` or `* `
 *  - Numbered:    lines starting with `1. ` (2., 3., …)
 *  - Link:        `<https://url|label>` or `<https://url>`
 *
 * Headings have no native representation; we emit bold paragraphs and let
 * round-trips treat them as `style: 'normal'` with a bold span — the heading
 * level itself is lost by Slack's own spec.
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

// --- PT -> Slack -----------------------------------------------------------

function spanToSlack(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = '`' + text + '`';
  if (decorators.has('strike-through')) text = `~${text}~`;
  if (decorators.has('em')) text = `_${text}_`;
  if (decorators.has('strong')) text = `*${text}*`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === href ? `<${href}>` : `<${href}|${text}>`;
    }
  }
  return text;
}

function spansToSlack(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToSlack(span, markDefs))
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

function blockToSlack(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToSlack(tb);
    if (style === 'blockquote') {
      // Apply the `> ` prefix to every line.
      return inner.split('\n').map(line => `> ${line}`).join('\n');
    }
    if (/^h[1-6]$/.test(style)) {
      // Headings have no Slack representation; emit a bold paragraph.
      return `*${inner}*`;
    }
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return '```\n' + code + '\n```';
  }
  return '';
}

export function portableTextToSlack(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        if (b.listItem === 'number') {
          run.push(`${counter}. ${spansToSlack(b)}`);
          counter += 1;
        } else {
          counter = 1;
          run.push(`• ${spansToSlack(b)}`);
        }
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToSlack(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Slack -> PT -----------------------------------------------------------

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

  // Order: link `<url|label>` first, then code (longest delimiter), bold, italic, strike.
  const re = /<(https?:\/\/[^\s|>]+)(?:\|([^>]+))?>|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) emit(text.slice(lastIndex, match.index), []);
    if (match[1] !== undefined) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: match[1] });
      emit(match[2] ?? match[1], [key]);
    } else if (match[3] !== undefined) emit(match[3], ['code']);
    else if (match[4] !== undefined) emit(match[4], ['strong']);
    else if (match[5] !== undefined) emit(match[5], ['em']);
    else if (match[6] !== undefined) emit(match[6], ['strike-through']);
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

export function slackToPortableText(input: string): PortableTextDocument {
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
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: codeLines.join('\n'), language: null });
      i += 1;
      continue;
    }

    // Block quote: contiguous run of `> ` lines.
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        quoteLines.push(lines[i]!.slice(2));
        i += 1;
      }
      out.push(makeTextBlock(quoteLines.join(' '), 'blockquote', keys));
      continue;
    }

    // List item.
    const bullet = /^(?:•|\*)\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      while (i < lines.length) {
        const ln = lines[i]!;
        const b = /^(?:•|\*)\s+(.+)$/.exec(ln);
        const n = /^\d+\.\s+(.+)$/.exec(ln);
        if (!b && !n) break;
        const text = b ? b[1]! : n![1]!;
        const kind: 'bullet' | 'number' = n ? 'number' : 'bullet';
        out.push(makeTextBlock(text, 'normal', keys, kind));
        i += 1;
      }
      continue;
    }

    // Plain paragraph.
    const para: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.trim() === '') break;
      if (/^(```|>\s|(?:•|\*)\s|\d+\.\s)/.test(next)) break;
      para.push(next);
      j += 1;
    }
    out.push(makeTextBlock(para.join(' '), 'normal', keys));
    i = j;
  }

  return out;
}

// --- Format ----------------------------------------------------------------

export const slackFormat: Format = {
  id: 'slack',
  label: 'Slack (mrkdwn)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return slackToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToSlack(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<https?:\/\/[^\s|>]+(?:\|[^>]+)?>/.test(value)) hits += 2;
    if (/^>\s/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    if (/(^|\s)\*[^*\n\s][^*\n]*\*(\s|$)/.test(value)) hits += 1;
    if (/^•\s/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default slackFormat;
