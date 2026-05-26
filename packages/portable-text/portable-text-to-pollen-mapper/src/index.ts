import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Pollen <-> Portable Text.
 *
 * Pollen is Matthew Butterick's Racket-based publishing language; commands
 * begin with the lozenge character `◊` (U+25CA). A command has the shape:
 *
 *     ◊name              — bare tag, no body
 *     ◊name{body}        — tag with text body
 *     ◊name[args]{body}  — tag with bracketed args + body
 *
 * We model the constructs that map onto Portable Text:
 *
 *   Blocks:
 *     - `◊h1{…}` … `◊h6{…}`         → block style `h1`..`h6`
 *     - `◊p{…}`                      → block style `normal`
 *     - `◊blockquote{…}`             → block style `blockquote`
 *     - `◊code-block{…}` or `◊pre{◊code{…}}` → `code` block
 *     - `◊ul{◊item{…}}` / `◊ol{◊item{…}}` → bullet / number list blocks
 *     - `◊hr`                        → `hr` block
 *
 *   Inline:
 *     - `◊strong{…}` / `◊b{…}`       → `strong`
 *     - `◊em{…}` / `◊i{…}`           → `em`
 *     - `◊u{…}`                      → `underline`
 *     - `◊s{…}` / `◊del{…}`          → `strike-through`
 *     - `◊sub{…}` / `◊sup{…}`        → `sub` / `sup`
 *     - `◊code{…}`                   → `code`
 *     - `◊link["url"]{…}` (or `◊a["url"]{…}`) → `markDefs[link]`
 *
 *   Comments: `◊;…` (line) and `◊;{…}` (block) are stripped on parse.
 *
 * Top-level prose with no command becomes a `normal` block. The `#lang
 * pollen` shebang is consumed if present at the top.
 */

const LOZENGE = '◊';

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

// --- Tokeniser: produces a tree of nodes -----------------------------------

interface CommandNode {
  kind: 'cmd';
  name: string;
  arg: string | null; // raw `[…]` body, sans brackets, or null if absent
  children: PollenNode[];
}
interface TextNode {
  kind: 'text';
  text: string;
}
type PollenNode = CommandNode | TextNode;

