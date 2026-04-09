import * as S from 'effect/Schema';

/**
 * Effect Schema for storage key.
 * Validates that the key contains only alphanumeric characters, underscores, hyphens, and slashes.
 */
export const KeySchema = S.String.pipe(
  S.check(S.isPattern(/^[a-zA-Z0-9_\-\/]+$/)),
);

export type Key = S.Schema.Type<typeof KeySchema>;
