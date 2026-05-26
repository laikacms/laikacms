/**
 * Deterministic `_key` generation for Portable Text.
 *
 * Keys are counter-based so a given conversion produces stable, repeatable
 * keys — which keeps round-trips through any editor (`PT -> editor -> PT`)
 * byte-stable.
 */
export function createKeyGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}${counter++}`;
}

/** Recursively strip every `_key` from a Portable Text value (for test diffs). */
export function stripKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripKeys) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === '_key') continue;
      out[key] = stripKeys(val);
    }
    return out as T;
  }
  return value;
}