function parsePollen(input: string): PollenNode[] {
  // Strip `#lang pollen` shebang if present.
  const cleaned = input.replace(/^#lang\s+\S+\s*\n?/, '');
  return parseNodes(cleaned, 0, null).nodes;
}

interface ParseResult {
  nodes: PollenNode[];
  next: number;
}

function parseNodes(input: string, start: number, terminator: '}' | null): ParseResult {
  const out: PollenNode[] = [];
  let i = start;
  let buf = '';
  const flushBuf = (): void => {
    if (buf.length) {
      out.push({ kind: 'text', text: buf });
      buf = '';
    }
  };
  while (i < input.length) {
    const c = input[i]!;
    if (terminator && c === terminator) {
      flushBuf();
      return { nodes: out, next: i + 1 };
    }
    if (c === LOZENGE) {
      // Parse `◊` command.
      // Comments first: `◊;…` to EOL, or `◊;{…}` (balanced braces).
      if (input[i + 1] === ';') {
        if (input[i + 2] === '{') {
          // Block comment: skip until matching `}`.
          const after = skipBalancedBraces(input, i + 2);
          i = after;
          continue;
        }
        // Line comment: skip to EOL.
        let j = i + 2;
        while (j < input.length && input[j] !== '\n') j += 1;
        i = j;
        continue;
      }
      // Tag name.
      let j = i + 1;
      while (
        j < input.length
        && /[A-Za-z0-9_:.\-?!*+]/.test(input[j]!)
      ) {
        j += 1;
      }
      if (j === i + 1) {
        // Lonely lozenge — emit as literal.
        buf += c;
        i += 1;
        continue;
      }
      const name = input.slice(i + 1, j);
      flushBuf();
      // Optional `[args]`.
      let arg: string | null = null;
      if (input[j] === '[') {
        const argEnd = findMatchingBracket(input, j, '[', ']');
        if (argEnd !== -1) {
          arg = input.slice(j + 1, argEnd);
          j = argEnd + 1;
        }
      }
      // Optional `{body}` (recurse).
      let children: PollenNode[] = [];
      if (input[j] === '{') {
        const inner = parseNodes(input, j + 1, '}');
        children = inner.nodes;
        j = inner.next;
      }
      out.push({ kind: 'cmd', name, arg, children });
      i = j;
      continue;
    }
    buf += c;
    i += 1;
  }
  flushBuf();
  return { nodes: out, next: i };
}

function skipBalancedBraces(input: string, openPos: number): number {
  let depth = 1;
  let i = openPos + 1;
  while (i < input.length && depth > 0) {
    const c = input[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    i += 1;
  }
  return i;
}

function findMatchingBracket(input: string, openPos: number, open: string, close: string): number {
  let depth = 1;
  let i = openPos + 1;
  while (i < input.length) {
    const c = input[i];
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

// --- AST -> PT ------------------------------------------------------------

const INLINE_DECORATORS: Record<string, string> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'underline',
  s: 'strike-through',
  del: 'strike-through',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

const BLOCK_HEADING_RE = /^h([1-6])$/;

interface State {
  keys: Keys;
  out: PortableTextDocument;
}

function collectInline(
  nodes: PollenNode[],
  markDefs: PortableTextMarkDefinition[],
  inheritedMarks: string[],
  keys: Keys,
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      const text = node.text;
      if (text.length === 0) continue;
      out.push({ _type: 'span', _key: keys.span(), text, marks: inheritedMarks });
      continue;
    }
    const decorator = INLINE_DECORATORS[node.name];
    if (decorator) {
      out.push(...collectInline(node.children, markDefs, [...inheritedMarks, decorator], keys));
      continue;
    }
    if (node.name === 'link' || node.name === 'a') {
      const href = node.arg ? extractFirstString(node.arg) : '';
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href });
      out.push(...collectInline(node.children, markDefs, [...inheritedMarks, key], keys));
      continue;
    }
    // Unknown command in inline position: flatten its children with the
    // inherited marks. (Drops the tag but keeps the prose.)
    out.push(...collectInline(node.children, markDefs, inheritedMarks, keys));
  }
  return out;
}

function extractFirstString(arg: string): string {
  // Racket-style: arg may be `"url"`, `'url'`, or `key: "value"`.
  const m = /"([^"]*)"|'([^']*)'/.exec(arg);
  if (m) return m[1] ?? m[2] ?? '';
  return arg.trim();
}

