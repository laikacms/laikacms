/**
 * Transforms a string into a URL-safe slug.
 * - Lowercase
 * - Unicode normalise + strip diacritics
 * - Replace whitespace with hyphens
 * - Remove chars outside [a-z0-9-]
 */
export function toSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
