import { StorageObjectContentSchema, AtomBaseSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';

export const DocumentSchema = S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published'),
  status: S.Literal('published'),
  content: StorageObjectContentSchema,
});

export type Document = S.Schema.Type<typeof DocumentSchema>;