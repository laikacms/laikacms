import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from '@laikacms/storage';

// Omit status from create schema - it's always 'published' for documents
// and will be added automatically by the repository
export const DocumentCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('published'),
  status: S.Literal('published'),
  content: StorageObjectContentSchema,
}));

export type DocumentCreate = S.Schema.Type<typeof DocumentCreateSchema>;
