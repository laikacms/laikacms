import * as S from 'effect/Schema';
import { AtomBaseSchema } from '../atom/atom-base.js';

export const StorageObjectContentSchema = S.Record(S.String, S.Any);

export type StorageObjectContent = S.Schema.Type<typeof StorageObjectContentSchema>;

export const StorageObjectSchema = S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('object'),
  content: StorageObjectContentSchema,
});

export const StorageObjectSchemaStandardV1 = S.toStandardSchemaV1(StorageObjectSchema);

export type StorageObject = S.Schema.Type<typeof StorageObjectSchema>;
