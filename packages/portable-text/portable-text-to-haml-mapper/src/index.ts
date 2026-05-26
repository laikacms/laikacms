import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * HAML <-> Portable Text.
 *
 * HAML is an indentation-sensitive HTML abstraction (Ruby world). We model
 * the subset of constructs that map onto Portable Text:
 *
 *   - `%h1`..`%h6 text`           →  block style `h1`..`h6`
 *   - `%p text`                   →  block style `normal`
 *   - `%blockquote text`          →  block style `blockquote`
 *   - `%hr`                       →  `hr` block
 *   - `%pre` + `%code` child(ren) →  `code` block
 *   - `%ul` / `%ol` of `%li`      →  list blocks with `bullet` / `number`
 *
 * Inline emphasis is expressed by indented child tags inside a block:
 *
 *   %p
 *     plain
 *     %strong bold
 *     more
 *
 * Tag aliases: `%strong` → strong, `%em` → em, `%u` → underline,
 * `%del` / `%s` → strike-through, `%code` → code, `%sub` → sub, `%sup` → sup,
 * `%a{ href: "…" } text` → link.
 *
 * Class/id attribute shorthand (`%p.intro#first`) is parsed but the values
 * are discarded — only structural mapping is preserved.
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

const TAG_TO_DECORATOR: Record<string, string> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'underline',
  del: 'strike-through',
  s: 'strike-through',
  strike: 'strike-through',
  code: 'code',
  sub: 'sub',
  sup: 'sup',
};
const DECORATOR_TO_TAG: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  'strike-through': 'del',
  code: 'code',
  sub: 'sub',
  sup: 'sup',
};

const BLOCK_TAG_TO_STYLE: Record<string, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  p: 'normal',
  blockquote: 'blockquote',
};
const STYLE_TO_BLOCK_TAG: Record<string, string> = Object.fromEntries(
  Object.entries(BLOCK_TAG_TO_STYLE).map(([k, v]) => [v, k]),
);

// --- Line tokeniser -------------------------------------------------------

interface HamlLine {
  indent: number;
  tag: string | null; // null = plain text line
  attrs: Record<string, string>;
  content: string;
  raw: string;
}

// Match `%tag` optionally followed by `.cls`/`#id` shortcuts, then optional
// `{ k: "v", … }` attrs, then optional space + inline content.
const TAG_RE = /^%([a-zA-Z][a-zA-Z0-9_-]*)([.#][^\s{]*)?(?:\{([^}]*)\})?(?:\s+(.*))?$/;

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
}

function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Naive `key: "value", key2: 'value2'` parser; HAML's Ruby hash syntax is
  // strictly richer but we only consume the few attrs we care about (href).
  const re = /(\w+)\s*:\s*(["'])((?:\\.|(?!\2).)*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out[m[1]!] = m[3]!;
  return out;
}

function tokenise(line: string): HamlLine | null {
  const indent = indentOf(line);
  const trimmed = line.slice(indent);
  if (trimmed === '') return null;
  if (trimmed.startsWith('%')) {
    const m = TAG_RE.exec(trimmed);
    if (m) {
      return {
        indent,
        tag: m[1]!,
        attrs: m[3] ? parseAttrs(m[3]) : {},
        content: m[4] ?? '',
        raw: line,
      };
    }
    return { indent, tag: null, attrs: {}, content: trimmed, raw: line };
  }
  // Plain text (escape leading `\`).
  const content = trimmed.startsWith('\\') ? trimmed.slice(1) : trimmed;
  return { indent, tag: null, attrs: {}, content, raw: line };
}

// --- HAML -> PT -----------------------------------------------------------

function childrenToSpans(
  children: HamlLine[],
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
  inheritedMarks: string[] = [],
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  for (const child of children) {
    if (child.tag === null) {
      out.push({ _type: 'span', _key: keys.span(), text: child.content, marks: inheritedMarks });
      continue;
    }
    const decorator = TAG_TO_DECORATOR[child.tag];
    if (decorator) {
      out.push({
        _type: 'span',
        _key: keys.span(),
        text: child.content,
        marks: [...inheritedMarks, decorator],
      });
      continue;
    }
    if (child.tag === 'a') {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: child.attrs.href ?? '' });
      out.push({
        _type: 'span',
        _key: keys.span(),
        text: child.content,
        marks: [...inheritedMarks, key],
      });
      continue;
    }
    // Unknown inline tag — emit as plain text.
    out.push({ _type: 'span', _key: keys.span(), text: child.content, marks: inheritedMarks });
  }
  return out;
}

