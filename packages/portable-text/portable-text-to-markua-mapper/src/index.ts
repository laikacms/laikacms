import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * Markua (Leanpub) <-> Portable Text.
 *
 * Markua is a Markdown dialect used by Leanpub for book authoring. We lean on
 * `@portabletext/markdown` for the shared subset and layer the Markua-specific
 * constructs on top:
 *
 *   - Asides (`A> …`, `T> …`, `W> …`, `I> …`, `E> …`, `D> …`, `X> …`, `Q> …`,
 *     `B> …`) → custom block `markua:aside` with a `kind` discriminator
 *   - Part-matter markers (`{frontmatter}`, `{mainmatter}`, `{backmatter}`) →
 *     custom `markua:matter` blocks
 *   - `# Title {-}` (unnumbered heading) → heading block plus `unnumbered`
 *     flag preserved on the PT block
 *
 * Image attribute braces (`![alt](url){width=50%}`), footnotes, and arbitrary
 * Leanpub directives pass through as plain Markdown.
 */

const ASIDE_PREFIXES: Record<string, string> = {
  A: 'general',
  T: 'tip',
  W: 'warning',
  I: 'information',
  E: 'error',
  D: 'discussion',
  X: 'exercise',
  Q: 'question',
  B: 'blurb',
};
const ASIDE_PREFIX_FOR_KIND: Record<string, string> = Object.fromEntries(
  Object.entries(ASIDE_PREFIXES).map(([k, v]) => [v, k]),
);

const MATTER_NAMES = new Set(['frontmatter', 'mainmatter', 'backmatter']);

// --- Markua -> PT ---------------------------------------------------------

interface AsidesExtraction {
  cleaned: string;
  asides: Array<{ kind: string, text: string, placeholder: string }>;
  matter: Array<{ kind: string, placeholder: string }>;
}

let placeholderCounter = 0;

function extractMarkua(input: string): AsidesExtraction {
  const out: AsidesExtraction = { cleaned: input, asides: [], matter: [] };
  // Pull out contiguous `X> …` lines as asides.
  const asidePattern = /(?:^|\n)([ATWIEDXQB])>[ \t]+([^\n]*(?:\n[ATWIEDXQB]>[ \t]+[^\n]*)*)/g;
  out.cleaned = out.cleaned.replace(asidePattern, (match: string, kindChar: string, body: string) => {
    const kind = ASIDE_PREFIXES[kindChar] ?? 'general';
    // Strip the leading prefix from continuation lines.
    const text = body.replace(/(^|\n)[ATWIEDXQB]>[ \t]+/g, (_m: string, nl: string) => nl);
    const placeholder = `«markua-aside-${placeholderCounter++}»`;
    out.asides.push({ kind, text, placeholder });
    return `${match.startsWith('\n') ? '\n' : ''}${placeholder}`;
  });

  // Matter markers on their own line: `{frontmatter}`, `{mainmatter}`, `{backmatter}`.
  out.cleaned = out.cleaned.replace(/^\{(frontmatter|mainmatter|backmatter)\}\s*$/gm, (_m: string, kind: string) => {
    if (!MATTER_NAMES.has(kind)) return _m;
    const placeholder = `«markua-matter-${placeholderCounter++}»`;
    out.matter.push({ kind, placeholder });
    return placeholder;
  });

  return out;
}

function restoreMarkuaBlocks(
  doc: PortableTextDocument,
  extraction: AsidesExtraction,
  mkKey: () => string,
): PortableTextDocument {
  const out: PortableTextDocument = [];
  const asideByPlaceholder = new Map(extraction.asides.map(a => [a.placeholder, a]));
  const matterByPlaceholder = new Map(extraction.matter.map(m => [m.placeholder, m]));

  for (const block of doc) {
    const b = block as { _type?: string, children?: Array<{ text?: string }> };
    if (b._type === 'block' && b.children && b.children.length === 1) {
      const onlyText = (b.children[0]?.text ?? '').trim();
      const aside = asideByPlaceholder.get(onlyText);
      if (aside) {
        out.push(
          {
            _type: 'markua:aside',
            _key: mkKey(),
            kind: aside.kind,
            text: aside.text,
          } as unknown as PortableTextDocument[number],
        );
        continue;
      }
      const matter = matterByPlaceholder.get(onlyText);
      if (matter) {
        out.push(
          {
            _type: 'markua:matter',
            _key: mkKey(),
            kind: matter.kind,
          } as unknown as PortableTextDocument[number],
        );
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

export function markuaToPortableText(input: string): PortableTextDocument {
  const blockKeys = createKeyGenerator('b');
  const extraction = extractMarkua(input);
  const md = markdownToPortableText(extraction.cleaned, { keyGenerator: createKeyGenerator('k') });
  return restoreMarkuaBlocks(md as unknown as PortableTextDocument, extraction, blockKeys);
}

// --- PT -> Markua ---------------------------------------------------------

export function portableTextToMarkua(doc: PortableTextDocument): string {
  const passthrough: PortableTextDocument = [];
  const asidePlaceholders: Array<{ placeholder: string, rendered: string }> = [];
  const matterPlaceholders: Array<{ placeholder: string, rendered: string }> = [];

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'markua:aside') {
      const kind = String((block as { kind?: unknown }).kind ?? 'general');
      const text = String((block as { text?: unknown }).text ?? '');
      const prefix = ASIDE_PREFIX_FOR_KIND[kind] ?? 'A';
      const rendered = text
        .split('\n')
        .map(line => `${prefix}> ${line}`)
        .join('\n');
      const placeholder = `«markua-aside-${placeholderCounter++}»`;
      asidePlaceholders.push({ placeholder, rendered });
      passthrough.push(
        {
          _type: 'block',
          _key: (block as { _key?: string })._key ?? '',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', _key: '', text: placeholder, marks: [] }],
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    if (t === 'markua:matter') {
      const kind = String((block as { kind?: unknown }).kind ?? 'frontmatter');
      const placeholder = `«markua-matter-${placeholderCounter++}»`;
      matterPlaceholders.push({ placeholder, rendered: `{${kind}}` });
      passthrough.push(
        {
          _type: 'block',
          _key: (block as { _key?: string })._key ?? '',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', _key: '', text: placeholder, marks: [] }],
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    passthrough.push(block);
  }

  let out = portableTextToMarkdown(passthrough as unknown as TypedObject[]);
  for (const { placeholder, rendered } of asidePlaceholders) {
    out = out.replace(placeholder, rendered);
  }
  for (const { placeholder, rendered } of matterPlaceholders) {
    out = out.replace(placeholder, rendered);
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const markuaFormat: Format = {
  id: 'markua',
  label: 'Markua (Leanpub)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return markuaToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMarkua(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^[ATWIEDXQB]>[ \t]+\S/m.test(value)) hits += 2; // aside line
    if (/^\{(?:frontmatter|mainmatter|backmatter)\}\s*$/m.test(value)) hits += 2;
    if (/^#{1,6}\s+\S/m.test(value)) hits += 1;
    if (/!\[[^\]]*\]\([^)]+\)\{[^}]+\}/.test(value)) hits += 1; // image attrs
    return Math.min(1, hits * 0.25);
  },
};

export default markuaFormat;
