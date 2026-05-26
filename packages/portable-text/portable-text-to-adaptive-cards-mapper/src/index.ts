import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Microsoft Adaptive Cards JSON <-> Portable Text.
 *
 * Adaptive Cards (https://adaptivecards.io) is the JSON schema used by
 * Microsoft Teams, Outlook actionable messages, Webex, Cortana, etc. We map
 * the text-bearing block + run types onto Portable Text:
 *
 *   Blocks (entries in `body[]`):
 *     - `TextBlock` with `style: "heading"`   → block style `h{N}` where N
 *       is derived from `size` (ExtraLarge=h1, Large=h2, Medium=h3,
 *       Default=h4, Small=h5)
 *     - `TextBlock` otherwise                  → block style `normal`
 *     - `RichTextBlock { inlines: [...] }`     → block style `normal` whose
 *       children come from the inline `TextRun`s
 *     - `Image`                                → `image` block (url, altText)
 *     - `Container { items: [...] }`           → child items flattened in
 *       place (no semantic block in PT)
 *     - Unknown element types                  → custom `adaptive-card:raw`
 *       block carrying the element verbatim, so third-party schemas
 *       round-trip losslessly
 *
 *   `RichTextBlock` `TextRun` formatting:
 *     - `weight: "Bolder"`         → `strong`
 *     - `italic: true`             → `em`
 *     - `underline: true`          → `underline`
 *     - `strikethrough: true`      → `strike-through`
 *     - `fontType: "Monospace"`    → `code`
 *     - `selectAction.url`         → `markDefs[link]`
 *
 *   Card-level metadata (`$schema`, `version`, `type: "AdaptiveCard"`) is
 *   preserved on a single `adaptive-card:meta` block at the top of the
 *   document for stable round-trip.
 *
 * `ActionSet`, `ColumnSet`, `FactSet`, `Input.*`, and the broader Adaptive
 * Cards schema are intentionally out of scope.
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

// --- Type aliases for the Adaptive Cards subset --------------------------

interface AcCard {
  type?: string;
  $schema?: string;
  version?: string;
  body?: AcElement[];
  [extra: string]: unknown;
}
interface AcElement {
  type?: string;
  [extra: string]: unknown;
}
interface AcTextRun {
  type?: string;
  text?: string;
  weight?: string;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontType?: string;
  selectAction?: { type?: string, url?: string };
}

// Size → heading level mapping for `style: "heading"` TextBlocks.
const HEADING_SIZE_TO_LEVEL: Record<string, number> = {
  ExtraLarge: 1,
  Large: 2,
  Medium: 3,
  Default: 4,
  Small: 5,
};
const HEADING_LEVEL_TO_SIZE: Record<number, string> = {
  1: 'ExtraLarge',
  2: 'Large',
  3: 'Medium',
  4: 'Default',
  5: 'Small',
  6: 'Small',
};

// --- Adaptive Cards -> PT -------------------------------------------------

function textRunMarks(run: AcTextRun): string[] {
  const marks: string[] = [];
  if (run.weight === 'Bolder') marks.push('strong');
  if (run.italic === true) marks.push('em');
  if (run.underline === true) marks.push('underline');
  if (run.strikethrough === true) marks.push('strike-through');
  if (run.fontType === 'Monospace') marks.push('code');
  return marks;
}

function emitTextBlock(
  s: PortableTextDocument,
  el: AcElement,
  keys: Keys,
): void {
  const text = typeof el.text === 'string' ? el.text : '';
  const isHeading = el.style === 'heading';
  let style = 'normal';
  if (isHeading) {
    const level = HEADING_SIZE_TO_LEVEL[typeof el.size === 'string' ? el.size : 'Default'] ?? 2;
    style = `h${level}`;
  }
  // TextBlock has no inline runs, but its `weight`/`isSubtle` may still hint
  // at bold/italic on the whole block. We respect `weight: "Bolder"`.
  const wholeBlockMarks: string[] = [];
  if (el.weight === 'Bolder' && !isHeading) wholeBlockMarks.push('strong');
  s.push({
    _type: 'block',
    _key: keys.block(),
    style,
    markDefs: [],
    children: [{ _type: 'span', _key: keys.span(), text, marks: wholeBlockMarks }],
  } as PortableTextBlock);
}

function emitRichTextBlock(
  s: PortableTextDocument,
  el: AcElement,
  keys: Keys,
): void {
  const inlines = Array.isArray(el.inlines) ? (el.inlines as AcTextRun[]) : [];
  const markDefs: PortableTextMarkDefinition[] = [];
  const children: PortableTextSpan[] = [];
  for (const run of inlines) {
    const text = typeof run.text === 'string' ? run.text : '';
    if (text.length === 0) continue;
    const marks = textRunMarks(run);
    const url = run.selectAction?.url;
    if (typeof url === 'string' && url) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: url });
      marks.push(key);
    }
    children.push({ _type: 'span', _key: keys.span(), text, marks });
  }
  s.push({
    _type: 'block',
    _key: keys.block(),
    style: 'normal',
    markDefs,
    children: children.length ? children : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
  } as PortableTextBlock);
}

function emitImage(s: PortableTextDocument, el: AcElement, keys: Keys): void {
  s.push(
    {
      _type: 'image',
      _key: keys.block(),
      url: typeof el.url === 'string' ? el.url : '',
      alt: typeof el.altText === 'string' ? el.altText : '',
    } as unknown as PortableTextDocument[number],
  );
}

