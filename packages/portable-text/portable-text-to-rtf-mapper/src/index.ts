import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * RTF (Rich Text Format) <-> Portable Text.
 *
 * RTF is Microsoft's text-based rich format (`{\rtf1 …}`). We model a
 * tractable subset:
 *
 *   Block:
 *     - `\par` separates paragraphs
 *     - `\s1` … `\s6` at the start of a paragraph map to heading styles
 *       `h1` … `h6` (matching the de-facto Word "Heading N" stylesheet)
 *     - `\qj` / `\ql` etc. are ignored (no alignment in PT)
 *
 *   Inline toggles (RTF "destination toggles", reset by their `0` variants
 *   or by `\plain`):
 *     - `\b` / `\b0`        → `strong`
 *     - `\i` / `\i0`        → `em`
 *     - `\ul` / `\ulnone`   → `underline`
 *     - `\strike` / `\strike0` → `strike-through`
 *     - `\super`, `\sub`, reset by `\nosupersub`
 *
 *   Hyperlinks:
 *     - `{\field{\*\fldinst HYPERLINK "url"}{\fldrslt text}}` → markDef link
 *
 *   Escapes:
 *     - `\\`, `\{`, `\}` → literal characters
 *     - `\'XX` → byte (high-ASCII / Latin-1 — decoded as Latin-1)
 *     - `\u<n>` followed by a single-byte substitute char → Unicode codepoint
 *
 * Font tables, colour tables, embedded images, lists (\pntext), and the
 * broader RTF specification are intentionally out of scope.
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

// --- Lexer ----------------------------------------------------------------

type Token =
  | { kind: 'group-open' }
  | { kind: 'group-close' }
  | { kind: 'control', word: string, param: number | null }
  | { kind: 'text', text: string };

function tokenise(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = input.length;
  let textBuf = '';
  const flushText = (): void => {
    if (textBuf.length) {
      out.push({ kind: 'text', text: textBuf });
      textBuf = '';
    }
  };
  while (i < len) {
    const c = input[i]!;
    if (c === '\r' || c === '\n') {
      i += 1;
      continue;
    }
    if (c === '{') {
      flushText();
      out.push({ kind: 'group-open' });
      i += 1;
      continue;
    }
    if (c === '}') {
      flushText();
      out.push({ kind: 'group-close' });
      i += 1;
      continue;
    }
    if (c === '\\') {
      const next = input[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        textBuf += next;
        i += 2;
        continue;
      }
      if (next === "'") {
        // \'XX byte
        const hex = input.slice(i + 2, i + 4);
        i += 4;
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) textBuf += String.fromCharCode(code);
        continue;
      }
      // Control word: letters then optional number.
      let j = i + 1;
      while (j < len && /[A-Za-z]/.test(input[j]!)) j += 1;
      const word = input.slice(i + 1, j);
      let param: number | null = null;
      if (j < len && (input[j] === '-' || /\d/.test(input[j]!))) {
        let k = j;
        if (input[k] === '-') k += 1;
        while (k < len && /\d/.test(input[k]!)) k += 1;
        param = parseInt(input.slice(j, k), 10);
        j = k;
      }
      // A single trailing space is a delimiter and gets consumed.
      if (input[j] === ' ') j += 1;
      flushText();
      out.push({ kind: 'control', word, param });
      i = j;
      continue;
    }
    textBuf += c;
    i += 1;
  }
  flushText();
  return out;
}

// --- RTF -> PT ------------------------------------------------------------

interface StyleState {
  b: boolean;
  i: boolean;
  ul: boolean;
  strike: boolean;
  superSub: 'super' | 'sub' | null;
  linkKey: string | null;
}

function emptyStyle(): StyleState {
  return { b: false, i: false, ul: false, strike: false, superSub: null, linkKey: null };
}

function decoratorsFor(state: StyleState): string[] {
  const out: string[] = [];
  if (state.b) out.push('strong');
  if (state.i) out.push('em');
  if (state.ul) out.push('underline');
  if (state.strike) out.push('strike-through');
  if (state.superSub === 'super') out.push('sup');
  else if (state.superSub === 'sub') out.push('sub');
  return out;
}

interface SpanBuf {
  text: string;
  state: StyleState;
}

interface ParaBuf {
  spans: SpanBuf[];
  style: string;
  markDefs: PortableTextMarkDefinition[];
}

function newPara(): ParaBuf {
  return { spans: [], style: 'normal', markDefs: [] };
}

function pushChar(para: ParaBuf, ch: string, state: StyleState): void {
  const last = para.spans[para.spans.length - 1];
  if (last && sameStyle(last.state, state)) {
    last.text += ch;
  } else {
    para.spans.push({ text: ch, state: { ...state } });
  }
}

