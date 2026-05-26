import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Notion blocks JSON <-> Portable Text.
 *
 * Models a subset of the Notion API block schema:
 *
 *   block.type    →  PT
 *   ───────────────────────────────────────────────────────────────────
 *   paragraph              →  block style 'normal'
 *   heading_1/2/3          →  block style 'h1'/'h2'/'h3'
 *   bulleted_list_item     →  block style 'normal', listItem 'bullet'
 *   numbered_list_item     →  block style 'normal', listItem 'number'
 *   to_do                  →  block style 'normal' + custom `checked` flag
 *   quote                  →  block style 'blockquote'
 *   callout                →  block style 'blockquote' (icon dropped)
 *   code                   →  `code` block with `language`
 *   divider                →  `hr` block
 *   image                  →  `image` block (external.url or file.url)
 *
 * Inline `rich_text` items use Notion annotations
 * (bold/italic/strikethrough/underline/code) and `text.link.url`. We accept
 * either an array of blocks or the API's `{ results: [...] }` envelope.
 */

interface NotionAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}
interface NotionTextItem {
  type?: 'text' | 'mention' | 'equation';
  text?: { content?: string, link?: { url?: string } | null };
  plain_text?: string;
  annotations?: NotionAnnotations;
}
interface NotionBlock {
  object?: string;
  type?: string;
  paragraph?: { rich_text?: NotionTextItem[] };
  heading_1?: { rich_text?: NotionTextItem[] };
  heading_2?: { rich_text?: NotionTextItem[] };
  heading_3?: { rich_text?: NotionTextItem[] };
  bulleted_list_item?: { rich_text?: NotionTextItem[] };
  numbered_list_item?: { rich_text?: NotionTextItem[] };
  to_do?: { rich_text?: NotionTextItem[], checked?: boolean };
  quote?: { rich_text?: NotionTextItem[] };
  callout?: { rich_text?: NotionTextItem[] };
  code?: { rich_text?: NotionTextItem[], language?: string };
  image?: {
    type?: 'external' | 'file',
    external?: { url?: string },
    file?: { url?: string },
    caption?: NotionTextItem[],
  };
}

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

const ANNOTATION_TO_DECORATOR: Array<[keyof NotionAnnotations, string]> = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['strikethrough', 'strike-through'],
  ['underline', 'underline'],
  ['code', 'code'],
];
const DECORATOR_TO_ANNOTATION: Record<string, keyof NotionAnnotations> = Object.fromEntries(
  ANNOTATION_TO_DECORATOR.map(([k, v]) => [v, k]),
);

// --- Notion -> PT ---------------------------------------------------------

function richTextToSpans(
  rich: NotionTextItem[] | undefined,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  for (const item of rich ?? []) {
    const text = item.text?.content ?? item.plain_text ?? '';
    if (!text) continue;
    const marks: string[] = [];
    for (const [k, decorator] of ANNOTATION_TO_DECORATOR) {
      if (item.annotations?.[k]) marks.push(decorator);
    }
    const linkUrl = item.text?.link?.url;
    if (typeof linkUrl === 'string' && linkUrl) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: linkUrl });
      marks.push(key);
    }
    out.push({ _type: 'span', _key: keys.span(), text, marks });
  }
  return out;
}