export function hamlToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const allLines = input.split(/\r?\n/).map(tokenise);

  let i = 0;
  while (i < allLines.length) {
    const line = allLines[i]!;
    if (line === null) {
      i += 1;
      continue;
    }
    // Collect contiguous child lines indented strictly deeper than `line`.
    const childLines: HamlLine[] = [];
    let j = i + 1;
    while (j < allLines.length) {
      const next = allLines[j];
      if (next === null) {
        j += 1;
        continue;
      }
      if (next.indent <= line.indent) break;
      childLines.push(next);
      j += 1;
    }

    if (line.tag === null) {
      // Stray plain text at the top — emit as a paragraph.
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', _key: keys.span(), text: line.content, marks: [] }],
      } as PortableTextBlock);
      i += 1;
      continue;
    }
    if (line.tag === 'hr') {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      i = j;
      continue;
    }
    if (line.tag === 'pre') {
      // Pull the first `%code` child (if any) and join its text descendants.
      const codeChild = childLines.find(c => c.tag === 'code');
      const codeLines: string[] = [];
      if (codeChild) {
        // Lines indented under the %code child are the body.
        const codeIndent = codeChild.indent;
        if (codeChild.content) codeLines.push(codeChild.content);
        for (const c of childLines) {
          if (c === codeChild) continue;
          if (c.indent > codeIndent && c.tag === null) codeLines.push(c.content);
        }
      } else {
        // Inline body or plain-text grandchildren.
        if (line.content) codeLines.push(line.content);
        for (const c of childLines) if (c.tag === null) codeLines.push(c.content);
      }
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: codeLines.join('\n'),
        language: null,
      } as unknown as PortableTextBlock);
      i = j;
      continue;
    }
    if (line.tag === 'ul' || line.tag === 'ol') {
      const listItem = line.tag === 'ol' ? 'number' : 'bullet';
      for (const li of childLines.filter(c => c.tag === 'li' && c.indent === childLines[0]?.indent)) {
        // Each `%li` may carry inline content directly and/or deeper children.
        const liChildren = childLines.filter(c => c !== li && c.indent > li.indent);
        const markDefs: PortableTextMarkDefinition[] = [];
        const spans: PortableTextSpan[] = [];
        if (li.content) {
          spans.push({ _type: 'span', _key: keys.span(), text: li.content, marks: [] });
        }
        spans.push(...childrenToSpans(liChildren, markDefs, keys));
        out.push({
          _type: 'block',
          _key: keys.block(),
          style: 'normal',
          markDefs,
          children: spans,
          listItem,
          level: 1,
        } as PortableTextBlock);
      }
      i = j;
      continue;
    }
    const style = BLOCK_TAG_TO_STYLE[line.tag];
    if (style) {
      const markDefs: PortableTextMarkDefinition[] = [];
      const spans: PortableTextSpan[] = [];
      if (line.content) {
        spans.push({ _type: 'span', _key: keys.span(), text: line.content, marks: [] });
      }
      spans.push(...childrenToSpans(childLines, markDefs, keys));
      if (spans.length === 0) {
        spans.push({ _type: 'span', _key: keys.span(), text: '', marks: [] });
      }
      out.push({
        _type: 'block',
        _key: keys.block(),
        style,
        markDefs,
        children: spans,
      } as PortableTextBlock);
      i = j;
      continue;
    }
    // Unknown block tag — skip the subtree.
    i = j;
  }

  return out;
}

// --- PT -> HAML -----------------------------------------------------------

function spansToHamlChildren(
  spans: PortableTextSpan[],
  markDefs: PortableTextMarkDefinition[],
  indent: string,
): string[] {
  const out: string[] = [];
  for (const span of spans) {
    const marks = span.marks ?? [];
    const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
    const decoratorMark = marks.find(m => DECORATOR_TO_TAG[m]);
    if (linkKey) {
      const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
      out.push(`${indent}%a{ href: "${href}" } ${span.text}`);
      continue;
    }
    if (decoratorMark) {
      const tag = DECORATOR_TO_TAG[decoratorMark]!;
      out.push(`${indent}%${tag} ${span.text}`);
      continue;
    }
    out.push(`${indent}${span.text.startsWith('%') ? '\\' : ''}${span.text}`);
  }
  return out;
}

export function portableTextToHaml(doc: PortableTextDocument): string {
  const lines: string[] = [];
  // Group consecutive list items under a single `%ul` / `%ol`.
  let listTag: 'ul' | 'ol' | null = null;
  const flushList = (): void => {
    listTag = null;
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      flushList();
      lines.push('%hr');
      continue;
    }
    if (t === 'code') {
      flushList();
      lines.push('%pre');
      lines.push('  %code');
      const code = String((block as { code?: unknown }).code ?? '');
      for (const cl of code.split('\n')) lines.push(`    ${cl}`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      const want = b.listItem === 'number' ? 'ol' : 'ul';
      if (listTag !== want) {
        flushList();
        listTag = want;
        lines.push(`%${want}`);
      }
      // Emit a `%li` with inline content children.
      const spans = (b.children ?? []) as PortableTextSpan[];
      const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
      if (spans.length === 1 && (spans[0]!.marks ?? []).length === 0) {
        lines.push(`  %li ${spans[0]!.text}`);
      } else {
        lines.push('  %li');
        lines.push(...spansToHamlChildren(spans, markDefs, '    '));
      }
      continue;
    }
    flushList();
    const tag = STYLE_TO_BLOCK_TAG[b.style ?? 'normal'] ?? 'p';
    const spans = (b.children ?? []) as PortableTextSpan[];
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    if (spans.length === 1 && (spans[0]!.marks ?? []).length === 0) {
      lines.push(`%${tag} ${spans[0]!.text}`);
    } else {
      lines.push(`%${tag}`);
      lines.push(...spansToHamlChildren(spans, markDefs, '  '));
    }
  }
  return lines.join('\n');
}

// --- Format ---------------------------------------------------------------

export const hamlFormat: Format = {
  id: 'haml',
  label: 'HAML',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return hamlToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToHaml(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^%[a-z][a-z0-9]*/m.test(value)) hits += 2;
    if (/^%h[1-6]\s/m.test(value)) hits += 1;
    if (/^%ul$|^%ol$/m.test(value)) hits += 1;
    if (/^%p\s|^%p$/m.test(value)) hits += 1;
    if (/^!!!/m.test(value)) hits += 1; // doctype line
    return Math.min(1, hits * 0.22);
  },
};

export default hamlFormat;
