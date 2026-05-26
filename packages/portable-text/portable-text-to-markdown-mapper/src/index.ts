import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import { markdownToPortableText, portableTextToMarkdown } from '@portabletext/markdown';
import type { TypedObject } from '@portabletext/types';

/** Markdown syntax probes; each hit raises the detection score. */
const MARKDOWN_PROBES: readonly RegExp[] = [
  /^#{1,6}\s/m, // ATX heading
  /^\s*[-*+]\s/m, // bullet list
  /^\s*\d+\.\s/m, // ordered list
  /^>\s/m, // blockquote
  /```/, // fenced code
  /\*\*[^*\n]+\*\*/, // bold
  /\[[^\]\n]+\]\([^)\n]+\)/, // link
  /^\s*([-*_])\1{2,}\s*$/m, // thematic break
];

/**
 * The Markdown format, backed by `@portabletext/markdown`.
 */
export const markdownFormat: Format = {
  id: 'markdown',
  label: 'Markdown',

  toPortableText(value: string): PortableTextDocument {
    // Deterministic keys keep `markdown -> PT` stable across calls.
    return markdownToPortableText(value, {
      keyGenerator: createKeyGenerator('k'),
    }) as unknown as PortableTextDocument;
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMarkdown(doc as unknown as TypedObject[]);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    for (const probe of MARKDOWN_PROBES) {
      if (probe.test(value)) hits += 1;
    }
    // Plain prose is also valid Markdown, so never score it at zero.
    if (hits === 0) return 0.2;
    return Math.min(1, 0.4 + hits * 0.2);
  },
};

export default markdownFormat;
