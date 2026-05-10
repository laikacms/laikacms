import * as S from 'effect/Schema';

/**
 * Effect Schema for storage format.
 * A branded string type representing the storage format (e.g., 'json', 'yaml', 'markdown').
 */
export const StorageFormatSchema = S.String.pipe(S.brand('StorageFormat'));

export type StorageFormat = S.Schema.Type<typeof StorageFormatSchema>;