function sameStyle(a: StyleState, b: StyleState): boolean {
  return (
    a.b === b.b
    && a.i === b.i
    && a.ul === b.ul
    && a.strike === b.strike
    && a.superSub === b.superSub
    && a.linkKey === b.linkKey
  );
}

function flushParagraph(para: ParaBuf, keys: Keys, out: PortableTextDocument): void {
  if (para.spans.length === 0 && para.style === 'normal' && para.markDefs.length === 0) return;
  const children: PortableTextSpan[] = para.spans
    .filter(s => s.text.length > 0)
    .map(s => {
      const marks = decoratorsFor(s.state);
      if (s.state.linkKey) marks.push(s.state.linkKey);
      return { _type: 'span' as const, _key: keys.span(), text: s.text, marks };
    });
  if (children.length === 0) children.push({ _type: 'span', _key: keys.span(), text: '', marks: [] });
  out.push({
    _type: 'block',
    _key: keys.block(),
    style: para.style,
    markDefs: para.markDefs,
    children,
  } as PortableTextBlock);
}

export function rtfToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const tokens = tokenise(input);

  // Group stack — entering `{` pushes a copy of the current style for the
  // group scope; `}` restores it.
  const stack: StyleState[] = [emptyStyle()];
  let para = newPara();
  // Track destinations we should ignore wholesale (font/color tables, etc.).
  let ignoreDepth = 0;
  let groupDepth = 0;

  // Hyperlink state machine: we recognise the precise nested-group shape that
  // Word / WordPad emit for HYPERLINK fields.
  let inField = false;
  let inFldInst = false;
  let inFldRslt = false;
  let pendingHref: string | null = null;
  let fieldGroupDepth = 0;
  let fldRsltGroupDepth = 0;

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.kind === 'group-open') {
      groupDepth += 1;
      stack.push({ ...stack[stack.length - 1]! });
      if (ignoreDepth > 0) ignoreDepth += 1;
      if (inFldInst || inFldRslt || inField) {
        if (inField) fieldGroupDepth += 1;
        if (inFldRslt) fldRsltGroupDepth += 1;
      }
      i += 1;
      continue;
    }
    if (tok.kind === 'group-close') {
      groupDepth -= 1;
      stack.pop();
      if (stack.length === 0) stack.push(emptyStyle());
      if (ignoreDepth > 0) ignoreDepth -= 1;
      if (inFldRslt) {
        fldRsltGroupDepth -= 1;
        if (fldRsltGroupDepth <= 0) {
          inFldRslt = false;
          // After the result body ends, drop the link key from the active state.
          const top = stack[stack.length - 1]!;
          top.linkKey = null;
        }
      }
      if (inField) {
        fieldGroupDepth -= 1;
        if (fieldGroupDepth <= 0) {
          inField = false;
          inFldInst = false;
          pendingHref = null;
        }
      }
      i += 1;
      continue;
    }
    if (tok.kind === 'control') {
      const word = tok.word;
      const param = tok.param;
      const top = stack[stack.length - 1]!;
      // Destinations / tables to skip wholesale.
      if (
        word === 'fonttbl'
        || word === 'colortbl'
        || word === 'stylesheet'
        || word === 'info'
        || word === 'header'
        || word === 'footer'
        || word === 'pict'
        || word === 'object'
      ) {
        ignoreDepth = 1;
        i += 1;
        continue;
      }
      if (ignoreDepth > 0) {
        i += 1;
        continue;
      }
      if (
        word === 'rtf' || word === 'ansi' || word === 'ansicpg' || word === 'deff' || word === 'uc'
        || word === 'viewkind' || word === 'lang'
      ) {
        i += 1;
        continue;
      }
      if (word === 'b') {
        top.b = param !== 0;
        i += 1;
        continue;
      }
      if (word === 'i') {
        top.i = param !== 0;
        i += 1;
        continue;
      }
      if (word === 'ul') {
        top.ul = param !== 0;
        i += 1;
        continue;
      }
      if (word === 'ulnone') {
        top.ul = false;
        i += 1;
        continue;
      }
      if (word === 'strike') {
        top.strike = param !== 0;
        i += 1;
        continue;
      }
      if (word === 'super') {
        top.superSub = 'super';
        i += 1;
        continue;
      }
      if (word === 'sub') {
        top.superSub = 'sub';
        i += 1;
        continue;
      }
      if (word === 'nosupersub') {
        top.superSub = null;
        i += 1;
        continue;
      }
      if (word === 'plain') {
        top.b = false;
        top.i = false;
        top.ul = false;
        top.strike = false;
        top.superSub = null;
        i += 1;
        continue;
      }
      if (word === 's' && param != null && param >= 1 && param <= 6) {
        para.style = `h${param}`;
        i += 1;
        continue;
      }
      if (word === 'par') {
        flushParagraph(para, keys, out);
        para = newPara();
        i += 1;
        continue;
      }
      if (word === 'line') {
        pushChar(para, '\n', top);
        i += 1;
        continue;
      }
      if (word === 'field') {
        inField = true;
        fieldGroupDepth = 1;
        i += 1;
        continue;
      }
      if (word === 'fldinst') {
        inFldInst = true;
        i += 1;
        continue;
      }
      if (word === 'fldrslt') {
        inFldInst = false;
        inFldRslt = true;
        fldRsltGroupDepth = 1;
        // If we extracted an HREF earlier, promote it to a markDef now and
        // attach to the active style.
        if (pendingHref != null) {
          const key = keys.mark();
          para.markDefs.push({ _type: 'link', _key: key, href: pendingHref });
          stack[stack.length - 1]!.linkKey = key;
          pendingHref = null;
        }
        i += 1;
        continue;
      }
      if (word === 'tab') {
        pushChar(para, '\t', top);
        i += 1;
        continue;
      }
      if (word === 'u' && param != null) {
        pushChar(para, String.fromCodePoint(param < 0 ? param + 65536 : param), top);
        // Skip the substitute char that follows (uc=1 default).
        // Lookahead: drop the next single-character text token's first char.
        const nextTok = tokens[i + 1];
        if (nextTok && nextTok.kind === 'text' && nextTok.text.length > 0) {
          nextTok.text = nextTok.text.slice(1);
        }
        i += 1;
        continue;
      }
      // Unknown control word — ignore.
      i += 1;
      continue;
    }
    // Text token.
    if (ignoreDepth > 0) {
      i += 1;
      continue;
    }
    if (inFldInst) {
      // Look for `HYPERLINK "url"` inside the instruction.
      const m = /HYPERLINK\s+"([^"]+)"/.exec(tok.text);
      if (m) pendingHref = m[1]!;
      i += 1;
      continue;
    }
    const top = stack[stack.length - 1]!;
    for (const ch of tok.text) pushChar(para, ch, top);
    i += 1;
  }
  flushParagraph(para, keys, out);
  return out;
}

