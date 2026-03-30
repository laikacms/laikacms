import { StorageObjectContentSchema, AtomBaseSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { StandardSchemaV1 } from '@standard-schema/spec';

export const DocumentSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published'),
  status: S.Literal('published'),
  content: StorageObjectContentSchema,
}));

export type Document = S.Schema.Type<typeof DocumentSchema>;
