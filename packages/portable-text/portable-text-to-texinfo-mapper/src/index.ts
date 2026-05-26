import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * GNU Texinfo <-> Portable Text.
 *
 * Texinfo is the source format that compiles to `info` pages and PDF manuals.
 * Supported subset:
 *  - Headings:   `@chapter`, `@section`, `@subsection`, `@subsubsection`
 *                                            (h1 ... h4; h5/h6 collapse to @subsubsection)
 *  - Bold:       `@b{bold}` / `@strong{…}`
 *  - Italic:     `@i{italic}` / `@emph{…}`
 *  - Inline code:`@code{code}` (also `@samp` / `@var` are accepted)
 *  - Link:       `@uref{url, label}` (also bare `@uref{url}`)
 *  - Bullet:     `@itemize @bullet ... @end itemize`
 *  - Numbered:   `@enumerate ... @end enumerate`
 *  - Block quote:`@quotation ... @end quotation`
 *  - Code block: `@example ... @end example`
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

const HEADING_TO_COMMAND: Record<string, string> = {
  h1: 'chapter',
  h2: 'section',
  h3: 'subsection',
  h4: 'subsubsection',
};

const COMMAND_TO_HEADING: Record<string, string> = {
  chapter: 'h1',
  section: 'h2',
  subsection: 'h3',
  subsubsection: 'h4',
};

// --- PT -> Texinfo --------------------------------------------------------

function escapeTexinfo(text: string): string {
  return text.replace(/([@{}])/g, '@$1');
}

function spanToTexinfo(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeTexinfo(span.text ?? '');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `@code{${text}}`;
  if (decorators.has('em')) text = `@i{${text}}`;
  if (decorators.has('strong')) text = `@b{${text}}`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      const href = String(def.href ?? '');
      text = text === escapeTexinfo(href) ? `@uref{${href}}` : `@uref{${href}, ${text}}`;
    }
  }
  return text;
}

function spansToTexinfo(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToTexinfo(span, markDefs))
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

function blockToTexinfo(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToTexinfo(tb);
    const cmd = HEADING_TO_COMMAND[style];
    if (cmd) return `@${cmd} ${inner}`;
    if (/^h[5-6]$/.test(style)) return `@subsubsection ${inner}`;
    if (style === 'blockquote') return `@quotation\n${inner}\n@end quotation`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `@example\n${code}\n@end example`;
  }
  return '';
}

export function portableTextToTexinfo(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const first = block;
      const env = first.listItem === 'number' ? 'enumerate' : 'itemize @bullet';
      const endEnv = first.listItem === 'number' ? 'enumerate' : 'itemize';
      const items: string[] = [`@${env}`];
      while (
        i < doc.length
        && isListBlock(doc[i])
        && ((doc[i] as PortableTextBlock).listItem === first.listItem)
      ) {
        items.push('@item');
        items.push(spansToTexinfo(doc[i] as PortableTextBlock));
        i += 1;
      }
      items.push(`@end ${endEnv}`);
      parts.push(items.join('\n'));
      continue;
    }
    const out = blockToTexinfo(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- Texinfo -> PT --------------------------------------------------------

function unescapeTexinfo(text: string): string {
  return text.replace(/@([@{}])/g, '$1');
}

/** Find the matching `}` for the `{` at `input[start]`. */
function matchBrace(input: string, start: number): number {
  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '@') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface ParsedCommand {
  name: string;
  arg: string | null;
  end: number;
}

function parseCommand(input: string, index: number): ParsedCommand | null {
  const m = /^@([a-zA-Z]+)/.exec(input.slice(index));
  if (!m) return null;
  let cursor = index + m[0].length;
  let arg: string | null = null;
  if (input[cursor] === '{') {
    const close = matchBrace(input, cursor);
    if (close === -1) return null;
    arg = input.slice(cursor + 1, close);
    cursor = close + 1;
  }
  return { name: m[1]!, arg, end: cursor };
}

const INLINE_DECORATOR: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  emph: 'em',
  code: 'code',
  samp: 'code',
  var: 'em',
};

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

  let i = 0;
  while (i < text.length) {
    if (text[i] === '@') {
      // Escaped char `@@`, `@{`, `@}`.
      if (text[i + 1] === '@' || text[i + 1] === '{' || text[i + 1] === '}') {
        emit(text[i + 1]!, parentMarks);
        i += 2;
        continue;
      }
      const cmd = parseCommand(text, i);
      if (cmd && cmd.arg !== null) {
        if (cmd.name === 'uref') {
          const [hrefRaw, labelRaw] = cmd.arg.split(',', 2);
          const href = (hrefRaw ?? '').trim();
          const label = labelRaw !== undefined ? labelRaw.trim() : href;
          const key = keys.mark();
          markDefs.push({ _type: 'link', _key: key, href });
          const inner = inlineToSpans(label, markDefs, keys, [...parentMarks, key]);
          for (const span of inner) emit(span.text, span.marks ?? []);
          i = cmd.end;
          continue;
        }
        const decorator = INLINE_DECORATOR[cmd.name];
        if (decorator) {
          const inner = inlineToSpans(cmd.arg, markDefs, keys, [...parentMarks, decorator]);
          for (const span of inner) emit(span.text, span.marks ?? []);
          i = cmd.end;
          continue;
        }
        // Unknown @cmd{arg} — keep the argument text only.
        const inner = inlineToSpans(cmd.arg, markDefs, keys, parentMarks);
        for (const span of inner) emit(span.text, span.marks ?? []);
        i = cmd.end;
        continue;
      }
    }
    const next = text.indexOf('@', i + 1);
    const chunk = text.slice(i, next === -1 ? text.length : next);
    if (chunk) emit(unescapeTexinfo(chunk), parentMarks);
    i = next === -1 ? text.length : next;
  }
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

