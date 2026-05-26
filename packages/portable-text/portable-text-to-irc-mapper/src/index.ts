import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextSpan } from '@portabletext/types';

/**
 * mIRC / IRC formatting <-> Portable Text.
 *
 * IRC clients (mIRC, irssi, HexChat, modern web clients) style messages using
 * single-byte control characters embedded in the text. The codes are toggles:
 * the same byte both enables and disables a style.
 *
 *   \u0002  bold        → `strong`
 *   \u001d  italic      → `em`
 *   \u001f  underline   → `underline`
 *   \x1e  strikethr.  → `strike-through`
 *   \x11  monospace   → `code`
 *   \u000f  reset all   → clears every active style
 *
 * Colour codes (`\u0003N` or `\u0003N,M` for foreground + background, where each
 * `N`/`M` is one or two digits) and `\x16` (reverse) are parsed but their
 * styling is *dropped* because Portable Text has no first-class colour
 * decorator. The plain characters before/after them are preserved.
 *
 * Lines separated by `\n` (or blank lines) become separate `normal` blocks.
 * IRC has no semantic concept of headings, lists, or links, so the format is
 * inline-only.
 */

interface Keys {
  block: () => string;
  span: () => string;
}

function newKeys(): Keys {
  return {
    block: createKeyGenerator('b'),
    span: createKeyGenerator('s'),
  };
}

interface StyleState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
}

function emptyStyle(): StyleState {
  return { bold: false, italic: false, underline: false, strike: false, code: false };
}

function decoratorsFor(s: StyleState): string[] {
  const out: string[] = [];
  if (s.bold) out.push('strong');
  if (s.italic) out.push('em');
  if (s.underline) out.push('underline');
  if (s.strike) out.push('strike-through');
  if (s.code) out.push('code');
  return out;
}

function sameStyle(a: StyleState, b: StyleState): boolean {
  return (
    a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
    && a.strike === b.strike
    && a.code === b.code
  );
}

// --- IRC -> PT ------------------------------------------------------------

const BOLD = '\u0002';
const ITALIC = '\u001d';
const UNDERLINE = '\u001f';
const STRIKE = '\x1e';
const CODE = '\x11';
const RESET = '\u000f';
const COLOR = '\u0003';
const REVERSE = '\x16';

function parseIrcLine(line: string, keys: Keys): PortableTextSpan[] {
  const state = emptyStyle();
  let snapshot = emptyStyle();
  let buf = '';
  const spans: PortableTextSpan[] = [];

  const flush = (): void => {
    if (buf.length === 0) return;
    spans.push({
      _type: 'span',
      _key: keys.span(),
      text: buf,
      marks: decoratorsFor(snapshot),
    });
    buf = '';
  };

  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    switch (c) {
      case BOLD:
        flush();
        state.bold = !state.bold;
        snapshot = { ...state };
        i += 1;
        continue;
      case ITALIC:
        flush();
        state.italic = !state.italic;
        snapshot = { ...state };
        i += 1;
        continue;
      case UNDERLINE:
        flush();
        state.underline = !state.underline;
        snapshot = { ...state };
        i += 1;
        continue;
      case STRIKE:
        flush();
        state.strike = !state.strike;
        snapshot = { ...state };
        i += 1;
        continue;
      case CODE:
        flush();
        state.code = !state.code;
        snapshot = { ...state };
        i += 1;
        continue;
      case RESET:
        flush();
        state.bold = false;
        state.italic = false;
        state.underline = false;
        state.strike = false;
        state.code = false;
        snapshot = { ...state };
        i += 1;
        continue;
      case COLOR: {
        // `\u0003` optionally followed by one or two digits for fg, then
        // optionally `,` + one or two digits for bg.
        let j = i + 1;
        if (j < line.length && /\d/.test(line[j]!)) {
          j += 1;
          if (j < line.length && /\d/.test(line[j]!)) j += 1;
          if (line[j] === ',' && j + 1 < line.length && /\d/.test(line[j + 1]!)) {
            j += 2;
            if (j < line.length && /\d/.test(line[j]!)) j += 1;
          }
        }
        // Skip the colour control + its parameters; no style change in PT.
        i = j;
        continue;
      }
      case REVERSE:
        // Drop the reverse-video toggle silently.
        i += 1;
        continue;
      default:
        if (!sameStyle(state, snapshot)) {
          flush();
          snapshot = { ...state };
        }
        buf += c;
        i += 1;
    }
  }
  flush();
  return spans;
}

export function ircToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const paragraphs = input.split(/\r?\n\s*\r?\n/);
  for (const para of paragraphs) {
    // eslint-disable-next-line no-control-regex
    if (!para.replace(/[\u0000-\u001f]/g, '').length) continue;
    // Each remaining newline inside a paragraph becomes a literal newline in
    // the span run.
    const spans = parseIrcLine(para, keys);
    if (spans.length === 0) continue;
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      markDefs: [],
      children: spans,
    } as PortableTextBlock);
  }
  return out;
}

// --- PT -> IRC ------------------------------------------------------------

function spanToIrc(span: PortableTextSpan): string {
  const marks = span.marks ?? [];
  const opens: string[] = [];
  const closes: string[] = [];
  if (marks.includes('strong')) {
    opens.push(BOLD);
    closes.unshift(BOLD);
  }
  if (marks.includes('em')) {
    opens.push(ITALIC);
    closes.unshift(ITALIC);
  }
  if (marks.includes('underline')) {
    opens.push(UNDERLINE);
    closes.unshift(UNDERLINE);
  }
  if (marks.includes('strike-through')) {
    opens.push(STRIKE);
    closes.unshift(STRIKE);
  }
  if (marks.includes('code')) {
    opens.push(CODE);
    closes.unshift(CODE);
  }
  return `${opens.join('')}${span.text}${closes.join('')}`;
}

export function portableTextToIrc(doc: PortableTextDocument): string {
  const paragraphs: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const text = ((b.children ?? []) as PortableTextSpan[]).map(spanToIrc).join('');
    paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

// --- Format ---------------------------------------------------------------

export const ircFormat: Format = {
  id: 'irc',
  label: 'IRC formatting',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return ircToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToIrc(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    // Look for the toggle control bytes characteristic of IRC.
    // eslint-disable-next-line no-control-regex
    if (/\u0002/.test(value)) hits += 1;
    // eslint-disable-next-line no-control-regex
    if (/\u001f/.test(value)) hits += 1;
    // eslint-disable-next-line no-control-regex
    if (/\u001d/.test(value)) hits += 1;
    // eslint-disable-next-line no-control-regex
    if (/\u000f/.test(value)) hits += 1;
    // eslint-disable-next-line no-control-regex
    if (/\u0003\d/.test(value)) hits += 1;
    return Math.min(1, hits * 0.3);
  },
};

export default ircFormat;
