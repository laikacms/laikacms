import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Slack Block Kit JSON <-> Portable Text.
 *
 * Slack messages can carry a structured `blocks` array (Block Kit), which is
 * distinct from the text-only `mrkdwn` format. Top-level block types we
 * model:
 *
 *   - `header { text: { text } }`            → block style `h1`
 *   - `section { text: { text } }`           → block style `normal` (text is
 *     plain text; the optional `mrkdwn` flavor is captured verbatim as a
 *     single span — we don't re-parse mrkdwn here)
 *   - `divider`                              → `hr` block
 *   - `image { image_url, alt_text }`        → `image` block
 *   - `rich_text { elements: [...] }`        → flattened into individual PT
 *     blocks per nested rich-text element (see below)
 *   - any other type                         → custom `slack-block:raw`
 *     block preserving the JSON for lossless round-trip
 *
 *   `rich_text.elements` may contain:
 *     - `rich_text_section { elements }`     → one `normal` PT block
 *     - `rich_text_list { style, elements }` → list blocks (bullet / number)
 *     - `rich_text_preformatted { elements }` → `code` block
 *     - `rich_text_quote { elements }`       → `blockquote` PT block
 *
 *   Inline `elements` inside a section / list-item:
 *     - `text { text, style: { bold, italic, strike, code } }` → span with
 *       the matching decorators
 *     - `link { url, text, style? }`         → span with markDef link
 *     - `emoji { name }`                     → text `:name:`
 *     - `user`, `usergroup`, `channel`       → text `<@U…>` / `<!subteam…>`
 *       / `<#C…>` (Slack's canonical render)
 *
 * Top-level wrapping shapes accepted on parse:
 *   - bare array `[block, …]`
 *   - `{ blocks: [...] }`              (Block Kit Builder export shape)
 *   - `{ attachments: [{ blocks }] }`  (legacy attachments wrapper)
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

// --- Type shapes ----------------------------------------------------------

interface SbBlock {
  type?: string;
  [extra: string]: unknown;
}
interface SbElement {
  type?: string;
  [extra: string]: unknown;
}
interface SbTextStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

// --- Slack -> PT ----------------------------------------------------------

function styleToMarks(style: SbTextStyle | undefined): string[] {
  if (!style) return [];
  const out: string[] = [];
  if (style.bold) out.push('strong');
  if (style.italic) out.push('em');
  if (style.strike) out.push('strike-through');
  if (style.code) out.push('code');
  return out;
}

function elementsToSpans(
  elements: SbElement[],
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  for (const el of elements) {
    const t = el.type;
    if (t === 'text') {
      const text = typeof el.text === 'string' ? el.text : '';
      if (text.length === 0) continue;
      out.push({
        _type: 'span',
        _key: keys.span(),
        text,
        marks: styleToMarks(el.style as SbTextStyle | undefined),
      });
      continue;
    }
    if (t === 'link') {
      const url = typeof el.url === 'string' ? el.url : '';
      const text = typeof el.text === 'string' ? el.text : url;
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: url });
      out.push({
        _type: 'span',
        _key: keys.span(),
        text,
        marks: [...styleToMarks(el.style as SbTextStyle | undefined), key],
      });
      continue;
    }
    if (t === 'emoji') {
      const name = typeof el.name === 'string' ? el.name : '';
      out.push({ _type: 'span', _key: keys.span(), text: `:${name}:`, marks: [] });
      continue;
    }
    if (t === 'user') {
      const id = typeof el.user_id === 'string' ? el.user_id : '';
      out.push({ _type: 'span', _key: keys.span(), text: `<@${id}>`, marks: [] });
      continue;
    }
    if (t === 'channel') {
      const id = typeof el.channel_id === 'string' ? el.channel_id : '';
      out.push({ _type: 'span', _key: keys.span(), text: `<#${id}>`, marks: [] });
      continue;
    }
    if (t === 'usergroup') {
      const id = typeof el.usergroup_id === 'string' ? el.usergroup_id : '';
      out.push({ _type: 'span', _key: keys.span(), text: `<!subteam^${id}>`, marks: [] });
      continue;
    }
    if (t === 'broadcast') {
      const range = typeof el.range === 'string' ? el.range : 'channel';
      out.push({ _type: 'span', _key: keys.span(), text: `<!${range}>`, marks: [] });
      continue;
    }
    // Unknown — drop silently.
  }
  return out;
}

