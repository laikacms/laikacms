import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * ICML (Adobe InCopy/InDesign Markup) <-> Portable Text.
 *
 * ICML stores story content as nested `<ParagraphStyleRange>` (PSR) and
 * `<CharacterStyleRange>` (CSR) elements, each pointing at a named style by
 * convention `ParagraphStyle/<Name>` and `CharacterStyle/<Name>`. The
 * leaf-level text lives in `<Content>` elements; `<Br/>` ends a paragraph.
 *
 *   Paragraph styles we model (names matched case-insensitively, after
 *   stripping the leading `ParagraphStyle/` and `$ID/` namespace):
 *     - `Heading 1` … `Heading 6`     → block style `h1`..`h6`
 *     - `BulletList` / `List Bullet`  → bullet list block
 *     - `NumberedList` / `List Number` → number list block
 *     - `Quote` / `Blockquote`         → block style `blockquote`
 *     - everything else (incl. `NormalParagraphStyle`) → `normal`
 *
 *   Character styles → PT decorators:
 *     - `Bold`, `Strong`                → `strong`
 *     - `Italic`, `Emphasis`            → `em`
 *     - `Underline`                     → `underline`
 *     - `Strike`, `Strikethrough`       → `strike-through`
 *     - `Code`, `Monospace`             → `code`
 *     - `Superscript`, `Subscript`      → `sup` / `sub`
 *     - `Bold Italic`                   → `strong` + `em`
 *
 *   Hyperlinks (`<HyperlinkTextSource>` wrapping CSRs) → `markDefs[link]`.
 *
 * On serialize we emit the InDesign processing-instruction header
 * (`<?aid style="50" type="snippet" ?>`) so the output is recognisable as an
 * ICML snippet.
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
      if (src.startsWith('<!', i)) {
        const end = src.indexOf('>', i + 2);
        i = end === -1 ? len : end + 1;
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

// --- Style-name normalisation --------------------------------------------

function styleNameOf(reference: string): string {
  // Reference looks like `ParagraphStyle/$ID/Heading 1` or
  // `CharacterStyle/Bold` or just `Bold`. Strip the kind prefix and `$ID/`.
  let out = reference;
  const slash = out.indexOf('/');
  if (slash !== -1) out = out.slice(slash + 1);
  if (out.startsWith('$ID/')) out = out.slice(4);
  return out.trim();
}
function normaliseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADING_PATTERN = /^heading(\d)$/;
function mapParagraphStyle(name: string): { style: string, listItem: 'bullet' | 'number' | null } {
  const key = normaliseKey(name);
  if (key === 'bulletlist' || key === 'listbullet') return { style: 'normal', listItem: 'bullet' };
  if (key === 'numberedlist' || key === 'listnumber') return { style: 'normal', listItem: 'number' };
  if (key === 'quote' || key === 'blockquote') return { style: 'blockquote', listItem: null };
  const m = HEADING_PATTERN.exec(key);
  if (m) return { style: `h${m[1]}`, listItem: null };
  return { style: 'normal', listItem: null };
}

const CHARACTER_STYLE_MARKS: Record<string, string[]> = {
  bold: ['strong'],
  strong: ['strong'],
  italic: ['em'],
  emphasis: ['em'],
  bolditalic: ['strong', 'em'],
  underline: ['underline'],
  strike: ['strike-through'],
  strikethrough: ['strike-through'],
  code: ['code'],
  monospace: ['code'],
  superscript: ['sup'],
  subscript: ['sub'],
};
function mapCharacterStyle(name: string): string[] {
  return CHARACTER_STYLE_MARKS[normaliseKey(name)] ?? [];
}
function unmapMarks(marks: string[]): string | null {
  const lookup: Record<string, string> = {
    strong: 'Bold',
    em: 'Italic',
    underline: 'Underline',
    'strike-through': 'Strikethrough',
    code: 'Code',
    sup: 'Superscript',
    sub: 'Subscript',
  };
  const hasStrong = marks.includes('strong');
  const hasEm = marks.includes('em');
  if (hasStrong && hasEm) return 'Bold Italic';
  for (const m of marks) if (lookup[m]) return lookup[m]!;
  return null;
}

// --- ICML -> PT -----------------------------------------------------------

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
  paragraphStyle: { style: string, listItem: 'bullet' | 'number' | null };
  paragraphMarkDefs: PortableTextMarkDefinition[];
  paragraphSpans: PortableTextSpan[];
  characterMarks: string[];
  linkMarks: string[];
}

function flushParagraph(s: ParserState): void {
  if (s.paragraphSpans.length === 0 && s.paragraphStyle.style === 'normal' && s.paragraphStyle.listItem === null) {
    // Drop fully-empty paragraphs.
    return;
  }
  const block: PortableTextBlock = {
    _type: 'block',
    _key: s.keys.block(),
    style: s.paragraphStyle.style,
    markDefs: s.paragraphMarkDefs,
    children: s.paragraphSpans.length
      ? s.paragraphSpans
      : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
  };
  if (s.paragraphStyle.listItem) {
    (block as PortableTextBlock & { listItem: string, level: number }).listItem = s.paragraphStyle.listItem;
    (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
  }
  s.out.push(block);
  s.paragraphStyle = { style: 'normal', listItem: null };
  s.paragraphMarkDefs = [];
  s.paragraphSpans = [];
}

function pushText(s: ParserState, text: string): void {
  if (text.length === 0) return;
  const marks = [...s.characterMarks, ...s.linkMarks];
  const last = s.paragraphSpans[s.paragraphSpans.length - 1];
  if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) {
    last.text += text;
    return;
  }
  s.paragraphSpans.push({ _type: 'span', _key: s.keys.span(), text, marks });
}

