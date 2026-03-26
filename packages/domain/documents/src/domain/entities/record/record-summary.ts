import { folderSummaryZ } from "@laikacms/storage";
import { z } from "zod";
import { documentSummaryZ } from "../document/document-summary.js";
import { revisionSummaryZ } from "../revision/revision-summary.js";
import { unpublishedSummaryZ } from "../unpublished/unpublished-summary.js";

/**
 * Record summary union type
 *
 * Includes:
 * - document: Published content
 * - unpublished: Unpublished content with various statuses (draft, pending_review, archived, trash, etc.)
 * - folder: Directory entries
 */
export const RecordSummaryZ = z.discriminatedUnion('type', [
  documentSummaryZ,
  unpublishedSummaryZ,
  folderSummaryZ
]);

export type RecordSummary = z.infer<typeof RecordSummaryZ>;

