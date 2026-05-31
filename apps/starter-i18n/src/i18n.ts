/**
 * Negotiate a locale from an `Accept-Language` header against a list of
 * supported locales. Returns the first match, or the fallback locale.
 *
 * Real apps should reach for `@formatjs/intl-localematcher` or
 * `negotiator` — this is a tiny dependency-free version sufficient for the
 * starter.
 */
export function negotiateLocale(
  acceptLanguage: string | null,
  supported: readonly string[],
  fallback: string,
): string {
  if (!acceptLanguage) return fallback;
  const candidates = acceptLanguage
    .split(',')
    .map(p => {
      const [tag, ...params] = p.trim().split(';');
      const qParam = params.find(x => x.trim().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: (tag ?? '').toLowerCase(), q: Number.isNaN(q) ? 1 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    const primary = candidate.tag.split('-')[0];
    if (!primary) continue;
    for (const locale of supported) {
      if (locale.toLowerCase().split('-')[0] === primary) return locale;
    }
  }
  return fallback;
}
