import * as S from 'effect/Schema';
import { StorageObjectMetadataSchema } from './storage-object-metadata.js';
import { StorageObjectContentSchema } from './storage-object.js';

export const StorageObjectCreateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.Literal('object'),
  content: StorageObjectContentSchema,
  /**
   * Optional capability-driven metadata hints. Read by the storage's
   * `determineExtension` callback to decide the on-disk format.
   */
  metadata: S.optional(StorageObjectMetadataSchema),
}));

export type StorageObjectCreate = S.Schema.Type<typeof StorageObjectCreateSchema>;
