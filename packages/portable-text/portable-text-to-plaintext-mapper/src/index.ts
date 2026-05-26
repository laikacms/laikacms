import type { Format, PortableTextDocument } from '@laikacloud/portabletext-core';
import { toPlainText } from '@portabletext/toolkit';

/**
 * The plain-text format.
 *
 * `toPortableText` splits the value on blank lines into paragraphs; each
 * paragraph becomes a single span. `fromPortableText` runs `@portabletext/toolkit`
 * `toPlainText` over the document, dropping all marks and custom blocks.
 *
 * `detect` deliberately scores low — plain text is the catch-all fallback when
 * no syntax-laden format claims the value.
 */
export const plainTextFormat: Format = {
  id: 'plaintext',
  label: 'Plain text',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return value.split(/\n{2,}/).map(paragraph => ({
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{ _type: 'span', text: paragraph, marks: [] }],
    }));
  },

  fromPortableText(doc: PortableTextDocument): string {
    // Render block by block so we control the inter-block separator. Custom
    // blocks (non-`block`) contribute nothing — plain text drops them.
    const parts: string[] = [];
    for (const block of doc) {
      const t = (block as { _type?: string })._type;
      if (t !== 'block') continue;
      parts.push(toPlainText([block as never]));
    }
    return parts.join('\n\n');
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    // Plain text always matches a little — every other format that scores
    // higher wins. We score above zero so a totally featureless string still
    // resolves to *some* format.
    return 0.15;
  },
};

export default plainTextFormat;