function richTextElementsToBlocks(
  elements: SbElement[],
  out: PortableTextDocument,
  keys: Keys,
): void {
  for (const el of elements) {
    const t = el.type;
    if (t === 'rich_text_section') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = elementsToSpans((el.elements as SbElement[]) ?? [], markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children: children.length ? children : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
      } as PortableTextBlock);
      continue;
    }
    if (t === 'rich_text_list') {
      const style = (el.style as string | undefined) === 'ordered' ? 'number' : 'bullet';
      const indent = typeof el.indent === 'number' ? el.indent : 0;
      const items = (el.elements as SbElement[]) ?? [];
      for (const item of items) {
        if (item.type !== 'rich_text_section') continue;
        const markDefs: PortableTextMarkDefinition[] = [];
        const children = elementsToSpans((item.elements as SbElement[]) ?? [], markDefs, keys);
        const block: PortableTextBlock = {
          _type: 'block',
          _key: keys.block(),
          style: 'normal',
          markDefs,
          children: children.length ? children : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
        };
        (block as PortableTextBlock & { listItem: string, level: number }).listItem = style;
        (block as PortableTextBlock & { listItem: string, level: number }).level = indent + 1;
        out.push(block);
      }
      continue;
    }
    if (t === 'rich_text_preformatted') {
      // Body elements (usually a series of `text` runs) collapse to plain text.
      const items = (el.elements as SbElement[]) ?? [];
      const text = items
        .map(item => (item.type === 'text' && typeof item.text === 'string' ? item.text : ''))
        .join('');
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: text,
        language: null,
      } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'rich_text_quote') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = elementsToSpans((el.elements as SbElement[]) ?? [], markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'blockquote',
        markDefs,
        children,
      } as PortableTextBlock);
      continue;
    }
    // Unknown rich_text element — drop quietly (the wrapping rich_text block
    // is still preserved via this conversion).
  }
}

export function slackBlocksToPortableText(
  input: string | SbBlock[] | { blocks?: SbBlock[], attachments?: Array<{ blocks?: SbBlock[] }> },
): PortableTextDocument {
  const keys = newKeys();
  let blocks: SbBlock[];
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      blocks = extractBlocks(parsed);
    } catch {
      return [];
    }
  } else {
    blocks = extractBlocks(input);
  }
  const out: PortableTextDocument = [];
  for (const block of blocks) {
    const t = block.type;
    if (t === 'header') {
      const text = ((block.text as { text?: string } | undefined)?.text) ?? '';
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'h1',
        markDefs: [],
        children: [{ _type: 'span', _key: keys.span(), text, marks: [] }],
      } as PortableTextBlock);
      continue;
    }
    if (t === 'section') {
      const text = ((block.text as { text?: string } | undefined)?.text) ?? '';
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs: [],
        children: [{ _type: 'span', _key: keys.span(), text, marks: [] }],
      } as PortableTextBlock);
      continue;
    }
    if (t === 'divider') {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'image') {
      out.push({
        _type: 'image',
        _key: keys.block(),
        url: typeof block.image_url === 'string' ? block.image_url : '',
        alt: typeof block.alt_text === 'string' ? block.alt_text : '',
      } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'rich_text') {
      richTextElementsToBlocks((block.elements as SbElement[]) ?? [], out, keys);
      continue;
    }
    // Unknown — preserve.
    out.push({
      _type: 'slack-block:raw',
      _key: keys.block(),
      block,
    } as unknown as PortableTextBlock);
  }
  return out;
}

function extractBlocks(input: unknown): SbBlock[] {
  if (Array.isArray(input)) return input as SbBlock[];
  if (typeof input === 'object' && input !== null) {
    const obj = input as { blocks?: unknown, attachments?: unknown };
    if (Array.isArray(obj.blocks)) return obj.blocks as SbBlock[];
    if (Array.isArray(obj.attachments)) {
      const out: SbBlock[] = [];
      for (const att of obj.attachments) {
        if (att && typeof att === 'object' && Array.isArray((att as { blocks?: unknown }).blocks)) {
          out.push(...((att as { blocks: SbBlock[] }).blocks));
        }
      }
      return out;
    }
  }
  return [];
}

// --- PT -> Slack Block Kit ------------------------------------------------

function spanToRichTextElement(
  span: PortableTextSpan,
  markDefs: PortableTextMarkDefinition[],
): SbElement {
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  const style: SbTextStyle = {};
  if (marks.includes('strong')) style.bold = true;
  if (marks.includes('em')) style.italic = true;
  if (marks.includes('strike-through')) style.strike = true;
  if (marks.includes('code')) style.code = true;
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    const out: SbElement = { type: 'link', url: href, text: span.text };
    if (Object.keys(style).length) out.style = style;
    return out;
  }
  const out: SbElement = { type: 'text', text: span.text };
  if (Object.keys(style).length) out.style = style;
  return out;
}

