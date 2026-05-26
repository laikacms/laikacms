import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * MyST Markdown (Sphinx / Jupyter Book) <-> Portable Text.
 *
 * MyST is CommonMark plus:
 *  - Inline roles:   `` {role}`content` `` — most useful here are `{sub}` and
 *                    `{sup}` (mapped to the sub/sup decorators) and `{kbd}`
 *                    (mapped to the code decorator).
 *  - Directives:     `` :::{name} arg `` ... `` ::: `` — modelled as Portable
 *                    Text custom blocks with `_type: 'myst:<name>'`, the
 *                    raw argument under `arg`, and the body under `children`.
 *
 * The CommonMark base round-trips via `@portabletext/markdown`.
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

const ROLE_TO_MARK: Record<string, string> = {
  sub: 'sub',
  sup: 'sup',
  kbd: 'code',
  code: 'code',
  abbr: 'em',
  emphasis: 'em',
  strong: 'strong',
};

const MARK_TO_ROLE: Record<string, string> = {
  sub: 'sub',
  sup: 'sup',
};

// --- MyST -> PT -----------------------------------------------------------

interface DirectiveSlot {
  name: string;
  arg: string;
  body: string;
}

/** Split `:::{name} arg ... :::` directive blocks out of the input. */
function extractDirectives(input: string): { stripped: string, slots: DirectiveSlot[] } {
  const slots: DirectiveSlot[] = [];
  const re = /^:::\{([a-zA-Z][\w-]*)\}\s*([^\n]*)\n([\s\S]*?)\n:::\s*$/gm;
  const stripped = input.replace(re, (_, name: string, arg: string, body: string) => {
    const idx = slots.length;
    slots.push({ name, arg: arg.trim(), body });
    return `\n\nMYSTDIR${idx}\n\n`;
  });
  return { stripped, slots };
}

/** Convert MyST inline roles to portable-text-markdown-friendly inline syntax. */
function transformInlineRoles(input: string): string {
  return input.replace(/\{(\w+)\}`([^`\n]+)`/g, (_, role: string, content: string) => {
    // Map common roles to CommonMark equivalents; pass through unknown roles
    // as plain text (they'll be lost but won't break the parse).
    if (role === 'strong') return `**${content}**`;
    if (role === 'emphasis' || role === 'abbr') return `*${content}*`;
    if (role === 'kbd' || role === 'code') return '`' + content + '`';
    if (role === 'sub') return `«sub:${content}»`;
    if (role === 'sup') return `«sup:${content}»`;
    return content;
  });
}

/** Walk the parsed PT and apply sub/sup markers back into real marks. */
function fixupRoleMarkers(doc: PortableTextDocument): void {
  for (const block of doc) {
    const b = block as { children?: Array<{ text?: string, marks?: string[] }> };
    if (!b.children) continue;
    const newChildren: typeof b.children = [];
    for (const span of b.children) {
      const text = span.text ?? '';
      const re = /«sub:([^»]+)»|«sup:([^»]+)»/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      const baseMarks = span.marks ?? [];
      while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
          newChildren.push({ ...span, text: text.slice(lastIndex, match.index) });
        }
        const decorator = match[1] !== undefined ? 'sub' : 'sup';
        newChildren.push({
          ...span,
          text: match[1] ?? match[2] ?? '',
          marks: [...baseMarks, decorator],
        });
        lastIndex = re.lastIndex;
      }
      if (lastIndex === 0) {
        newChildren.push(span);
      } else if (lastIndex < text.length) {
        newChildren.push({ ...span, text: text.slice(lastIndex) });
      }
    }
    b.children = newChildren;
  }
}

export function mystToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const { stripped, slots } = extractDirectives(input);
  const withInline = transformInlineRoles(stripped);
  const md = markdownToPortableText(withInline, { keyGenerator: createKeyGenerator('k') });
  const doc = md as unknown as PortableTextDocument;

  // Replace the placeholder paragraphs with directive custom blocks.
  const out: PortableTextDocument = [];
  for (const block of doc) {
    const b = block as { _type?: string, children?: Array<{ text?: string }> };
    if (b._type === 'block' && b.children && b.children.length === 1) {
      const text = b.children[0]?.text ?? '';
      const m = /^MYSTDIR(\d+)$/.exec(text);
      if (m) {
        const slot = slots[Number(m[1])];
        if (slot) {
          out.push({
            _type: `myst:${slot.name}`,
            _key: keys.block(),
            ...(slot.arg ? { arg: slot.arg } : {}),
            body: slot.body,
          });
          continue;
        }
      }
    }
    out.push(block);
  }

  fixupRoleMarkers(out);
  return out;
}

// --- PT -> MyST -----------------------------------------------------------

export function portableTextToMyst(doc: PortableTextDocument): string {
  // 1. Rewrite sub/sup spans into role placeholders, then emit markdown.
  const passthrough: PortableTextDocument = [];
  const directives: Array<{ index: number, render: string }> = [];

  for (let i = 0; i < doc.length; i += 1) {
    const block = doc[i]! as {
      _type?: string,
      arg?: string,
      body?: string,
      children?: Array<{ marks?: string[], text?: string }>,
    };
    const type = block._type;
    if (type && type.startsWith('myst:')) {
      const directiveName = type.slice('myst:'.length);
      const arg = block.arg ?? '';
      const body = block.body ?? '';
      const render = `:::{${directiveName}} ${arg}\n${body}\n:::`;
      directives.push({ index: passthrough.length, render });
      passthrough.push(
        {
          _type: 'block',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', text: `MYSTDIRECTIVE${directives.length - 1}`, marks: [] }],
        } as unknown as PortableTextDocument[number],
      );
      continue;
    }
    // Wrap sub/sup spans in `{role}` literal markers.
    if (block._type === 'block' && block.children) {
      const rewritten = {
        ...(block as object),
        children: (block.children as { marks?: string[], text?: string }[]).map(child => {
          const marks = child.marks ?? [];
          const subOrSup = marks.find(m => MARK_TO_ROLE[m]);
          if (subOrSup) {
            const role = MARK_TO_ROLE[subOrSup]!;
            const trimmed = marks.filter(m => m !== subOrSup);
            return {
              ...child,
              text: `«${role}:${child.text ?? ''}»`,
              marks: trimmed,
            };
          }
          return child;
        }),
      };
      passthrough.push(rewritten as unknown as PortableTextDocument[number]);
      continue;
    }
    passthrough.push(doc[i]!);
  }

  let out = portableTextToMarkdown(passthrough as unknown as TypedObject[]);
  // Restore role placeholders.
  out = out.replace(/«([a-z]+):([^»]*)»/g, (_, role: string, content: string) => '{' + role + '}`' + content + '`');
  // Restore directive placeholders.
  for (let i = 0; i < directives.length; i += 1) {
    const re = new RegExp(`MYSTDIRECTIVE${i}`, 'g');
    out = out.replace(re, directives[i]!.render);
  }
  void ROLE_TO_MARK;
  return out;
}

// --- Format ---------------------------------------------------------------

export const mystFormat: Format = {
  id: 'myst',
  label: 'MyST Markdown',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return mystToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMyst(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^:::\{[a-zA-Z][\w-]*\}/m.test(value)) hits += 2;
    if (/\{\w+\}`[^`\n]+`/.test(value)) hits += 2;
    if (/^#{1,6}\s/m.test(value)) hits += 1;
    if (/^```/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default mystFormat;
