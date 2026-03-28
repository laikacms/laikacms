import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from '@laikacms/storage';

/**
 * Schema for creating a new unpublished document
 */
export const UnpublishedCreateSchema = S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('unpublished'),
  status: S.String,
  content: StorageObjectContentSchema,
});

export const UnpublishedCreateSchemaStandardV1 = S.toStandardSchemaV1(UnpublishedCreateSchema);

export type UnpublishedCreate = S.Schema.Type<typeof UnpublishedCreateSchema>;
