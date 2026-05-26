import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * Pandoc Markdown <-> Portable Text.
 *
 * Pandoc's extended dialect adds several constructs over CommonMark; we cover
 * the ones that map cleanly onto Portable Text:
 *
 *  - `~~strike~~`              → `strike-through` decorator
 *  - `^sup^`                   → `sup` decorator
 *  - `~sub~`                   → `sub` decorator
 *  - `text[^id]` + `[^id]: …`  → custom `pandoc:footnote` block (the
 *                                definition body is captured as the footnote
 *                                content; the reference is preserved inline
 *                                as `[^id]` so it round-trips)
 *
 * Tables, math, and definition lists are deliberately out of scope for the
 * initial cut.
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

// --- Footnote extraction --------------------------------------------------

interface Footnote {
  id: string;
  body: string;
}

function extractFootnotes(input: string): { stripped: string, notes: Footnote[] } {
  const notes: Footnote[] = [];
  // Match a footnote definition `[^id]: body` and any following continuation
  // lines indented by ≥4 spaces.
  const re = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n {4,}[^\n]*)*)/gm;
  const stripped = input.replace(re, (_, id: string, body: string) => {
    notes.push({ id, body: body.replace(/\n {4,}/g, '\n').trim() });
    return '';
  });
  return { stripped, notes };
}

// --- Inline marker placeholder pass --------------------------------------

function transformInline(input: string): string {
  // Pandoc strike / sup / sub use single-char delimiters that CommonMark
  // doesn't define. Replace with placeholders the markdown parser will pass
  // through as plain text spans we re-decorate later.
  return input
    .replace(/~~([^~\n]+)~~/g, '«strike-through:$1»')
    .replace(/\^([^^\n\s][^^\n]*)\^/g, '«sup:$1»')
    .replace(/~([^~\n\s][^~\n]*?)~/g, '«sub:$1»');
}

function untransformInline(text: string): string {
  return text
    .replace(/«strike-through:([^»]+)»/g, '~~$1~~')
    .replace(/«sup:([^»]+)»/g, '^$1^')
    .replace(/«sub:([^»]+)»/g, '~$1~');
}

function fixupMarkers(doc: PortableTextDocument): void {
  for (const block of doc) {
    const b = block as { children?: Array<{ text?: string, marks?: string[] }> };
    if (!b.children) continue;
    const next: typeof b.children = [];
    for (const span of b.children) {
      const text = span.text ?? '';
      const re = /«(strike-through|sup|sub):([^»]+)»/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      const baseMarks = span.marks ?? [];
      while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) next.push({ ...span, text: text.slice(lastIndex, match.index) });
        next.push({ ...span, text: match[2]!, marks: [...baseMarks, match[1]!] });
        lastIndex = re.lastIndex;
      }
      if (lastIndex === 0) next.push(span);
      else if (lastIndex < text.length) next.push({ ...span, text: text.slice(lastIndex) });
    }
    b.children = next;
  }
}

// --- Pandoc -> PT ---------------------------------------------------------

export function pandocToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const { stripped, notes } = extractFootnotes(input);
  const prepared = transformInline(stripped);
  const md = markdownToPortableText(prepared, { keyGenerator: createKeyGenerator('k') });
  const doc = md as unknown as PortableTextDocument;
  fixupMarkers(doc);
  // Emit any footnote definitions as custom blocks at the end.
  for (const note of notes) {
    doc.push({
      _type: 'pandoc:footnote',
      _key: keys.block(),
      id: note.id,
      body: note.body,
    });
  }
  return doc;
}

// --- PT -> Pandoc ---------------------------------------------------------

const DECORATOR_TO_DELIM: Array<[string, (s: string) => string]> = [
  ['strike-through', s => `~~${s}~~`],
  ['sup', s => `^${s}^`],
  ['sub', s => `~${s}~`],
];

export function portableTextToPandoc(doc: PortableTextDocument): string {
  const passthrough: PortableTextDocument = [];
  const footnotes: Footnote[] = [];

  for (let i = 0; i < doc.length; i += 1) {
    const block = doc[i]!;
    const type = (block as { _type?: string })._type;
    if (type === 'pandoc:footnote') {
      const id = String((block as { id?: unknown }).id ?? `${footnotes.length + 1}`);
      const body = String((block as { body?: unknown }).body ?? '');
      footnotes.push({ id, body });
      continue;
    }
    // Rewrite sub/sup/strike-through spans into delimiter placeholders.
    if (type === 'block') {
      const b = block as { children?: Array<{ marks?: string[], text?: string }> } & object;
      if (b.children) {
        const rewritten = {
          ...(b as object),
          children: b.children.map(child => {
            const marks = child.marks ?? [];
            const decoratorIndex = DECORATOR_TO_DELIM.findIndex(([decorator]) => marks.includes(decorator));
            if (decoratorIndex >= 0) {
              const [decorator, fn] = DECORATOR_TO_DELIM[decoratorIndex]!;
              const trimmed = marks.filter(m => m !== decorator);
              return { ...child, text: fn(child.text ?? ''), marks: trimmed };
            }
            return child;
          }),
        };
        passthrough.push(rewritten as unknown as PortableTextDocument[number]);
        continue;
      }
    }
    passthrough.push(block);
  }

  let out = portableTextToMarkdown(passthrough as unknown as TypedObject[]);
  // The DECORATOR_TO_DELIM placeholders are already valid Pandoc syntax,
  // but `~~text~~` will be escaped by the markdown serializer's GFM-unaware
  // emitter — re-introduce them by stripping the escape backslashes Pandoc
  // doesn't need.
  out = untransformInline(out.replace(/\\(~|\^)/g, '$1'));
  // Append footnote definitions.
  for (const note of footnotes) {
    out += `\n\n[^${note.id}]: ${note.body}`;
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const pandocFormat: Format = {
  id: 'pandoc',
  label: 'Pandoc Markdown',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return pandocToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToPandoc(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/\[\^[^\]\s]+\]/.test(value)) hits += 2; // footnote reference
    if (/^\[\^[^\]\s]+\]:/m.test(value)) hits += 2; // footnote definition
    if (/~~[^~\n]+~~/.test(value)) hits += 1;
    if (/(?:^|\s)\^[^^\n\s][^^\n]*\^(?:\s|$)/.test(value)) hits += 1;
    if (/^#{1,6}\s/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default pandocFormat;
