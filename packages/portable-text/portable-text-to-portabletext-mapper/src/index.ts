import type { Format, PortableTextDocument } from '@laikacloud/portabletext-core';

/**
 * The Portable Text format. Since Portable Text is the canonical interchange
 * representation, this format is a near-identity: `toPortableText` parses JSON
 * and `fromPortableText` stringifies it.
 */
export const portableTextFormat: Format = {
  id: 'portabletext',
  label: 'Portable Text',

  toPortableText(value: string): PortableTextDocument {
    const trimmed = value.trim();
    if (trimmed === '') return [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? (parsed as PortableTextDocument) : [];
    } catch {
      return [];
    }
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(doc, null, 2);
  },

  detect(value: string): number {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[')) return 0;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return 0;
      if (parsed.length === 0) return 0.3;
      const everyItemTyped = parsed.every(
        item => !!item && typeof item === 'object' && typeof item._type === 'string',
      );
      if (!everyItemTyped) return 0;
      const hasTextBlock = parsed.some(item => item._type === 'block');
      return hasTextBlock ? 1 : 0.7;
    } catch {
      return 0;
    }
  },
};

export default portableTextFormat;
