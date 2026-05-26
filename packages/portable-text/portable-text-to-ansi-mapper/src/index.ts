import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * ANSI escape-coded terminal text <-> Portable Text.
 *
 * ANSI text has no native concept of "blocks" beyond newlines, so each line
 * (or run of non-blank lines) becomes a single `normal` PT block. Inline
 * styling comes from SGR (Select Graphic Rendition) escapes — `ESC [ … m` —
 * and hyperlinks come from OSC 8.
 *
 * SGR codes we model:
 *
 *   - `1` → `strong`               `22` → reset
 *   - `3` → `em`                   `23` → reset
 *   - `4` → `underline`            `24` → reset
 *   - `9` → `strike-through`       `29` → reset
 *   - `0` → reset all
 *
 *   Colour codes (`30-37`, `40-47`, `90-97`, `100-107`, the 256-colour
 *   `38;5;N` / `48;5;N` and the true-colour `38;2;R;G;B` / `48;2;R;G;B`
 *   sequences) are recognised and *discarded*. The reasoning is that PT
 *   doesn't have a first-class colour decorator; round-tripping arbitrary
 *   colours would require carrying them as opaque marks, which is brittle
 *   when documents are edited.
 *
 * OSC 8 hyperlinks (`ESC ] 8 ; ; <url> ESC \\` … `ESC ] 8 ; ; ESC \\`) map to
 * `markDefs[link]`.
 *
 * Cursor-positioning sequences and the remainder of the broader ANSI X3.64
 * escape set are stripped on parse.
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

interface StyleState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  linkHref: string | null;
}

function emptyStyle(): StyleState {
  return { bold: false, italic: false, underline: false, strike: false, linkHref: null };
}

function decoratorsFor(s: StyleState): string[] {
  const out: string[] = [];
  if (s.bold) out.push('strong');
  if (s.italic) out.push('em');
  if (s.underline) out.push('underline');
  if (s.strike) out.push('strike-through');
  return out;
}

// --- ANSI -> PT -----------------------------------------------------------

const ESC = '\u001b';
const ST = '\u001b\\'; // string terminator for OSC

function applySgrParams(params: number[], state: StyleState): void {
  // Empty `ESC[m` (no params) is equivalent to `ESC[0m` = reset all.
  if (params.length === 0) {
    state.bold = false;
    state.italic = false;
    state.underline = false;
    state.strike = false;
    return;
  }
  let i = 0;
  while (i < params.length) {
    const p = params[i]!;
    switch (p) {
      case 0:
        state.bold = false;
        state.italic = false;
        state.underline = false;
        state.strike = false;
        break;
      case 1:
        state.bold = true;
        break;
      case 3:
        state.italic = true;
        break;
      case 4:
        state.underline = true;
        break;
      case 9:
        state.strike = true;
        break;
      case 22:
        state.bold = false;
        break;
      case 23:
        state.italic = false;
        break;
      case 24:
        state.underline = false;
        break;
      case 29:
        state.strike = false;
        break;
      case 38:
      case 48:
        // 256-colour: `38;5;N` (3 params). True-colour: `38;2;R;G;B` (5 params).
        if (params[i + 1] === 5) {
          i += 2; // consume `5;N`
        } else if (params[i + 1] === 2) {
          i += 4; // consume `2;R;G;B`
        }
        break;
      default:
        // 30-37, 39, 40-47, 49, 90-97, 100-107 (colours / faint / etc.) → drop.
        break;
    }
    i += 1;
  }
}

export function ansiToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  // Split into paragraphs on blank lines; single newlines inside a paragraph
  // are preserved as literal `\n` inside spans.
  const paragraphs = input.split(/\r?\n\s*\r?\n/);
  for (const para of paragraphs) {
    // eslint-disable-next-line no-control-regex
    if (para.replace(/[\u0000-\u001f]/g, '').trim() === '') continue;
    const { spans, markDefs } = parseAnsiInline(para, keys);
    if (spans.length === 0) continue;
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      markDefs,
      children: spans,
    } as PortableTextBlock);
  }
  return out;
}

