import { listMappers } from './registry';
import type { Mapper } from './types';

/** Two scores within this distance are considered ambiguous. */
const EPSILON = 0.15;

/**
 * Determine which mapper `value` is written in.
 *
 * Every registered mapper scores the value via `detect`; the highest score
 * wins. When the top scores are within `EPSILON` of each other the result is
 * ambiguous — `hint` (typically the field's `format` property) is the final
 * decider, provided it is one of the close candidates. Falls back to `hint`,
 * then to `portabletext`.
 */
export function detectMapper(value: string, hint?: string): string {
  const mappers = listMappers();
  if (mappers.length === 0) return hint ?? 'portabletext';

  const scored = mappers
    .map(m => ({ id: m.id, score: safeDetect(m, value) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) return hint ?? 'portabletext';

  const close = scored.filter(s => top.score - s.score < EPSILON).map(s => s.id);
  if (close.length > 1 && hint && close.includes(hint)) {
    return hint;
  }
  return top.id;
}

function safeDetect(mapper: Mapper, value: string): number {
  try {
    const score = mapper.detect(value);
    return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  } catch {
    return 0;
  }
}

/** @deprecated Use {@link detectMapper}. */
export const detectFormat = detectMapper;
