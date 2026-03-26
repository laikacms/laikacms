import * as S from 'effect/Schema';

/**
 * Effect Schema for storage provider.
 * A branded string type representing the storage provider (e.g., 'r2', 'fs', 's3').
 */
export const StorageProviderSchema = S.String.pipe(S.brand('StorageProvider'));

export type StorageProvider = S.Schema.Type<typeof StorageProviderSchema>;
