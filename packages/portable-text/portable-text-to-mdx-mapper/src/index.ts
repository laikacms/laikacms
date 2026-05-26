import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * MDX (Markdown + JSX) <-> Portable Text.
 *
 * Built on top of `@portabletext/markdown` for the CommonMark base, then
 * extracts top-level JSX components — self-closing or paired — and turns
 * them into custom Portable Text blocks whose `_type` is the component name
 * and whose data is the JSX attribute map. `import`/`export` statements at
 * the top are stripped (we don't evaluate JS); JS expressions `{…}` are kept
 * verbatim in the markdown they appear in.
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

/** A standalone JSX component recognised at top level. */
interface ParsedJsx {
  name: string;
  props: Record<string, unknown>;
  children: string | null; // null for self-closing
  start: number;
  end: number;
}

/**
 * Find the first top-level JSX component (open or self-closing) starting at
 * `index`. Returns null if none. We only treat tags that start with an
 * uppercase letter (React-component convention) so plain HTML stays inside
 * the markdown.
 */
function findJsx(input: string, index: number): ParsedJsx | null {
  const openRe = /<([A-Z][A-Za-z0-9]*)((?:\s+[A-Za-z_:][\w:-]*(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*)\s*(\/?)\s*>/g;
  openRe.lastIndex = index;
  const open = openRe.exec(input);
  if (!open) return null;
  const name = open[1]!;
  const props = parseProps(open[2] ?? '');
  if (open[3] === '/') {
    return { name, props, children: null, start: open.index, end: open.index + open[0].length };
  }
  // Look for a matching `</Name>` — naive: assumes no nested same-name tags.
  const closeIndex = input.indexOf(`</${name}>`, open.index + open[0].length);
  if (closeIndex === -1) {
    // Treat as self-closing if no closer is found, to stay resilient.
    return { name, props, children: null, start: open.index, end: open.index + open[0].length };
  }
  const children = input.slice(open.index + open[0].length, closeIndex);
  return { name, props, children, start: open.index, end: closeIndex + `</${name}>`.length };
}

function parseProps(raw: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const re = /([A-Za-z_:][\w:-]*)(?:=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1]!;
    if (match[2] !== undefined) props[name] = match[2];
    else if (match[3] !== undefined) props[name] = match[3];
    else if (match[4] !== undefined) props[name] = `{${match[4]}}`;
    else props[name] = true;
  }
  return props;
}

function propsToJsx(props: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === true) {
      out.push(key);
    } else if (typeof value === 'string') {
      if (value.startsWith('{') && value.endsWith('}')) out.push(`${key}=${value}`);
      else out.push(`${key}="${value.replace(/"/g, '&quot;')}"`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out.push(`${key}={${String(value)}}`);
    } else {
      out.push(`${key}={${JSON.stringify(value)}}`);
    }
  }
  return out.length ? ' ' + out.join(' ') : '';
}

// --- MDX -> PT ------------------------------------------------------------

export function mdxToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  // Strip `import` / `export` statements at the top — they're not renderable.
  const stripped = input
    .split(/\n{2,}/)
    .filter(p => !/^\s*(import|export)\s/.test(p))
    .join('\n\n');

  // Extract top-level JSX (between paragraph boundaries) into placeholders.
  type Slot = { type: 'jsx', jsx: ParsedJsx };
  const slots: Slot[] = [];
  let prepared = '';
  let i = 0;
  while (i < stripped.length) {
    const jsx = findJsx(stripped, i);
    if (!jsx) {
      prepared += stripped.slice(i);
      break;
    }
    prepared += stripped.slice(i, jsx.start);
    const idx = slots.length;
    slots.push({ type: 'jsx', jsx });
    prepared += `\n\nMDXSLOT${idx}\n\n`;
    i = jsx.end;
  }

  const blocks = markdownToPortableText(prepared, { keyGenerator: createKeyGenerator('k') });
  const out: PortableTextDocument = [];
  for (const block of blocks as unknown as PortableTextDocument) {
    // Detect placeholder paragraphs and swap them for the JSX custom block.
    if ((block as { _type?: string })._type === 'block') {
      const children = (block as { children?: Array<{ text?: string }> }).children ?? [];
      const onlyText = children.length === 1 && typeof children[0]?.text === 'string' ? children[0].text : null;
      const m = onlyText && /^MDXSLOT(\d+)$/.exec(onlyText);
      if (m) {
        const slot = slots[Number(m[1])];
        if (slot) {
          const childrenText = slot.jsx.children ?? '';
          out.push({
            _type: slot.jsx.name,
            _key: keys.block(),
            ...slot.jsx.props,
            ...(childrenText ? { children: childrenText } : {}),
          });
          continue;
        }
      }
    }
    out.push(block);
  }
  return out;
}

// --- PT -> MDX ------------------------------------------------------------

export function portableTextToMdx(doc: PortableTextDocument): string {
  // Pull custom (non-`block`/`code`) types out as JSX components; let the
  // rest go through the standard markdown serialiser.
  const passthrough: PortableTextDocument = [];
  const jsxBlocks: Array<{ index: number, render: string }> = [];

  for (let i = 0; i < doc.length; i += 1) {
    const block = doc[i]! as { _type?: string, children?: string, [k: string]: unknown };
    const type = block._type;
    if (type && type !== 'block' && type !== 'code') {
      const { _type, _key, children, ...rest } = block;
      void _type;
      void _key;
      const propsJsx = propsToJsx(rest);
      const render = children
        ? `<${type}${propsJsx}>${children}</${type}>`
        : `<${type}${propsJsx} />`;
      jsxBlocks.push({ index: passthrough.length, render });
      passthrough.push(
        {
          _type: 'block',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', text: `MDXSLOT${jsxBlocks.length - 1}`, marks: [] }],
        } as unknown as PortableTextDocument[number],
      );
    } else {
      passthrough.push(doc[i]!);
    }
  }

  let out = portableTextToMarkdown(passthrough as unknown as TypedObject[]);
  for (let j = 0; j < jsxBlocks.length; j += 1) {
    const re = new RegExp(`MDXSLOT${j}`, 'g');
    out = out.replace(re, jsxBlocks[j]!.render);
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const mdxFormat: Format = {
  id: 'mdx',
  label: 'MDX (Markdown + JSX)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return mdxToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMdx(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^\s*import\s/m.test(value)) hits += 1;
    if (/^\s*export\s/m.test(value)) hits += 1;
    if (/<[A-Z][A-Za-z0-9]*(?:\s|\/?>)/.test(value)) hits += 2;
    if (/^#{1,6}\s/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default mdxFormat;