function parseAnsiInline(
  input: string,
  keys: Keys,
): { spans: PortableTextSpan[], markDefs: PortableTextMarkDefinition[] } {
  const markDefs: PortableTextMarkDefinition[] = [];
  const spans: PortableTextSpan[] = [];
  const state = emptyStyle();
  let activeLinkKey: string | null = null;
  let buf = '';
  type Snapshot = StyleState & { linkKey: string | null };
  let bufSnapshot: Snapshot = { ...state, linkKey: activeLinkKey };

  const flush = (): void => {
    if (buf.length === 0) return;
    const marks = decoratorsFor({ ...bufSnapshot, linkHref: null });
    if (bufSnapshot.linkKey) marks.push(bufSnapshot.linkKey);
    spans.push({ _type: 'span', _key: keys.span(), text: buf, marks });
    buf = '';
  };

  const stateChanged = (): boolean => {
    return (
      bufSnapshot.bold !== state.bold
      || bufSnapshot.italic !== state.italic
      || bufSnapshot.underline !== state.underline
      || bufSnapshot.strike !== state.strike
      || bufSnapshot.linkKey !== activeLinkKey
    );
  };

  let i = 0;
  while (i < input.length) {
    if (input[i] === ESC) {
      // OSC 8 hyperlink: `ESC ] 8 ; <params> ; <uri> ST` where ST is `ESC \\` or BEL (`\x07`).
      if (input.startsWith(`${ESC}]8;`, i)) {
        // Locate the ST terminator.
        const stIdx = findOscTerminator(input, i + 4);
        if (stIdx !== -1) {
          const oscBody = input.slice(i + 4, stIdx); // `<params>;<uri>`
          const semi = oscBody.indexOf(';');
          const uri = semi === -1 ? '' : oscBody.slice(semi + 1);
          flush();
          if (uri) {
            const key = keys.mark();
            markDefs.push({ _type: 'link', _key: key, href: uri });
            activeLinkKey = key;
          } else {
            activeLinkKey = null;
          }
          bufSnapshot = { ...state, linkKey: activeLinkKey };
          // ST is either `ESC\\` (2 chars) or `\x07` (1 char).
          i = stIdx + (input[stIdx] === '\x07' ? 1 : 2);
          continue;
        }
      }
      // CSI SGR: `ESC [ <params> m`
      if (input[i + 1] === '[') {
        // Find final byte (a letter from `@` to `~`).
        let j = i + 2;
        while (j < input.length && !/[@-~]/.test(input[j]!)) j += 1;
        if (j < input.length) {
          const finalByte = input[j]!;
          if (finalByte === 'm') {
            const paramStr = input.slice(i + 2, j);
            const params = paramStr === ''
              ? []
              : paramStr.split(';').map(p => Number.parseInt(p, 10) || 0);
            // Always flush before applying a new SGR — any buffered text
            // belongs to the *previous* style state, not the one we are
            // about to switch into. (Skipping the flush would let, e.g.,
            // `\u001b[1mbold\u001b[22m` drop the bold mark from the "bold"
            // chunk because we updated `bufSnapshot` before flushing.)
            flush();
            applySgrParams(params, state);
            bufSnapshot = { ...state, linkKey: activeLinkKey };
            i = j + 1;
            continue;
          }
          // Non-SGR CSI — drop quietly.
          i = j + 1;
          continue;
        }
      }
      // Unknown escape — drop two chars.
      i += 2;
      continue;
    }
    if (stateChanged()) {
      flush();
      bufSnapshot = { ...state, linkKey: activeLinkKey };
    }
    buf += input[i];
    i += 1;
  }
  flush();
  return { spans, markDefs };
}

function findOscTerminator(input: string, from: number): number {
  for (let i = from; i < input.length; i += 1) {
    if (input[i] === '\x07') return i;
    if (input[i] === ESC && input[i + 1] === '\\') return i;
  }
  return -1;
}

// --- PT -> ANSI -----------------------------------------------------------

function spanToAnsi(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  const opens: string[] = [];
  const closes: string[] = [];
  if (marks.includes('strong')) {
    opens.push('1');
    closes.unshift('22');
  }
  if (marks.includes('em')) {
    opens.push('3');
    closes.unshift('23');
  }
  if (marks.includes('underline')) {
    opens.push('4');
    closes.unshift('24');
  }
  if (marks.includes('strike-through')) {
    opens.push('9');
    closes.unshift('29');
  }
  let text = span.text;
  if (opens.length) text = `${ESC}[${opens.join(';')}m${text}${ESC}[${closes.join(';')}m`;
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    text = `${ESC}]8;;${href}${ST}${text}${ESC}]8;;${ST}`;
  }
  return text;
}

export function portableTextToAnsi(doc: PortableTextDocument): string {
  const paragraphs: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToAnsi(s, markDefs)).join('');
    paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

// --- Format ---------------------------------------------------------------

export const ansiFormat: Format = {
  id: 'ansi',
  label: 'ANSI terminal text',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return ansiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToAnsi(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    // CSI SGR sequences.
    // eslint-disable-next-line no-control-regex
    const sgr = value.match(/\u001b\[[\d;]*m/g);
    if (sgr) hits += Math.min(3, sgr.length);
    // OSC 8 hyperlink openings.
    // eslint-disable-next-line no-control-regex
    if (/\u001b\]8;[^;]*;/.test(value)) hits += 2;
    return Math.min(1, hits * 0.3);
  },
};

export default ansiFormat;
