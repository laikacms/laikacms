import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of an incoming Authorization header value against
 * an expected bearer token. Returns `true` only when the header is exactly
 * `Bearer <expected>` and the comparison took constant time regardless of how
 * many characters match.
 */
export function bearerTokenMatches(
  authorizationHeader: string | undefined,
  expected: string,
): boolean {
  const actual = Buffer.from(authorizationHeader ?? '', 'utf8');
  const target = Buffer.from(`Bearer ${expected}`, 'utf8');
  return actual.length === target.length && timingSafeEqual(actual, target);
}
