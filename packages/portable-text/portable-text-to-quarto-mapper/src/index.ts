import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/**
 * Quarto (Posit) <-> Portable Text.
 *
 * Quarto is Pandoc Markdown extended with a small set of conventions for
 * scientific publishing. We lean on `@portabletext/markdown` for the shared
 * Markdown subset and layer the Quarto-specific constructs on top:
 *
 *   - Executable code blocks `` ```{lang} … ``` `` → `code` block with
 *     `language` set to `lang` and a `executable: true` flag preserved on
 *     the PT block
 *   - Callout divs `::: {.callout-note title="…"}` … `:::` → custom
 *     `quarto:callout` block with `kind` (`note`/`tip`/`warning`/`important`/
 *     `caution`) and optional `title`
 *   - YAML frontmatter (`---\n…\n---`) at the top of the document → custom
 *     `quarto:frontmatter` block carrying the raw YAML
 *
 * Cross-references (`@fig-…`, `@tbl-…`), citations (`[@key]`), inline
 * executable code (`` `{r} … ` ``), and math (`$…$` / `$$…$$`) pass through as
 * plain Markdown.
 */

const CALLOUT_KINDS = new Set(['note', 'tip', 'warning', 'important', 'caution']);

interface QuartoExtraction {
  cleaned: string;
  callouts: Array<{ kind: string, title?: string, body: string, placeholder: string }>;
  executables: Array<{ language: string, code: string, placeholder: string }>;
  frontmatter?: string;
}

let placeholderCounter = 0;

function extractFrontmatter(input: string): { rest: string, frontmatter?: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(input);
  if (!m) return { rest: input };
  return { rest: input.slice(m[0].length), frontmatter: m[1] };
}

function extractQuarto(input: string): QuartoExtraction {
  const out: QuartoExtraction = { cleaned: input, callouts: [], executables: [] };
  const { rest, frontmatter } = extractFrontmatter(out.cleaned);
  out.cleaned = rest;
  out.frontmatter = frontmatter;

  // Executable code blocks: ```{lang ...} ... ```
  // The Quarto convention puts the language inside braces, e.g. ```{python}.
  out.cleaned = out.cleaned.replace(
    /(^|\n)```\{([a-zA-Z0-9_+-]+)[^\n}]*\}\n([\s\S]*?)\n```(?=\n|$)/g,
    (_match, prefix: string, language: string, body: string) => {
      const placeholder = `«quarto-exec-${placeholderCounter++}»`;
      out.executables.push({ language, code: body, placeholder });
      return `${prefix}${placeholder}`;
    },
  );

  // Callout divs: ::: {.callout-KIND title="..."} ... :::
  // We match non-nested callouts only; nested fenced divs are rare and would
  // demand a real parser.
  out.cleaned = out.cleaned.replace(
    /(^|\n):::+\s*\{\.callout-([a-zA-Z]+)(?:\s+title="([^"]*)")?\s*\}\n([\s\S]*?)\n:::+(?=\n|$)/g,
    (_match, prefix: string, kindRaw: string, title: string | undefined, body: string) => {
      const kind = kindRaw.toLowerCase();
      const placeholder = `«quarto-callout-${placeholderCounter++}»`;
      out.callouts.push({ kind, title, body: body.trim(), placeholder });
      return `${prefix}${placeholder}`;
    },
  );

  return out;
}

