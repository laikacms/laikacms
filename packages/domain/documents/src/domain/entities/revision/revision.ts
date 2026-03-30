import { AtomBaseSchema, StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

export const RevisionSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('revision'),
  content: StorageObjectContentSchema,
  revision: S.String,
  createdAt: S.String,
}));

export type Revision = S.Schema.Type<typeof RevisionSchema>;