export function texinfoToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const text = input.replace(/\r\n?/g, '\n');

  let i = 0;
  while (i < text.length) {
    // Skip whitespace between blocks.
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (i >= text.length) break;

    // Environment: `@chapter`/`@section`/...
    const heading = /^@(chapter|section|subsection|subsubsection)\s+([^\n]+)/.exec(text.slice(i));
    if (heading) {
      const style = COMMAND_TO_HEADING[heading[1]!]!;
      out.push(makeTextBlock(heading[2]!.trim(), style, keys));
      i += heading[0].length;
      continue;
    }

    // Block environments delimited by `@end NAME`.
    // Use `[ \t]+` (not `\s+`) for the argument separator so we don't accidentally
    // swallow the first body line via the optional spaces capture.
    const envOpen = /^@(itemize|enumerate|quotation|example)(?:[ \t]+([^\n]*))?\n/.exec(text.slice(i));
    if (envOpen) {
      const name = envOpen[1]!;
      const bodyStart = i + envOpen[0].length;
      const endMarker = `@end ${name}`;
      const endIndex = text.indexOf(endMarker, bodyStart);
      if (endIndex !== -1) {
        const body = text.slice(bodyStart, endIndex);
        if (name === 'example') {
          out.push({
            _type: 'code',
            _key: keys.block(),
            code: body.replace(/^\n/, '').replace(/\n$/, ''),
            language: null,
          });
        } else if (name === 'quotation') {
          out.push(makeTextBlock(body.replace(/\s+/g, ' ').trim(), 'blockquote', keys));
        } else {
          // @itemize / @enumerate — split on `@item` and emit list blocks.
          const listItem: 'bullet' | 'number' = name === 'enumerate' ? 'number' : 'bullet';
          const items = body.split(/^@item\b\s*/m).slice(1);
          for (const raw of items) {
            const itemText = raw.replace(/\s+/g, ' ').trim();
            out.push(makeTextBlock(itemText, 'normal', keys, listItem));
          }
        }
        i = endIndex + endMarker.length;
        continue;
      }
    }

    // Plain paragraph: until a blank line or a block-level command.
    const paraEnd = ((): number => {
      let j = i;
      while (j < text.length) {
        if (text.startsWith('\n\n', j)) return j;
        if (text.startsWith('\n@', j)) {
          const next = text.slice(j + 1);
          if (
            /^@(chapter|section|subsection|subsubsection|itemize|enumerate|quotation|example|end)\b/.test(next)
          ) {
            return j;
          }
        }
        j += 1;
      }
      return text.length;
    })();
    const para = text.slice(i, paraEnd).trim().replace(/\s+/g, ' ');
    if (para !== '') out.push(makeTextBlock(para, 'normal', keys));
    i = paraEnd;
  }

  return out;
}

// --- Format ---------------------------------------------------------------

export const texinfoFormat: Format = {
  id: 'texinfo',
  label: 'GNU Texinfo',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return texinfoToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTexinfo(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^@(chapter|section|subsection|subsubsection)\s/m.test(value)) hits += 2;
    if (/^@(itemize|enumerate|example|quotation)\b/m.test(value)) hits += 2;
    if (/@(b|i|emph|code|var|samp|strong)\{[^}\n]+\}/.test(value)) hits += 1;
    if (/@uref\{[^}\n]+\}/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default texinfoFormat;
