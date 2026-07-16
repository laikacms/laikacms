import * as S from 'effect/Schema';
import { AtomBaseSchema, StorageObjectContentSchema } from 'laikacms/storage';
import { DocumentLanguage } from '../record/record-language.js';

/**
 * Unpublished document entity
 *
 * This is a unified type that replaces the separate draft, archive, and trash types.
 * The status field determines the current state of the unpublished document.
 * Documents are stored in .contentbase/[collection]/[status]/ directories.
 */
export const UnpublishedSchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('unpublished'),
  /**
   * The status of the unpublished document.
   * This maps to the unpublishedStatuses configuration in collection settings.
   * Common values: 'draft', 'pending_review', 'pending_publish', 'archived', 'trash'
   */
  status: S.String,
  language: DocumentLanguage,
  content: StorageObjectContentSchema,

  /**
   * Opaque per-record version token: changes if and only if the record's
   * content changed, and is comparable only by equality. A git blob or commit
   * sha, a database row version, and an R2 ETag are all valid
   * implementations. Optional so repositories without version tracking stay
   * valid; see `DocumentsCapabilities.versionTracking`.
   */
  version: S.optional(S.String),
}));

export type Unpublished = S.Schema.Type<typeof UnpublishedSchema>;
