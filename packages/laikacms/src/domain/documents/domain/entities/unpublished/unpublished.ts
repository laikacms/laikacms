import { AtomBaseSchema, StorageObjectContentSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { DocumentLanguage } from '../record/record-language';

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
}));

export type Unpublished = S.Schema.Type<typeof UnpublishedSchema>;
