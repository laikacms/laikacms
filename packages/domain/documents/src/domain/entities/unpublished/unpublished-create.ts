import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

/**
 * Schema for creating a new unpublished document
 */
export const UnpublishedCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('unpublished'),
  status: S.String,
  content: StorageObjectContentSchema,
}));

export type UnpublishedCreate = S.Schema.Type<typeof UnpublishedCreateSchema>;