// --- PT -> RTF ------------------------------------------------------------

function spansToRtf(spans: PortableTextSpan[], markDefs: PortableTextMarkDefinition[]): string {
  let out = '';
  for (const span of spans) {
    const marks = span.marks ?? [];
    const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
    const bold = marks.includes('strong');
    const italic = marks.includes('em');
    const under = marks.includes('underline');
    const strike = marks.includes('strike-through');
    const sup = marks.includes('sup');
    const sub = marks.includes('sub');

    const opens: string[] = [];
    const closes: string[] = [];
    if (bold) {
      opens.push('\\b');
      closes.unshift('\\b0');
    }
    if (italic) {
      opens.push('\\i');
      closes.unshift('\\i0');
    }
    if (under) {
      opens.push('\\ul');
      closes.unshift('\\ulnone');
    }
    if (strike) {
      opens.push('\\strike');
      closes.unshift('\\strike0');
    }
    if (sup) {
      opens.push('\\super');
      closes.unshift('\\nosupersub');
    } else if (sub) {
      opens.push('\\sub');
      closes.unshift('\\nosupersub');
    }

    const escaped = escapeRtf(span.text);
    let chunk = `${opens.join('')} ${escaped}${closes.join('')}`;
    // Trim trailing space-separator if opens was empty.
    if (opens.length === 0) chunk = escaped;

    if (linkKey) {
      const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
      out += `{\\field{\\*\\fldinst HYPERLINK "${escapeRtf(href)}"}{\\fldrslt ${chunk}}}`;
    } else {
      out += chunk;
    }
  }
  return out;
}

function escapeRtf(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/[-￿]/g, ch => `\\u${ch.charCodeAt(0)} ?`);
}

export function portableTextToRtf(doc: PortableTextDocument): string {
  const parts: string[] = ['{\\rtf1\\ansi\\ansicpg1252'];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      // Render code block as a single paragraph with no inline marks.
      const escaped = escapeRtf(code).replace(/\n/g, '\\line ');
      parts.push(`\\plain ${escaped}\\par`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const rendered = spansToRtf((b.children ?? []) as PortableTextSpan[], markDefs);
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    let prefix = '\\plain';
    if (headingMatch) prefix = `\\s${headingMatch[1]} \\plain`;
    parts.push(`${prefix} ${rendered}\\par`);
  }
  parts.push('}');
  return parts.join('\n');
}

// --- Format ---------------------------------------------------------------

export const rtfFormat: Format = {
  id: 'rtf',
  label: 'RTF (Rich Text Format)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return rtfToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToRtf(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^\{\\rtf\d/.test(value)) hits += 4;
    if (/\\par\b/.test(value)) hits += 1;
    if (/\\b0?\b|\\i0?\b|\\ul/.test(value)) hits += 1;
    if (/\\fonttbl|\\colortbl/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default rtfFormat;
