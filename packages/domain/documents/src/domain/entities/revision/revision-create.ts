import { StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

export const RevisionCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('revision'),
  content: StorageObjectContentSchema,
  revision: S.String,
}));

export type RevisionCreate = S.Schema.Type<typeof RevisionCreateSchema>;
