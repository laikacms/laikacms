import * as S from 'effect/Schema';

/**
 * Effect Schema for ISO date strings.
 * Uses the built-in DateTimeUtcFromString which handles ISO 8601 format.
 * For optional date fields, use S.optional(IsoDateWithFallbackSchema).
 */
export const IsoDateWithFallbackSchema = S.DateTimeUtcFromString;

export type IsoDateWithFallback = S.Schema.Type<typeof IsoDateWithFallbackSchema>;
