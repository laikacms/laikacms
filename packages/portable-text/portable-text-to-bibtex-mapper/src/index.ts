import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock } from '@portabletext/types';

/**
 * BibTeX <-> Portable Text.
 *
 * Each `@type{key, …}` entry maps to a custom Portable Text block:
 *
 *   {
 *     _type: 'bibtex:entry',
 *     _key: '…',
 *     entryType: 'article',
 *     citationKey: 'doe2024',
 *     fields: { author: '…', title: '…', year: '2024', … }
 *   }
 *
 * `@string{macro = "…"}` definitions and `@preamble{…}` are captured as
 * `bibtex:string` / `bibtex:preamble` blocks. Stray comments (lines starting
 * with `%`, and `@comment{…}` blocks) are dropped on the way in.
 *
 * Field values keep whatever delimiters they were written with (`{ … }`,
 * `" … "`, or bare) on a best-effort basis — we always emit `{ … }` on the
 * way out for a consistent shape.
 */

interface BibtexFields {
  [key: string]: string;
}

interface Keys {
  block: () => string;
}

function newKeys(): Keys {
  return { block: createKeyGenerator('b') };
}

// --- Tokeniser helpers ----------------------------------------------------

function skipWhitespaceAndComments(src: string, i: number): number {
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    // Line comment starting with `%`.
    if (c === '%') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    break;
  }
  return i;
}

function readBracedValue(src: string, start: number): { value: string, next: number } {
  // src[start] is `{`. Find matching `}` honouring nesting.
  let depth = 1;
  let i = start + 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }
  return { value: src.slice(start + 1, i), next: i + 1 };
}

function readQuotedValue(src: string, start: number): { value: string, next: number } {
  // src[start] is `"`. Read until matching `"` (no nesting).
  let i = start + 1;
  while (i < src.length && src[i] !== '"') {
    if (src[i] === '\\' && i + 1 < src.length) i += 2;
    else i += 1;
  }
  return { value: src.slice(start + 1, i), next: i + 1 };
}

function readBareValue(src: string, start: number): { value: string, next: number } {
  // A macro name or a number, up to `,` `}` whitespace.
  let i = start;
  while (i < src.length && !/[\s,}]/.test(src[i]!)) i += 1;
  return { value: src.slice(start, i), next: i };
}

function readIdent(src: string, start: number): { value: string, next: number } {
  let i = start;
  while (i < src.length && /[A-Za-z0-9_.:-]/.test(src[i]!)) i += 1;
  return { value: src.slice(start, i), next: i };
}

// --- BibTeX -> PT ---------------------------------------------------------

export function bibtexToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  let i = 0;

  while (i < input.length) {
    i = skipWhitespaceAndComments(input, i);
    if (i >= input.length) break;
    if (input[i] !== '@') {
      // Stray content — skip to next line.
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    // Read entry type.
    i += 1;
    const { value: entryType, next: afterType } = readIdent(input, i);
    i = skipWhitespaceAndComments(input, afterType);
    if (input[i] !== '{') {
      // Malformed; skip the line.
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    // Locate the matching close `}` for this entry.
    const { value: body, next: afterBody } = readBracedValue(input, i);
    i = afterBody;
    const lowerType = entryType.toLowerCase();

    if (lowerType === 'comment') {
      // Drop.
      continue;
    }
    if (lowerType === 'preamble') {
      out.push({
        _type: 'bibtex:preamble',
        _key: keys.block(),
        value: body.trim(),
      } as unknown as PortableTextBlock);
      continue;
    }
    if (lowerType === 'string') {
      const eq = body.indexOf('=');
      if (eq === -1) continue;
      const name = body.slice(0, eq).trim();
      const valueRaw = body.slice(eq + 1).trim();
      let value = valueRaw;
      if (valueRaw.startsWith('"') && valueRaw.endsWith('"')) value = valueRaw.slice(1, -1);
      else if (valueRaw.startsWith('{') && valueRaw.endsWith('}')) value = valueRaw.slice(1, -1);
      out.push({
        _type: 'bibtex:string',
        _key: keys.block(),
        name,
        value,
      } as unknown as PortableTextBlock);
      continue;
    }

    // Regular entry: `key, field = value, field = value, …`
    let j = 0;
    j = skipBodyWhitespace(body, j);
    const { value: citationKey, next: afterKey } = readIdent(body, j);
    j = skipBodyWhitespace(body, afterKey);
    const fields: BibtexFields = {};
    while (j < body.length) {
      if (body[j] === ',') {
        j += 1;
        j = skipBodyWhitespace(body, j);
        continue;
      }
      // Field name.
      const fieldName = readIdent(body, j);
      if (!fieldName.value) {
        j += 1;
        continue;
      }
      j = skipBodyWhitespace(body, fieldName.next);
      if (body[j] !== '=') {
        // Malformed field; bail out.
        j += 1;
        continue;
      }
      j += 1;
      j = skipBodyWhitespace(body, j);
      let value: string;
      if (body[j] === '{') {
        const r = readBracedValue(body, j);
        value = r.value;
        j = r.next;
      } else if (body[j] === '"') {
        const r = readQuotedValue(body, j);
        value = r.value;
        j = r.next;
      } else {
        const r = readBareValue(body, j);
        value = r.value;
        j = r.next;
      }
      fields[fieldName.value.toLowerCase()] = value;
      j = skipBodyWhitespace(body, j);
    }
    out.push({
      _type: 'bibtex:entry',
      _key: keys.block(),
      entryType: lowerType,
      citationKey,
      fields,
    } as unknown as PortableTextBlock);
  }

  return out;
}

function skipBodyWhitespace(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i]!)) i += 1;
  return i;
}

// --- PT -> BibTeX ---------------------------------------------------------

export function portableTextToBibtex(doc: PortableTextDocument): string {
  const out: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'bibtex:preamble') {
      const value = String((block as { value?: unknown }).value ?? '');
      out.push(`@preamble{${value}}`);
      continue;
    }
    if (t === 'bibtex:string') {
      const name = String((block as { name?: unknown }).name ?? '');
      const value = String((block as { value?: unknown }).value ?? '');
      out.push(`@string{${name} = {${value}}}`);
      continue;
    }
    if (t === 'bibtex:entry') {
      const entryType = String((block as { entryType?: unknown }).entryType ?? 'misc');
      const citationKey = String((block as { citationKey?: unknown }).citationKey ?? '');
      const fields = ((block as { fields?: unknown }).fields ?? {}) as BibtexFields;
      const lines = [`@${entryType}{${citationKey},`];
      const keys = Object.keys(fields);
      keys.forEach((k, idx) => {
        const sep = idx === keys.length - 1 ? '' : ',';
        lines.push(`  ${k} = {${fields[k]}}${sep}`);
      });
      lines.push('}');
      out.push(lines.join('\n'));
      continue;
    }
  }
  return out.join('\n\n');
}

// --- Format ---------------------------------------------------------------

export const bibtexFormat: Format = {
  id: 'bibtex',
  label: 'BibTeX',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return bibtexToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToBibtex(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    const entries = value.match(/@[A-Za-z]+\s*\{/g) ?? [];
    hits += Math.min(3, entries.length);
    if (/^\s*[A-Za-z]+\s*=\s*[{"]/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.25);
  },
};

export default bibtexFormat;
