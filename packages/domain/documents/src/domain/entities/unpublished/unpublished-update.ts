import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from '@laikacms/storage';

/**
 * Schema for updating an unpublished document
 * Only key is required, content and status can be changed to transition between states
 */
export const UnpublishedUpdateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  content: S.optional(StorageObjectContentSchema),
  status: S.optional(S.String),
}));

export type UnpublishedUpdate = S.Schema.Type<typeof UnpublishedUpdateSchema>;
