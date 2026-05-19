import * as S from 'effect/Schema';
import { StorageObjectMetadataSchema } from './storage-object-metadata.js';
import { StorageObjectContentSchema } from './storage-object.js';

export const StorageObjectUpdateSchema = S.toStandardSchemaV1(S.Struct({
  key: S.String.pipe(S.check(S.isMaxLength(1023))),
  type: S.optional(S.Literal('object')),
  content: S.optional(StorageObjectContentSchema),
  /**
   * Optional capability-driven metadata hints. May carry a `revisionId` from a prior
   * read for optimistic concurrency on backends that support it.
   */
  metadata: S.optional(StorageObjectMetadataSchema),
}));

export type StorageObjectUpdate = S.Schema.Type<typeof StorageObjectUpdateSchema>;