function emitListItems(node: CommandNode, listItem: 'bullet' | 'number', s: State): void {
  for (const child of node.children) {
    if (child.kind !== 'cmd' || (child.name !== 'item' && child.name !== 'li')) continue;
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = collectInline(child.children, markDefs, [], s.keys);
    const block: PortableTextBlock = {
      _type: 'block',
      _key: s.keys.block(),
      style: 'normal',
      markDefs,
      children: children.length ? children : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
    };
    (block as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
    (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
    s.out.push(block);
  }
}

function emitFromBlockNode(node: PollenNode, s: State): void {
  if (node.kind === 'text') {
    const text = node.text;
    if (text.trim() === '') return;
    s.out.push({
      _type: 'block',
      _key: s.keys.block(),
      style: 'normal',
      markDefs: [],
      children: [{ _type: 'span', _key: s.keys.span(), text, marks: [] }],
    } as PortableTextBlock);
    return;
  }
  const headingMatch = BLOCK_HEADING_RE.exec(node.name);
  if (headingMatch) {
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = collectInline(node.children, markDefs, [], s.keys);
    s.out.push({
      _type: 'block',
      _key: s.keys.block(),
      style: `h${headingMatch[1]}`,
      markDefs,
      children,
    } as PortableTextBlock);
    return;
  }
  if (node.name === 'p') {
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = collectInline(node.children, markDefs, [], s.keys);
    s.out.push({
      _type: 'block',
      _key: s.keys.block(),
      style: 'normal',
      markDefs,
      children: children.length ? children : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
    } as PortableTextBlock);
    return;
  }
  if (node.name === 'blockquote') {
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = collectInline(node.children, markDefs, [], s.keys);
    s.out.push({
      _type: 'block',
      _key: s.keys.block(),
      style: 'blockquote',
      markDefs,
      children,
    } as PortableTextBlock);
    return;
  }
  if (node.name === 'hr') {
    s.out.push({ _type: 'hr', _key: s.keys.block() } as unknown as PortableTextBlock);
    return;
  }
  if (
    node.name === 'code-block'
    || (node.name === 'pre' && node.children[0]?.kind === 'cmd' && (node.children[0] as CommandNode).name === 'code')
  ) {
    const innerCmd = node.name === 'code-block'
      ? node
      : (node.children[0] as CommandNode);
    const text = innerCmd.children
      .map(c => (c.kind === 'text' ? c.text : ''))
      .join('');
    s.out.push({
      _type: 'code',
      _key: s.keys.block(),
      code: text,
      language: null,
    } as unknown as PortableTextBlock);
    return;
  }
  if (node.name === 'ul') {
    emitListItems(node, 'bullet', s);
    return;
  }
  if (node.name === 'ol') {
    emitListItems(node, 'number', s);
    return;
  }
  // Unknown block-level command: flatten its body as a paragraph.
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = collectInline(node.children, markDefs, [], s.keys);
  if (children.length === 0) return;
  s.out.push({
    _type: 'block',
    _key: s.keys.block(),
    style: 'normal',
    markDefs,
    children,
  } as PortableTextBlock);
}

export function pollenToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const state: State = { keys, out: [] };
  const nodes = parsePollen(input);
  for (const node of nodes) emitFromBlockNode(node, state);
  return state.out;
}

// --- PT -> Pollen ---------------------------------------------------------

const DECORATOR_TO_TAG: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  'strike-through': 'del',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function spanToPollen(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text;
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  for (const mark of marks) {
    if (mark === linkKey) continue;
    const tag = DECORATOR_TO_TAG[mark];
    if (tag) text = `${LOZENGE}${tag}{${text}}`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    text = `${LOZENGE}link["${href}"]{${text}}`;
  }
  return text;
}

export function portableTextToPollen(doc: PortableTextDocument): string {
  const out: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  const flushList = (): void => {
    if (listTag) out.push(`}`);
    listTag = null;
  };
  const ensureList = (want: 'ul' | 'ol'): void => {
    if (listTag !== want) {
      flushList();
      listTag = want;
      out.push(`${LOZENGE}${want}{`);
    }
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      flushList();
      out.push(`${LOZENGE}hr`);
      continue;
    }
    if (t === 'code') {
      flushList();
      const code = String((block as { code?: unknown }).code ?? '');
      out.push(`${LOZENGE}code-block{${code}}`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToPollen(s, markDefs)).join('');
    if (b.listItem === 'bullet') {
      ensureList('ul');
      out.push(`  ${LOZENGE}item{${text}}`);
      continue;
    }
    if (b.listItem === 'number') {
      ensureList('ol');
      out.push(`  ${LOZENGE}item{${text}}`);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = BLOCK_HEADING_RE.exec(style);
    if (headingMatch) {
      out.push(`${LOZENGE}h${headingMatch[1]}{${text}}`);
    } else if (style === 'blockquote') {
      out.push(`${LOZENGE}blockquote{${text}}`);
    } else {
      out.push(`${LOZENGE}p{${text}}`);
    }
  }
  flushList();
  return out.join('\n');
}

// --- Format ---------------------------------------------------------------

export const pollenFormat: Format = {
  id: 'pollen',
  label: 'Pollen',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return pollenToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToPollen(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (value.includes(LOZENGE)) {
      // Count distinct command-shaped occurrences.
      const cmdHits = (value.match(/◊[A-Za-z][\w?!*+-]*[{[]/g) ?? []).length;
      hits += Math.min(4, cmdHits);
    }
    if (/^#lang\s+pollen/.test(value)) hits += 3;
    return Math.min(1, hits * 0.22);
  },
};

export default pollenFormat;
