import * as S from 'effect/Schema';
import { StorageObjectSummarySchema } from '../object/storage-object-summary.js';
import { FolderSummarySchema } from '../folder/folder-summary.js';

export const AtomSummarySchema = S.Union([
  StorageObjectSummarySchema,
  FolderSummarySchema,
]);

export type AtomSummary = S.Schema.Type<typeof AtomSummarySchema>;
