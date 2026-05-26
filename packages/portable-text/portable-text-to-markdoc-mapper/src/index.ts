import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * Markdoc (Stripe) <-> Portable Text.
 *
 * Markdoc layers `{% tag %}` blocks on top of CommonMark. We delegate the
 * markdown base to `@portabletext/markdown` and extract top-level Markdoc
 * tags into Portable Text custom blocks (`_type: 'markdoc:<tag>'`).
 *
 * Supported:
 *  - `{% tag attr="value" %}body{% /tag %}`  (paired)
 *  - `{% tag attr="value" /%}`               (self-closing)
 *  - Standard CommonMark base.
 *
 * Out of scope (treated as literal text): variables `{% $foo %}`, function
 * calls `{% fn(arg) %}`, annotations `{% #id %}` on headings, conditionals.
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

interface ParsedTag {
  name: string;
  attrs: Record<string, unknown>;
  children: string | null;
  start: number;
  end: number;
}

function parseAttrs(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[2] !== undefined) out[m[1]!] = m[2];
    else if (m[3] !== undefined) out[m[1]!] = m[3];
    else if (m[4] !== undefined) {
      // numeric or boolean literal
      if (m[4] === 'true') out[m[1]!] = true;
      else if (m[4] === 'false') out[m[1]!] = false;
      else if (/^-?\d+(?:\.\d+)?$/.test(m[4])) out[m[1]!] = Number(m[4]);
      else out[m[1]!] = m[4];
    } else out[m[1]!] = true;
  }
  return out;
}

function attrsToMarkdoc(attrs: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === true) out.push(key);
    else if (typeof value === 'string') out.push(`${key}="${value.replace(/"/g, '\\"')}"`);
    else out.push(`${key}=${JSON.stringify(value)}`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function findTag(input: string, index: number): ParsedTag | null {
  const openRe = /\{%\s+(\/?)([a-zA-Z][\w-]*)((?:\s+[A-Za-z_][\w-]*(?:=(?:"[^"]*"|'[^']*'|\S+))?)*)\s*(\/)?\s*%\}/g;
  openRe.lastIndex = index;
  const open = openRe.exec(input);
  if (!open || open[1] === '/') return null;
  const name = open[2]!;
  const attrs = parseAttrs(open[3] ?? '');
  if (open[4]) {
    return { name, attrs, children: null, start: open.index, end: openRe.lastIndex };
  }
  // Find the matching `{% /name %}`.
  const closeRe = new RegExp(`\\{%\\s*\\/${name}\\s*%\\}`, 'g');
  closeRe.lastIndex = openRe.lastIndex;
  const close = closeRe.exec(input);
  if (!close) {
    return { name, attrs, children: null, start: open.index, end: openRe.lastIndex };
  }
  const children = input.slice(openRe.lastIndex, close.index);
  return { name, attrs, children, start: open.index, end: closeRe.lastIndex };
}

// --- Markdoc -> PT --------------------------------------------------------

export function markdocToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const slots: ParsedTag[] = [];
  let prepared = '';
  let i = 0;
  while (i < input.length) {
    const tag = findTag(input, i);
    if (!tag) {
      prepared += input.slice(i);
      break;
    }
    prepared += input.slice(i, tag.start);
    const idx = slots.length;
    slots.push(tag);
    prepared += `\n\nMARKDOCSLOT${idx}\n\n`;
    i = tag.end;
  }

  const blocks = markdownToPortableText(prepared, { keyGenerator: createKeyGenerator('k') });
  const out: PortableTextDocument = [];
  for (const block of blocks as unknown as PortableTextDocument) {
    if ((block as { _type?: string })._type === 'block') {
      const children = (block as { children?: Array<{ text?: string }> }).children ?? [];
      const onlyText = children.length === 1 && typeof children[0]?.text === 'string' ? children[0].text : null;
      const m = onlyText && /^MARKDOCSLOT(\d+)$/.exec(onlyText);
      if (m) {
        const slot = slots[Number(m[1])];
        if (slot) {
          out.push({
            _type: `markdoc:${slot.name}`,
            _key: keys.block(),
            ...slot.attrs,
            ...(slot.children !== null ? { children: slot.children } : {}),
          });
          continue;
        }
      }
    }
    out.push(block);
  }
  return out;
}

// --- PT -> Markdoc --------------------------------------------------------

export function portableTextToMarkdoc(doc: PortableTextDocument): string {
  const passthrough: PortableTextDocument = [];
  const tags: Array<{ render: string }> = [];

  for (let i = 0; i < doc.length; i += 1) {
    const block = doc[i]! as {
      _type?: string,
      _key?: string,
      children?: string | Array<{ marks?: string[], text?: string }>,
      [k: string]: unknown,
    };
    const type = block._type;
    if (type && type.startsWith('markdoc:')) {
      const tagName = type.slice('markdoc:'.length);
      const { _type, _key, children, ...rest } = block;
      void _type;
      void _key;
      const attrs = attrsToMarkdoc(rest);
      const childrenText = typeof children === 'string' ? children : '';
      const render = childrenText
        ? `{% ${tagName}${attrs} %}${childrenText}{% /${tagName} %}`
        : `{% ${tagName}${attrs} /%}`;
      tags.push({ render });
      passthrough.push(
        {
          _type: 'block',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', text: `MARKDOCSLOT${tags.length - 1}`, marks: [] }],
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    passthrough.push(doc[i]!);
  }

  let out = portableTextToMarkdown(passthrough as unknown as TypedObject[]);
  for (let j = 0; j < tags.length; j += 1) {
    out = out.replace(new RegExp(`MARKDOCSLOT${j}`, 'g'), tags[j]!.render);
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const markdocFormat: Format = {
  id: 'markdoc',
  label: 'Markdoc',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return markdocToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMarkdoc(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/\{%\s+[a-zA-Z][\w-]*[^%]*%\}/.test(value)) hits += 2;
    if (/\{%\s+\/[a-zA-Z][\w-]*\s*%\}/.test(value)) hits += 1;
    if (/^#{1,6}\s/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default markdocFormat;
