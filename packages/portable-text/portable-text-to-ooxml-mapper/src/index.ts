import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * OOXML WordprocessingML <-> Portable Text.
 *
 * A `.docx` file is a ZIP archive; the textual content lives in
 * `word/document.xml`. This format handles that XML payload — the kind of
 * blob you'd extract via `unzip` (or what you'd see in a clipboard "rich
 * text" paste from Word).
 *
 * Constructs we model:
 *
 *   Block (`<w:p>` paragraphs):
 *     - `<w:pPr><w:pStyle w:val="Heading1"/>` … `Heading6` → `h1`..`h6`
 *     - `<w:pPr><w:pStyle w:val="ListBullet"/>` → bullet list block
 *     - `<w:pPr><w:pStyle w:val="ListNumber"/>` → number list block
 *     - `<w:pPr><w:pStyle w:val="Quote"/>` / `IntenseQuote` → blockquote
 *     - any other paragraph → block style `normal`
 *
 *   Run-level (`<w:r>` inside a paragraph):
 *     - `<w:rPr><w:b/></w:rPr>` → `strong`
 *     - `<w:rPr><w:i/></w:rPr>` → `em`
 *     - `<w:rPr><w:u w:val="…"/></w:rPr>` → `underline`
 *       (any non-`none` value enables it)
 *     - `<w:rPr><w:strike/></w:rPr>` → `strike-through`
 *     - `<w:rPr><w:vertAlign w:val="superscript|subscript"/></w:rPr>` → sup/sub
 *
 *   Inline structure:
 *     - `<w:t>` text content (with `xml:space="preserve"` on serialize)
 *     - `<w:tab/>` → tab character
 *     - `<w:br/>` → newline
 *     - `<w:hyperlink r:id="…">` and `<w:hyperlink w:anchor="…">` → markDef link
 *
 * Tables, drawings, smart-art, the relationships layer (.rels), and the full
 * numbering / styles definitions are out of scope.
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

// --- XML tokeniser --------------------------------------------------------

type Token =
  | { kind: 'open', name: string, attrs: Record<string, string>, selfClosing: boolean }
  | { kind: 'close', name: string }
  | { kind: 'text', text: string };

function tokenise(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    if (src[i] === '<') {
      if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i + 2);
        i = end === -1 ? len : end + 2;
        continue;
      }
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (src[i + 1] === '/') {
        const end = src.indexOf('>', i + 2);
        if (end === -1) {
          i = len;
          continue;
        }
        out.push({ kind: 'close', name: src.slice(i + 2, end).trim() });
        i = end + 1;
        continue;
      }
      const end = src.indexOf('>', i + 1);
      if (end === -1) {
        i = len;
        continue;
      }
      const inside = src.slice(i + 1, end).trim();
      const selfClosing = inside.endsWith('/');
      const cleaned = selfClosing ? inside.slice(0, -1).trim() : inside;
      const spaceAt = cleaned.search(/\s/);
      const name = spaceAt === -1 ? cleaned : cleaned.slice(0, spaceAt);
      const attrs = spaceAt === -1 ? {} : parseAttrs(cleaned.slice(spaceAt + 1));
      out.push({ kind: 'open', name, attrs, selfClosing });
      i = end + 1;
      continue;
    }
    const next = src.indexOf('<', i);
    const piece = next === -1 ? src.slice(i) : src.slice(i, next);
    if (piece.length) out.push({ kind: 'text', text: decodeEntities(piece) });
    i = next === -1 ? len : next;
  }
  return out;
}

function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z][\w.:-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = m[1] ?? m[3] ?? '';
    out[key] = decodeEntities(m[2] ?? m[4] ?? '');
  }
  return out;
}
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- OOXML -> PT ----------------------------------------------------------

interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  vertAlign: 'super' | 'sub' | null;
}
function emptyRunStyle(): RunStyle {
  return { bold: false, italic: false, underline: false, strike: false, vertAlign: null };
}
function decoratorsForRun(s: RunStyle): string[] {
  const out: string[] = [];
  if (s.bold) out.push('strong');
  if (s.italic) out.push('em');
  if (s.underline) out.push('underline');
  if (s.strike) out.push('strike-through');
  if (s.vertAlign === 'super') out.push('sup');
  else if (s.vertAlign === 'sub') out.push('sub');
  return out;
}

const STYLE_TO_PT: Record<string, string> = {
  Heading1: 'h1',
  Heading2: 'h2',
  Heading3: 'h3',
  Heading4: 'h4',
  Heading5: 'h5',
  Heading6: 'h6',
  Title: 'h1',
  Subtitle: 'h2',
  Quote: 'blockquote',
  IntenseQuote: 'blockquote',
};
const PT_TO_STYLE: Record<string, string> = {
  h1: 'Heading1',
  h2: 'Heading2',
  h3: 'Heading3',
  h4: 'Heading4',
  h5: 'Heading5',
  h6: 'Heading6',
  blockquote: 'Quote',
};

function stripNs(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
}