export function notionToPortableText(
  input: string | NotionBlock[] | { results?: NotionBlock[] },
): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  let blocks: NotionBlock[];
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      if (Array.isArray(parsed)) blocks = parsed as NotionBlock[];
      else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)) {
        blocks = (parsed as { results: NotionBlock[] }).results;
      } else blocks = [];
    } catch {
      return [];
    }
  } else if (Array.isArray(input)) {
    blocks = input;
  } else {
    blocks = input.results ?? [];
  }

  for (const b of blocks) {
    const t = b.type;
    if (!t) continue;
    if (t === 'divider') {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'image') {
      const url = b.image?.external?.url ?? b.image?.file?.url ?? '';
      const captionMarkDefs: PortableTextMarkDefinition[] = [];
      const caption = richTextToSpans(b.image?.caption, captionMarkDefs, keys)
        .map(s => s.text)
        .join('');
      out.push({
        _type: 'image',
        _key: keys.block(),
        url,
        alt: caption,
      } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'code') {
      const text = (b.code?.rich_text ?? []).map(r => r.text?.content ?? r.plain_text ?? '').join('');
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: text,
        language: typeof b.code?.language === 'string' ? b.code.language : null,
      } as unknown as PortableTextBlock);
      continue;
    }
    // Block types whose payload key matches the type.
    const payloadKey = t as keyof NotionBlock;
    const payload = b[payloadKey] as { rich_text?: NotionTextItem[], checked?: boolean } | undefined;
    if (!payload) continue;
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = richTextToSpans(payload.rich_text, markDefs, keys);
    let style = 'normal';
    let listItem: 'bullet' | 'number' | undefined;
    if (t === 'heading_1') style = 'h1';
    else if (t === 'heading_2') style = 'h2';
    else if (t === 'heading_3') style = 'h3';
    else if (t === 'quote' || t === 'callout') style = 'blockquote';
    else if (t === 'bulleted_list_item') listItem = 'bullet';
    else if (t === 'numbered_list_item') listItem = 'number';

    const block: PortableTextBlock = {
      _type: 'block',
      _key: keys.block(),
      style,
      markDefs,
      children,
    };
    if (listItem) {
      (block as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
      (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
    }
    if (t === 'to_do') {
      (block as PortableTextBlock & { checked: boolean }).checked = payload.checked === true;
    }
    out.push(block);
  }

  return out;
}

// --- PT -> Notion ---------------------------------------------------------

function spansToRichText(
  spans: PortableTextSpan[],
  markDefs: PortableTextMarkDefinition[],
): NotionTextItem[] {
  return spans.map(s => {
    const annotations: NotionAnnotations = {};
    let linkUrl: string | undefined;
    for (const mark of s.marks ?? []) {
      const annot = DECORATOR_TO_ANNOTATION[mark];
      if (annot) {
        // `color` is a string field; the five booleans share a true value.
        (annotations as Record<string, boolean | string>)[annot] = true;
        continue;
      }
      const md = markDefs.find(d => d._key === mark);
      if (md && md._type === 'link') {
        linkUrl = (md as { href?: string }).href;
      }
    }
    return {
      type: 'text',
      text: { content: s.text, link: linkUrl ? { url: linkUrl } : null },
      annotations,
      plain_text: s.text,
    };
  });
}

export function portableTextToNotion(doc: PortableTextDocument): NotionBlock[] {
  const out: NotionBlock[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      out.push({ object: 'block', type: 'divider' });
      continue;
    }
    if (t === 'image') {
      const url = String((block as { url?: unknown }).url ?? '');
      const alt = String((block as { alt?: unknown }).alt ?? '');
      out.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url },
          caption: alt
            ? [{ type: 'text', text: { content: alt, link: null }, annotations: {}, plain_text: alt }]
            : [],
        },
      });
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      out.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: code, link: null }, annotations: {}, plain_text: code }],
          language: typeof language === 'string' && language ? language : 'plain text',
        },
      });
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const rich = spansToRichText((b.children ?? []) as PortableTextSpan[], markDefs);
    if (b.listItem === 'bullet') {
      out.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich } });
      continue;
    }
    if (b.listItem === 'number') {
      out.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rich } });
      continue;
    }
    if ('checked' in b) {
      out.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: rich, checked: (b as { checked?: boolean }).checked === true },
      });
      continue;
    }
    switch (b.style) {
      case 'h1':
        out.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rich } });
        break;
      case 'h2':
        out.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich } });
        break;
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        // Notion only has h1-h3; collapse h4-h6 onto h3.
        out.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich } });
        break;
      case 'blockquote':
        out.push({ object: 'block', type: 'quote', quote: { rich_text: rich } });
        break;
      default:
        out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } });
        break;
    }
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const notionFormat: Format = {
  id: 'notion',
  label: 'Notion blocks JSON',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return notionToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(portableTextToNotion(doc));
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
    let blocks: unknown[];
    if (Array.isArray(parsed)) blocks = parsed;
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)) {
      blocks = (parsed as { results: unknown[] }).results;
    } else return 0;
    if (blocks.length === 0) return 0;
    let hits = 0;
    let total = 0;
    for (const b of blocks) {
      if (typeof b !== 'object' || b === null) continue;
      total += 1;
      const rec = b as Record<string, unknown>;
      if (rec.object === 'block' && typeof rec.type === 'string') hits += 1;
    }
    if (total === 0) return 0;
    return Math.min(1, hits / total);
  },
};

export default notionFormat;
