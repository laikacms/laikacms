import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

/**
 * Schema for creating a new unpublished document
 */
export const UnpublishedCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('unpublished'),
  status: S.String,
  language: DocumentLanguage,
  content: StorageObjectContentSchema,
}));

export type UnpublishedCreate = S.Schema.Type<typeof UnpublishedCreateSchema>;
