import { FolderSummarySchema } from "@laikacms/storage";
import * as S from 'effect/Schema';
import { DocumentSummarySchema } from "../document/document-summary.js";
import { UnpublishedSummarySchema } from "../unpublished/unpublished-summary.js";

/**
 * Record summary union type
 *
 * Includes:
 * - document: Published content
 * - unpublished: Unpublished content with various statuses (draft, pending_review, archived, trash, etc.)
 * - folder: Directory entries
 */
export const RecordSummarySchema = S.Union([
  DocumentSummarySchema,
  UnpublishedSummarySchema,
  FolderSummarySchema,
]);

export type RecordSummary = S.Schema.Type<typeof RecordSummarySchema>;
