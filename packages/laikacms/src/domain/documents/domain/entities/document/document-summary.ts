import * as S from 'effect/Schema';
import { AtomBaseSchema } from 'laikacms/storage';
import { DocumentLanguage } from '../record/record-language.js';

export const DocumentSummarySchema = S.toStandardSchemaV1(S.Struct({
  ...AtomBaseSchema.fields,
  type: S.Literal('published-summary'),
  language: DocumentLanguage,
  status: S.Literal('published'),

  /**
   * Opaque per-record version token: changes if and only if the record's
   * content changed, and is comparable only by equality. A git blob or commit
   * sha, a database row version, and an R2 ETag are all valid
   * implementations. Optional so repositories without version tracking stay
   * valid; see `DocumentsCapabilities.versionTracking`.
   */
  version: S.optional(S.String),
}));

export type DocumentSummary = S.Schema.Type<typeof DocumentSummarySchema>;