function spansToElements(
  spans: PortableTextSpan[],
  markDefs: PortableTextMarkDefinition[],
): SbElement[] {
  return spans.map(s => spanToRichTextElement(s, markDefs));
}

export function portableTextToSlackBlocks(doc: PortableTextDocument): string {
  const blocks: SbBlock[] = [];
  // List grouping: consecutive bullet/number blocks collapse into one
  // rich_text_list element inside a single rich_text block. We use a
  // pending rich-text buffer so adjacent rich-text-style PT blocks share
  // a single rich_text wrapper too.
  let richTextBuffer: SbElement[] | null = null;
  let listKind: 'bullet' | 'number' | null = null;
  let listItems: SbElement[] = [];

  const flushList = (): void => {
    if (listKind === null) return;
    if (richTextBuffer === null) richTextBuffer = [];
    richTextBuffer.push({
      type: 'rich_text_list',
      style: listKind === 'number' ? 'ordered' : 'bullet',
      indent: 0,
      elements: listItems,
    });
    listKind = null;
    listItems = [];
  };
  const flushRichText = (): void => {
    flushList();
    if (richTextBuffer !== null && richTextBuffer.length > 0) {
      blocks.push({ type: 'rich_text', elements: richTextBuffer });
    }
    richTextBuffer = null;
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'slack-block:raw') {
      flushRichText();
      const raw = (block as { block?: unknown }).block;
      if (raw && typeof raw === 'object') blocks.push(raw as SbBlock);
      continue;
    }
    if (t === 'hr') {
      flushRichText();
      blocks.push({ type: 'divider' });
      continue;
    }
    if (t === 'image') {
      flushRichText();
      blocks.push({
        type: 'image',
        image_url: String((block as { url?: unknown }).url ?? ''),
        alt_text: String((block as { alt?: unknown }).alt ?? ''),
      });
      continue;
    }
    if (t === 'code') {
      flushList();
      const text = String((block as { code?: unknown }).code ?? '');
      if (richTextBuffer === null) richTextBuffer = [];
      richTextBuffer.push({
        type: 'rich_text_preformatted',
        elements: [{ type: 'text', text }],
      });
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const children = (b.children ?? []) as PortableTextSpan[];
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    // Headings go to top-level `header` blocks; everything else flows
    // through the rich_text wrapper to preserve inline formatting.
    if (headingMatch) {
      flushRichText();
      const text = children.map(s => s.text).join('');
      blocks.push({ type: 'header', text: { type: 'plain_text', text } });
      continue;
    }
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      // Flush an in-progress list whose kind doesn't match.
      const want: 'bullet' | 'number' = b.listItem === 'number' ? 'number' : 'bullet';
      if (listKind !== null && listKind !== want) flushList();
      listKind = want;
      listItems.push({
        type: 'rich_text_section',
        elements: spansToElements(children, markDefs),
      });
      continue;
    }
    flushList();
    if (richTextBuffer === null) richTextBuffer = [];
    if (style === 'blockquote') {
      richTextBuffer.push({
        type: 'rich_text_quote',
        elements: spansToElements(children, markDefs),
      });
    } else {
      richTextBuffer.push({
        type: 'rich_text_section',
        elements: spansToElements(children, markDefs),
      });
    }
  }
  flushRichText();
  return JSON.stringify({ blocks });
}

// --- Format ---------------------------------------------------------------

export const slackBlocksFormat: Format = {
  id: 'slack-blocks',
  label: 'Slack Block Kit',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return slackBlocksToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToSlackBlocks(doc);
  },

  detect(value: string): number {
    const s = value.trim();
    if (!s.startsWith('{') && !s.startsWith('[')) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return 0;
    }
    const blocks = extractBlocks(parsed);
    if (blocks.length === 0) return 0;
    let hits = 0;
    const known = new Set(['header', 'section', 'divider', 'image', 'rich_text', 'context', 'actions', 'input']);
    let typedCount = 0;
    let knownCount = 0;
    for (const b of blocks) {
      if (typeof b.type !== 'string') continue;
      typedCount += 1;
      if (known.has(b.type)) knownCount += 1;
    }
    if (typedCount === 0) return 0;
    hits += Math.min(3, knownCount);
    return Math.min(1, hits * 0.3);
  },
};

export default slackBlocksFormat;
