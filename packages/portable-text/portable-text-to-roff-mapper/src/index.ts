import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * groff/man-page macros (the format `man(1)` and friends are written in) <->
 * Portable Text.
 *
 * Supported subset:
 *  - `.SH NAME`        → h1
 *  - `.SS NAME`        → h2
 *  - `.PP` / blank line → paragraph break
 *  - `\fB…\fR`          → bold inline
 *  - `\fI…\fR`          → italic inline
 *  - `\fC…\fR`          → code inline (non-standard but common)
 *  - `.B text`          → bold paragraph
 *  - `.I text`          → italic paragraph
 *  - `.IP "marker"`     → list item (bullet if marker is `*`/`•`/empty,
 *                        numbered if the marker is `N.`)
 *  - `.EX` / `.EE`      → example (code) block
 *  - `.UR url` / `.UE`  → link (with the body between the macros as the label)
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

// --- PT -> roff -----------------------------------------------------------

function spanToRoff(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text ?? '';
  // groff escape rules: `\` becomes `\\`, control-line `.` at column 0 is
  // implicit in our output (we emit inline only).
  text = text.replace(/\\/g, '\\\\');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `\\fC${text}\\fR`;
  if (decorators.has('em')) text = `\\fI${text}\\fR`;
  if (decorators.has('strong')) text = `\\fB${text}\\fR`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      // `.UR url\nlabel\n.UE` is the canonical groff hyperlink syntax.
      text = `\n.UR ${href}\n${text}\n.UE\n`;
    }
  }
  return text;
}

function spansToRoff(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToRoff(span, markDefs))
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

function blockToRoff(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToRoff(tb);
    if (style === 'h1') return `.SH ${inner}`;
    if (style === 'h2') return `.SS ${inner}`;
    if (/^h[3-6]$/.test(style)) return `.SS ${inner}`; // collapse deeper headings to .SS
    if (style === 'blockquote') return `.RS\n${inner}\n.RE`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `.EX\n${code}\n.EE`;
  }
  return '';
}

export function portableTextToRoff(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const items: string[] = [];
      let counter = 1;
      while (i < doc.length && isListBlock(doc[i])) {
        const b = doc[i] as PortableTextBlock;
        const marker = b.listItem === 'number' ? `${counter}.` : '*';
        if (b.listItem === 'number') counter += 1;
        else counter = 1;
        items.push(`.IP "${marker}" 4`);
        items.push(spansToRoff(b));
        i += 1;
      }
      parts.push(items.join('\n'));
      continue;
    }
    const out = blockToRoff(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n.PP\n');
}

// --- roff -> PT -----------------------------------------------------------

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

  // Walk character by character so we can pair `\fX … \fR`.
  const stack: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === 'f') {
      const code = text[i + 2];
      if (code === 'R' || code === 'P') {
        // End run.
        stack.pop();
      } else if (code === 'B') stack.push('strong');
      else if (code === 'I') stack.push('em');
      else if (code === 'C') stack.push('code');
      i += 3;
      continue;
    }
    if (text[i] === '\\' && text[i + 1] === '\\') {
      emit('\\', stack);
      i += 2;
      continue;
    }
    emit(text[i]!, stack);
    i += 1;
  }
  flush();
  void markDefs;
  void keys;
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

export function roffToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  const buffer: string[] = [];
  const flushBuffer = (): void => {
    const text = buffer.join(' ').trim();
    if (text !== '') out.push(makeTextBlock(text, 'normal', keys));
    buffer.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '' || line === '.PP' || line === '.P') {
      flushBuffer();
      i += 1;
      continue;
    }
    // .SH NAME → h1
    const sh = /^\.SH\s+(.+)$/.exec(line);
    if (sh) {
      flushBuffer();
      out.push(makeTextBlock(sh[1]!, 'h1', keys));
      i += 1;
      continue;
    }
    // .SS NAME → h2
    const ss = /^\.SS\s+(.+)$/.exec(line);
    if (ss) {
      flushBuffer();
      out.push(makeTextBlock(ss[1]!, 'h2', keys));
      i += 1;
      continue;
    }
    // .B / .I  (whole paragraph styled bold/italic — emit as inline within current buffer)
    const bi = /^\.([BI])\s+(.+)$/.exec(line);
    if (bi) {
      const wrap = bi[1] === 'B' ? '\\fB' : '\\fI';
      buffer.push(`${wrap}${bi[2]}\\fR`);
      i += 1;
      continue;
    }
    // .IP "marker" — list item
    const ip = /^\.IP(?:\s+"([^"]*)"(?:\s+\d+)?)?\s*$/.exec(line);
    if (ip) {
      flushBuffer();
      const marker = (ip[1] ?? '').trim();
      const listItem: 'bullet' | 'number' = /^\d+\.?$/.test(marker) ? 'number' : 'bullet';
      // The body of the item is the next non-control lines.
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\./.test(lines[i]!) && lines[i]!.trim() !== '') {
        body.push(lines[i]!);
        i += 1;
      }
      out.push(makeTextBlock(body.join(' '), 'normal', keys, listItem));
      continue;
    }
    // .EX / .EE → code block
    if (line === '.EX') {
      flushBuffer();
      i += 1;
      const code: string[] = [];
      while (i < lines.length && lines[i] !== '.EE') {
        code.push(lines[i]!);
        i += 1;
      }
      out.push({ _type: 'code', _key: keys.block(), code: code.join('\n'), language: null });
      i += 1;
      continue;
    }
    // .RS / .RE → block quote
    if (line === '.RS') {
      flushBuffer();
      i += 1;
      const body: string[] = [];
      while (i < lines.length && lines[i] !== '.RE') {
        body.push(lines[i]!);
        i += 1;
      }
      out.push(makeTextBlock(body.join(' '), 'blockquote', keys));
      i += 1;
      continue;
    }
    // .UR url … .UE → link annotation
    const ur = /^\.UR\s+(\S+)\s*$/.exec(line);
    if (ur) {
      const href = ur[1]!;
      const labelLines: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== '.UE') {
        labelLines.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const label = labelLines.join(' ').trim();
      const key = keys.mark();
      const markDefs: PortableTextMarkDefinition[] = [{ _type: 'link', _key: key, href }];
      const spanText = label || href;
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children: [{ _type: 'span', _key: keys.span(), text: spanText, marks: [key] }],
      });
      continue;
    }
    // Skip unknown control lines.
    if (/^\.[A-Za-z]/.test(line)) {
      i += 1;
      continue;
    }
    // Plain text paragraph line — accumulate.
    buffer.push(line);
    i += 1;
  }
  flushBuffer();

  return out;
}

// --- Format --------------------------------------------------------------

export const roffFormat: Format = {
  id: 'roff',
  label: 'roff / man pages',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return roffToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToRoff(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^\.SH\s/m.test(value)) hits += 2;
    if (/^\.SS\s/m.test(value)) hits += 1;
    if (/^\.TH\s/m.test(value)) hits += 1;
    if (/\\f[BI]/.test(value)) hits += 1;
    if (/^\.IP\b/m.test(value)) hits += 1;
    if (/^\.EX\b/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default roffFormat;