function emitContainer(s: PortableTextDocument, el: AcElement, keys: Keys): void {
  const items = Array.isArray(el.items) ? (el.items as AcElement[]) : [];
  for (const child of items) emitElement(s, child, keys);
}

function emitElement(s: PortableTextDocument, el: AcElement, keys: Keys): void {
  switch (el.type) {
    case 'TextBlock':
      emitTextBlock(s, el, keys);
      return;
    case 'RichTextBlock':
      emitRichTextBlock(s, el, keys);
      return;
    case 'Image':
      emitImage(s, el, keys);
      return;
    case 'Container':
      emitContainer(s, el, keys);
      return;
    default:
      s.push(
        {
          _type: 'adaptive-card:raw',
          _key: keys.block(),
          element: el,
        } as unknown as PortableTextDocument[number],
      );
  }
}

export function adaptiveCardToPortableText(input: string | AcCard): PortableTextDocument {
  const keys = newKeys();
  let card: AcCard;
  if (typeof input === 'string') {
    try {
      card = JSON.parse(input) as AcCard;
    } catch {
      return [];
    }
  } else {
    card = input;
  }
  const out: PortableTextDocument = [];
  // Card-level metadata header for stable round-trip.
  const meta: Record<string, unknown> = {};
  if (typeof card.type === 'string') meta.type = card.type;
  if (typeof card.$schema === 'string') meta.$schema = card.$schema;
  if (typeof card.version === 'string') meta.version = card.version;
  if (Object.keys(meta).length) {
    out.push(
      {
        _type: 'adaptive-card:meta',
        _key: keys.block(),
        ...meta,
      } as unknown as PortableTextDocument[number],
    );
  }
  for (const el of card.body ?? []) emitElement(out, el, keys);
  return out;
}

// --- PT -> Adaptive Cards -------------------------------------------------

function spanToTextRun(
  span: PortableTextSpan,
  markDefs: PortableTextMarkDefinition[],
): AcTextRun {
  const run: AcTextRun = { type: 'TextRun', text: span.text };
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  if (marks.includes('strong')) run.weight = 'Bolder';
  if (marks.includes('em')) run.italic = true;
  if (marks.includes('underline')) run.underline = true;
  if (marks.includes('strike-through')) run.strikethrough = true;
  if (marks.includes('code')) run.fontType = 'Monospace';
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    run.selectAction = { type: 'Action.OpenUrl', url: href };
  }
  return run;
}

export function portableTextToAdaptiveCard(doc: PortableTextDocument): string {
  let type = 'AdaptiveCard';
  let schemaUrl = 'http://adaptivecards.io/schemas/adaptive-card.json';
  let version = '1.5';
  const body: AcElement[] = [];

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'adaptive-card:meta') {
      const blockMeta = block as Record<string, unknown>;
      if (typeof blockMeta.type === 'string') type = blockMeta.type;
      if (typeof blockMeta.$schema === 'string') schemaUrl = blockMeta.$schema;
      if (typeof blockMeta.version === 'string') version = blockMeta.version;
      continue;
    }
    if (t === 'adaptive-card:raw') {
      const el = (block as { element?: unknown }).element;
      if (el && typeof el === 'object') body.push(el as AcElement);
      continue;
    }
    if (t === 'image') {
      body.push({
        type: 'Image',
        url: String((block as { url?: unknown }).url ?? ''),
        altText: String((block as { alt?: unknown }).alt ?? ''),
      });
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const children = (b.children ?? []) as PortableTextSpan[];
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    // Simple heading or unstyled span → TextBlock; anything with multiple
    // styled spans or links → RichTextBlock.
    const onlyOneUnmarkedSpan = children.length === 1 && (children[0]?.marks ?? []).length === 0;
    if (headingMatch && onlyOneUnmarkedSpan) {
      const level = Math.max(1, Math.min(6, Number(headingMatch[1])));
      body.push({
        type: 'TextBlock',
        text: children[0]?.text ?? '',
        style: 'heading',
        size: HEADING_LEVEL_TO_SIZE[level] ?? 'Default',
        weight: 'Bolder',
        wrap: true,
      });
      continue;
    }
    if (onlyOneUnmarkedSpan) {
      body.push({
        type: 'TextBlock',
        text: children[0]?.text ?? '',
        wrap: true,
      });
      continue;
    }
    body.push({
      type: 'RichTextBlock',
      inlines: children.map(s => spanToTextRun(s, markDefs)),
    });
  }
  const card: AcCard = {
    type,
    $schema: schemaUrl,
    version,
    body,
  };
  return JSON.stringify(card);
}

// --- Format ---------------------------------------------------------------

export const adaptiveCardsFormat: Format = {
  id: 'adaptive-cards',
  label: 'Microsoft Adaptive Cards',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return adaptiveCardToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToAdaptiveCard(doc);
  },

  detect(value: string): number {
    const s = value.trim();
    if (!s.startsWith('{')) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return 0;
    }
    if (typeof parsed !== 'object' || parsed === null) return 0;
    const obj = parsed as Record<string, unknown>;
    let hits = 0;
    if (obj.type === 'AdaptiveCard') hits += 3;
    if (typeof obj.$schema === 'string' && obj.$schema.includes('adaptivecards')) hits += 2;
    if (Array.isArray(obj.body)) {
      hits += 1;
      const firstType = (obj.body[0] as Record<string, unknown> | undefined)?.type;
      if (firstType === 'TextBlock' || firstType === 'RichTextBlock' || firstType === 'Container') hits += 2;
    }
    return Math.min(1, hits * 0.18);
  },
};

export default adaptiveCardsFormat;