function restoreQuartoBlocks(
  doc: PortableTextDocument,
  extraction: QuartoExtraction,
  mkKey: () => string,
): PortableTextDocument {
  const out: PortableTextDocument = [];
  const calloutByPlaceholder = new Map(extraction.callouts.map(c => [c.placeholder, c]));
  const execByPlaceholder = new Map(extraction.executables.map(e => [e.placeholder, e]));
  if (extraction.frontmatter !== undefined) {
    out.push(
      {
        _type: 'quarto:frontmatter',
        _key: mkKey(),
        content: extraction.frontmatter,
      } as unknown as PortableTextDocument[number],
    );
  }

  for (const block of doc) {
    const b = block as { _type?: string, children?: Array<{ text?: string }> };
    if (b._type === 'block' && b.children && b.children.length === 1) {
      const text = (b.children[0]?.text ?? '').trim();
      const callout = calloutByPlaceholder.get(text);
      if (callout) {
        out.push(
          {
            _type: 'quarto:callout',
            _key: mkKey(),
            kind: callout.kind,
            title: callout.title ?? null,
            body: callout.body,
          } as unknown as PortableTextDocument[number],
        );
        continue;
      }
      const exec = execByPlaceholder.get(text);
      if (exec) {
        out.push(
          {
            _type: 'code',
            _key: mkKey(),
            code: exec.code,
            language: exec.language,
            executable: true,
          } as unknown as PortableTextDocument[number],
        );
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

export function quartoToPortableText(input: string): PortableTextDocument {
  const blockKeys = createKeyGenerator('b');
  const extraction = extractQuarto(input);
  const md = markdownToPortableText(extraction.cleaned, {
    keyGenerator: createKeyGenerator('k'),
  });
  return restoreQuartoBlocks(md as unknown as PortableTextDocument, extraction, blockKeys);
}

// --- PT -> Quarto ---------------------------------------------------------

export function portableTextToQuarto(doc: PortableTextDocument): string {
  const passthrough: PortableTextDocument = [];
  const calloutPlaceholders: Array<{ placeholder: string, rendered: string }> = [];
  const execPlaceholders: Array<{ placeholder: string, rendered: string }> = [];
  let frontmatter: string | null = null;

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'quarto:frontmatter') {
      frontmatter = String((block as { content?: unknown }).content ?? '');
      continue;
    }
    if (t === 'quarto:callout') {
      const kindRaw = String((block as { kind?: unknown }).kind ?? 'note');
      const kind = CALLOUT_KINDS.has(kindRaw) ? kindRaw : 'note';
      const title = (block as { title?: unknown }).title;
      const body = String((block as { body?: unknown }).body ?? '');
      const head = title ? `::: {.callout-${kind} title="${title}"}` : `::: {.callout-${kind}}`;
      const rendered = `${head}\n${body}\n:::`;
      const placeholder = `«quarto-callout-${placeholderCounter++}»`;
      calloutPlaceholders.push({ placeholder, rendered });
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
    if (t === 'code' && (block as { executable?: unknown }).executable) {
      const language = String((block as { language?: unknown }).language ?? '');
      const code = String((block as { code?: unknown }).code ?? '');
      const rendered = `\`\`\`{${language}}\n${code}\n\`\`\``;
      const placeholder = `«quarto-exec-${placeholderCounter++}»`;
      execPlaceholders.push({ placeholder, rendered });
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

  let body = portableTextToMarkdown(passthrough as unknown as TypedObject[]);
  for (const { placeholder, rendered } of calloutPlaceholders) body = body.replace(placeholder, rendered);
  for (const { placeholder, rendered } of execPlaceholders) body = body.replace(placeholder, rendered);
  if (frontmatter != null) body = `---\n${frontmatter}\n---\n\n${body}`;
  return body;
}

// --- Format ---------------------------------------------------------------

export const quartoFormat: Format = {
  id: 'quarto',
  label: 'Quarto',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return quartoToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToQuarto(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/```\{[a-zA-Z0-9_+-]+/.test(value)) hits += 3; // executable code chunk
    if (/:::\s*\{\.callout-/.test(value)) hits += 3;
    if (/^---\n[\s\S]+?\n---/m.test(value)) hits += 1;
    if (/@(?:fig|tbl|eq)-[\w-]+/.test(value)) hits += 1;
    if (/#\|\s\w+:/.test(value)) hits += 1; // chunk option line `#| label: foo`
    return Math.min(1, hits * 0.2);
  },
};

export default quartoFormat;