function findMatching(s: ParserState, openName: string): number {
  let depth = 1;
  let i = s.pos;
  while (i < s.tokens.length && depth > 0) {
    const tok = s.tokens[i]!;
    if (tok.kind === 'open' && tok.name === openName && !tok.selfClosing) depth += 1;
    else if (tok.kind === 'close' && tok.name === openName) depth -= 1;
    i += 1;
  }
  return i;
}

function readParagraphProps(s: ParserState): { style: string, listItem: 'bullet' | 'number' | null } {
  // Caller positions us at the open of `<w:pPr>`. We consume until the
  // matching `</w:pPr>` and return the extracted style.
  let style = 'normal';
  let listItem: 'bullet' | 'number' | null = null;
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && stripNs(tok.name) === 'pPr') {
      s.pos += 1;
      return { style, listItem };
    }
    if (tok.kind === 'open' && stripNs(tok.name) === 'pStyle') {
      const val = tok.attrs['w:val'] ?? tok.attrs.val ?? '';
      if (val === 'ListBullet' || val === 'ListParagraph') listItem = 'bullet';
      else if (val === 'ListNumber') listItem = 'number';
      else if (STYLE_TO_PT[val]) style = STYLE_TO_PT[val]!;
      if (!tok.selfClosing) {
        // Consume body to the matching close.
        s.pos += 1;
        while (s.pos < s.tokens.length) {
          const inner = s.tokens[s.pos]!;
          s.pos += 1;
          if (inner.kind === 'close' && stripNs(inner.name) === 'pStyle') break;
        }
      } else {
        s.pos += 1;
      }
      continue;
    }
    s.pos += 1;
  }
  return { style, listItem };
}

function readRunProps(s: ParserState): RunStyle {
  const out = emptyRunStyle();
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && stripNs(tok.name) === 'rPr') {
      s.pos += 1;
      return out;
    }
    if (tok.kind === 'open') {
      const name = stripNs(tok.name);
      const val = tok.attrs['w:val'] ?? tok.attrs.val;
      if (name === 'b') out.bold = val !== '0' && val !== 'false';
      else if (name === 'i') out.italic = val !== '0' && val !== 'false';
      else if (name === 'u') out.underline = val !== 'none' && val !== undefined;
      else if (name === 'strike') out.strike = val !== '0' && val !== 'false';
      else if (name === 'vertAlign') {
        if (val === 'superscript') out.vertAlign = 'super';
        else if (val === 'subscript') out.vertAlign = 'sub';
      }
      // Skip body of non-self-closing rPr children.
      if (!tok.selfClosing) {
        s.pos += 1;
        let depth = 1;
        while (s.pos < s.tokens.length && depth > 0) {
          const inner = s.tokens[s.pos]!;
          s.pos += 1;
          if (inner.kind === 'open' && stripNs(inner.name) === name && !inner.selfClosing) depth += 1;
          else if (inner.kind === 'close' && stripNs(inner.name) === name) depth -= 1;
        }
        continue;
      }
    }
    s.pos += 1;
  }
  return out;
}

function readRun(
  s: ParserState,
  markDefs: PortableTextMarkDefinition[],
  inheritedMarks: string[],
): PortableTextSpan[] {
  let style = emptyRunStyle();
  let text = '';
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && stripNs(tok.name) === 'r') {
      s.pos += 1;
      break;
    }
    if (tok.kind === 'open') {
      const name = stripNs(tok.name);
      if (name === 'rPr') {
        s.pos += 1;
        style = readRunProps(s);
        continue;
      }
      if (name === 't') {
        s.pos += 1;
        // Collect text tokens up to </w:t>.
        while (s.pos < s.tokens.length) {
          const inner = s.tokens[s.pos]!;
          if (inner.kind === 'close' && stripNs(inner.name) === 't') {
            s.pos += 1;
            break;
          }
          if (inner.kind === 'text') text += inner.text;
          s.pos += 1;
        }
        continue;
      }
      if (name === 'tab') {
        text += '\t';
        if (!tok.selfClosing) {
          s.pos += 1;
          while (s.pos < s.tokens.length) {
            const inner = s.tokens[s.pos]!;
            s.pos += 1;
            if (inner.kind === 'close' && stripNs(inner.name) === 'tab') break;
          }
          continue;
        }
        s.pos += 1;
        continue;
      }
      if (name === 'br') {
        text += '\n';
        if (!tok.selfClosing) {
          s.pos += 1;
          while (s.pos < s.tokens.length) {
            const inner = s.tokens[s.pos]!;
            s.pos += 1;
            if (inner.kind === 'close' && stripNs(inner.name) === 'br') break;
          }
          continue;
        }
        s.pos += 1;
        continue;
      }
      // Unknown — skip subtree.
      if (!tok.selfClosing) {
        const closeAt = findMatching({ ...s, pos: s.pos + 1 } as ParserState, name);
        s.pos = closeAt;
        continue;
      }
      s.pos += 1;
      continue;
    }
    s.pos += 1;
  }
  if (text === '') return [];
  const marks = [...inheritedMarks, ...decoratorsForRun(style)];
  void markDefs;
  return [{ _type: 'span', _key: s.keys.span(), text, marks }];
}