export function icmlToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const state: ParserState = {
    tokens: tokenise(input),
    pos: 0,
    keys,
    out: [],
    paragraphStyle: { style: 'normal', listItem: null },
    paragraphMarkDefs: [],
    paragraphSpans: [],
    characterMarks: [],
    linkMarks: [],
  };
  // Stack of `previousCharacterMarks` so nested CSR scopes can pop cleanly.
  const csrStack: string[][] = [];
  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos]!;
    if (tok.kind === 'open') {
      state.pos += 1;
      if (tok.name === 'ParagraphStyleRange') {
        state.paragraphStyle = mapParagraphStyle(styleNameOf(tok.attrs.AppliedParagraphStyle ?? ''));
        continue;
      }
      if (tok.name === 'CharacterStyleRange') {
        csrStack.push([...state.characterMarks]);
        state.characterMarks = mapCharacterStyle(styleNameOf(tok.attrs.AppliedCharacterStyle ?? ''));
        continue;
      }
      if (tok.name === 'HyperlinkTextSource') {
        const href = tok.attrs.AppliedHyperlink ?? tok.attrs.URL ?? tok.attrs.DestinationUniqueKey ?? '';
        const key = state.keys.mark();
        state.paragraphMarkDefs.push({ _type: 'link', _key: key, href });
        state.linkMarks = [key];
        continue;
      }
      if (tok.name === 'Content') {
        // Collect text children until </Content>.
        let buf = '';
        while (state.pos < state.tokens.length) {
          const inner = state.tokens[state.pos]!;
          if (inner.kind === 'close' && inner.name === 'Content') {
            state.pos += 1;
            break;
          }
          if (inner.kind === 'text') buf += inner.text;
          state.pos += 1;
        }
        pushText(state, buf);
        continue;
      }
      if (tok.name === 'Br') {
        // Paragraph break inside a PSR: flush, then reopen with same style.
        const carryStyle = state.paragraphStyle;
        flushParagraph(state);
        state.paragraphStyle = carryStyle;
        if (!tok.selfClosing) {
          // Skip the body.
          while (state.pos < state.tokens.length) {
            const inner = state.tokens[state.pos]!;
            state.pos += 1;
            if (inner.kind === 'close' && inner.name === 'Br') break;
          }
        }
        continue;
      }
      // Unknown — descend into it transparently so its content is preserved.
      continue;
    }
    if (tok.kind === 'close') {
      state.pos += 1;
      if (tok.name === 'ParagraphStyleRange') {
        flushParagraph(state);
        continue;
      }
      if (tok.name === 'CharacterStyleRange') {
        state.characterMarks = csrStack.pop() ?? [];
        continue;
      }
      if (tok.name === 'HyperlinkTextSource') {
        state.linkMarks = [];
        continue;
      }
      continue;
    }
    state.pos += 1;
  }
  flushParagraph(state);
  return state.out;
}

// --- PT -> ICML -----------------------------------------------------------

function paragraphStyleReference(style: string, listItem: 'bullet' | 'number' | null | undefined): string {
  if (listItem === 'bullet') return 'ParagraphStyle/BulletList';
  if (listItem === 'number') return 'ParagraphStyle/NumberedList';
  if (style === 'blockquote') return 'ParagraphStyle/Quote';
  const m = /^h([1-6])$/.exec(style);
  if (m) return `ParagraphStyle/Heading ${m[1]}`;
  return 'ParagraphStyle/$ID/NormalParagraphStyle';
}

function characterStyleReference(marks: string[]): string {
  const named = unmapMarks(marks);
  return named ? `CharacterStyle/${named}` : 'CharacterStyle/$ID/[No character style]';
}

function spanToCsr(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  const decoratorMarks = marks.filter(m => m !== linkKey);
  const csr = `<CharacterStyleRange AppliedCharacterStyle="${
    escapeXml(characterStyleReference(decoratorMarks))
  }"><Content>${escapeXml(span.text)}</Content></CharacterStyleRange>`;
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    return `<HyperlinkTextSource AppliedHyperlink="${escapeXml(href)}">${csr}</HyperlinkTextSource>`;
  }
  return csr;
}

export function portableTextToIcml(doc: PortableTextDocument): string {
  const parts: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const csrs = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToCsr(s, markDefs)).join('');
    const psr = paragraphStyleReference(b.style ?? 'normal', b.listItem as 'bullet' | 'number' | null | undefined);
    parts.push(`<ParagraphStyleRange AppliedParagraphStyle="${escapeXml(psr)}">${csrs}</ParagraphStyleRange>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?aid style="50" type="snippet" ?>\n<Document>\n${
    parts.join('\n')
  }\n</Document>`;
}

// --- Format ---------------------------------------------------------------

export const icmlFormat: Format = {
  id: 'icml',
  label: 'ICML (InDesign/InCopy)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return icmlToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToIcml(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<ParagraphStyleRange\b/.test(value)) hits += 2;
    if (/<CharacterStyleRange\b/.test(value)) hits += 2;
    if (/<\?aid\b/.test(value)) hits += 2;
    if (/AppliedParagraphStyle=/.test(value)) hits += 1;
    if (/<Content>/.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default icmlFormat;
