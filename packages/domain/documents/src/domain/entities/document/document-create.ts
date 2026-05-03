import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

// Omit status from create schema - it's always 'published' for documents
// and will be added automatically by the repository
export const DocumentCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('published'),
  status: S.Literal('published'),
  language: DocumentLanguage,
  // CP 47 language tags
  content: StorageObjectContentSchema,
}));

export type DocumentCreate = S.Schema.Type<typeof DocumentCreateSchema>;
