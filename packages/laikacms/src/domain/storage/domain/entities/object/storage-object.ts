import * as S from 'effect/Schema';
import { AtomBaseSchema } from '../atom/atom-base.js';
import { StorageObjectMetadataSchema } from './storage-object-metadata.js';

export const StorageObjectContentSchema = S.Record(S.String, S.Any);

export type StorageObjectContent = S.Schema.Type<typeof StorageObjectContentSchema>;

export const StorageObjectSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('object'),
  content: StorageObjectContentSchema,
  metadata: S.optional(StorageObjectMetadataSchema),
}));

export type StorageObject = S.Schema.Type<typeof StorageObjectSchema>;
