import * as S from 'effect/Schema';
import { FolderSummarySchema } from '../folder/folder-summary.js';
import { StorageObjectSummarySchema } from '../object/storage-object-summary.js';

export const AtomSummarySchema = S.Union([
  StorageObjectSummarySchema,
  FolderSummarySchema,
]);

export type AtomSummary = S.Schema.Type<typeof AtomSummarySchema>;