function readParagraph(s: ParserState): void {
  let style = 'normal';
  let listItem: 'bullet' | 'number' | null = null;
  const markDefs: PortableTextMarkDefinition[] = [];
  const children: PortableTextSpan[] = [];
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && stripNs(tok.name) === 'p') {
      s.pos += 1;
      break;
    }
    if (tok.kind === 'open') {
      const name = stripNs(tok.name);
      if (name === 'pPr') {
        s.pos += 1;
        const pp = readParagraphProps(s);
        style = pp.style;
        listItem = pp.listItem;
        continue;
      }
      if (name === 'r') {
        s.pos += 1;
        children.push(...readRun(s, markDefs, []));
        continue;
      }
      if (name === 'hyperlink') {
        const targetId = tok.attrs['r:id'] ?? '';
        const anchor = tok.attrs['w:anchor'] ?? '';
        const href = targetId ? `ooxml://rel/${targetId}` : (anchor ? `#${anchor}` : '');
        const key = s.keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        s.pos += 1;
        // Collect inline runs inside the hyperlink with the link mark.
        while (s.pos < s.tokens.length) {
          const inner = s.tokens[s.pos]!;
          if (inner.kind === 'close' && stripNs(inner.name) === 'hyperlink') {
            s.pos += 1;
            break;
          }
          if (inner.kind === 'open' && stripNs(inner.name) === 'r') {
            s.pos += 1;
            children.push(...readRun(s, markDefs, [key]));
            continue;
          }
          s.pos += 1;
        }
        continue;
      }
      if (!tok.selfClosing) {
        const closeAt = findMatching({ ...s, pos: s.pos + 1 } as ParserState, name);
        s.pos = closeAt;
        continue;
      }
      s.pos += 1;
      continue;
    }
    s.pos += 1;
  }
  const block: PortableTextBlock = {
    _type: 'block',
    _key: s.keys.block(),
    style,
    markDefs,
    children: children.length ? children : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
  };
  if (listItem) {
    (block as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
    (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
  }
  s.out.push(block);
}

export function ooxmlToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const state: ParserState = { tokens: tokenise(input), pos: 0, keys, out: [] };
  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos]!;
    if (tok.kind === 'open' && stripNs(tok.name) === 'p') {
      state.pos += 1;
      readParagraph(state);
      continue;
    }
    state.pos += 1;
  }
  return state.out;
}

// --- PT -> OOXML ----------------------------------------------------------

function spanToOoxml(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  const props: string[] = [];
  if (marks.includes('strong')) props.push('<w:b/>');
  if (marks.includes('em')) props.push('<w:i/>');
  if (marks.includes('underline')) props.push('<w:u w:val="single"/>');
  if (marks.includes('strike-through')) props.push('<w:strike/>');
  if (marks.includes('sup')) props.push('<w:vertAlign w:val="superscript"/>');
  else if (marks.includes('sub')) props.push('<w:vertAlign w:val="subscript"/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(span.text)}</w:t></w:r>`;
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    if (href.startsWith('ooxml://rel/')) {
      const id = href.slice('ooxml://rel/'.length);
      return `<w:hyperlink r:id="${escapeXml(id)}">${run}</w:hyperlink>`;
    }
    if (href.startsWith('#')) {
      return `<w:hyperlink w:anchor="${escapeXml(href.slice(1))}">${run}</w:hyperlink>`;
    }
    return `<w:hyperlink r:id="${escapeXml(href)}">${run}</w:hyperlink>`;
  }
  return run;
}

export function portableTextToOoxml(doc: PortableTextDocument): string {
  const paragraphs: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const runs = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToOoxml(s, markDefs)).join('');
    let pStyle = '';
    if (b.listItem === 'bullet') pStyle = '<w:pStyle w:val="ListBullet"/>';
    else if (b.listItem === 'number') pStyle = '<w:pStyle w:val="ListNumber"/>';
    else if (b.style && PT_TO_STYLE[b.style]) pStyle = `<w:pStyle w:val="${PT_TO_STYLE[b.style]}"/>`;
    const pPr = pStyle ? `<w:pPr>${pStyle}</w:pPr>` : '';
    paragraphs.push(`<w:p>${pPr}${runs}</w:p>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n<w:body>\n${
    paragraphs.join('\n')
  }\n</w:body>\n</w:document>`;
}

// --- Format ---------------------------------------------------------------

export const ooxmlFormat: Format = {
  id: 'ooxml',
  label: 'OOXML WordprocessingML',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return ooxmlToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToOoxml(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<w:document\b/.test(value)) hits += 3;
    if (/wordprocessingml\/2006\/main/.test(value)) hits += 2;
    if (/<w:p\b/.test(value)) hits += 1;
    if (/<w:rPr>/.test(value)) hits += 1;
    if (/<w:pStyle\s+w:val=/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default ooxmlFormat;
