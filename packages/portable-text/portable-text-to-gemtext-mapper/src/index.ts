import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * Gemtext (Gemini protocol) <-> Portable Text.
 *
 * Gemtext is a deliberately minimal line-oriented format:
 *  - `# H1`, `## H2`, `### H3`   (only three heading levels)
 *  - `=> url [label]`            link lines (whole-line; no inline links)
 *  - `* item`                    bullet list lines
 *  - `> text`                    block quote lines
 *  - ` ``` `                     toggle preformatted (code block delimiter)
 *  - everything else             text
 *
 * No inline formatting exists in the spec, so marks (bold/italic/code) are
 * dropped on output; links become their own line via `=>`.
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

// --- PT -> Gemtext --------------------------------------------------------

function plainTextOf(block: PortableTextBlock): string {
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(c => c.text ?? '')
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

function linkLinesFor(block: PortableTextBlock): string[] {
  // Promote every `_type:'link'` markDef to its own `=>` line below the block.
  const out: string[] = [];
  for (const def of block.markDefs ?? []) {
    if (def._type !== 'link') continue;
    const href = String((def as { href?: string }).href ?? '');
    if (!href) continue;
    // Find the first span carrying this mark and use its text as the label.
    const owner = (block.children ?? []).find(
      (c): c is PortableTextSpan =>
        (c as { _type?: string })._type === 'span' && ((c as PortableTextSpan).marks ?? []).includes(def._key),
    );
    const label = owner ? (owner.text ?? '') : href;
    out.push(`=> ${href} ${label}`);
  }
  return out;
}

function blockToGemtext(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = plainTextOf(tb);
    if (style === 'h1' || style === 'h2' || style === 'h3') {
      const hashes = style === 'h1' ? '#' : style === 'h2' ? '##' : '###';
      return [`${hashes} ${inner}`, ...linkLinesFor(tb)].join('\n');
    }
    // h4..h6 collapse to h3 (Gemtext spec only has three levels).
    if (/^h[4-6]$/.test(style)) {
      return [`### ${inner}`, ...linkLinesFor(tb)].join('\n');
    }
    if (style === 'blockquote') return [`> ${inner}`, ...linkLinesFor(tb)].join('\n');
    return [inner, ...linkLinesFor(tb)].filter(s => s !== '').join('\n');
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return '```\n' + code + '\n```';
  }
  return '';
}

export function portableTextToGemtext(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const run: string[] = [];
      while (i < doc.length && isListBlock(doc[i])) {
        run.push(`* ${plainTextOf(doc[i] as PortableTextBlock)}`);
        i += 1;
      }
      parts.push(run.join('\n'));
      continue;
    }
    const out = blockToGemtext(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Gemtext -> PT --------------------------------------------------------

function singleSpan(text: string, keys: Keys): PortableTextSpan[] {
  return [{ _type: 'span', _key: keys.span(), text, marks: [] }];
}

function makeBlock(text: string, style: string, keys: Keys, listItem?: 'bullet'): PortableTextBlock {
  const block: PortableTextBlock = {
    _type: 'block',
    _key: keys.block(),
    style,
    markDefs: [],
    children: singleSpan(text, keys),
  };
  if (listItem) {
    block.listItem = listItem;
    block.level = 1;
  }
  return block;
}

export function gemtextToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line === '```' || /^```/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: null });
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      out.push(makeBlock(line.slice(4), 'h3', keys));
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(makeBlock(line.slice(3), 'h2', keys));
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      out.push(makeBlock(line.slice(2), 'h1', keys));
      i += 1;
      continue;
    }
    if (line.startsWith('=> ')) {
      // `=> url [label]` becomes a paragraph whose single span carries a link mark.
      const rest = line.slice(3).trim();
      const space = rest.search(/\s/);
      const href = space === -1 ? rest : rest.slice(0, space);
      const label = space === -1 ? rest : rest.slice(space + 1);
      const key = keys.mark();
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs: [{ _type: 'link', _key: key, href }],
        children: [{ _type: 'span', _key: keys.span(), text: label, marks: [key] }],
      });
      i += 1;
      continue;
    }
    if (line.startsWith('* ')) {
      while (i < lines.length && lines[i]!.startsWith('* ')) {
        out.push(makeBlock(lines[i]!.slice(2), 'normal', keys, 'bullet'));
        i += 1;
      }
      continue;
    }
    if (line.startsWith('> ')) {
      out.push(makeBlock(line.slice(2), 'blockquote', keys));
      i += 1;
      continue;
    }
    // Plain paragraph — Gemtext is one line = one paragraph.
    out.push(makeBlock(line, 'normal', keys));
    i += 1;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const gemtextFormat: Format = {
  id: 'gemtext',
  label: 'Gemtext',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return gemtextToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToGemtext(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^#{1,3}\s/m.test(value)) hits += 1;
    if (/^=>\s\S+/m.test(value)) hits += 2;
    if (/^\*\s/m.test(value)) hits += 1;
    if (/^>\s/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default gemtextFormat;
