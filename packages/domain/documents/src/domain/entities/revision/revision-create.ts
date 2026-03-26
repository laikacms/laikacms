import * as S from 'effect/Schema';
import { StorageObjectContentSchema } from '@laikacms/storage';

export const RevisionCreateSchema = S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('revision'),
  content: StorageObjectContentSchema,
  revision: S.String,
});

export type RevisionCreate = S.Schema.Type<typeof RevisionCreateSchema>;
