import * as S from 'effect/Schema'
import { storageObjectSummaryZ } from '../object/storage-object-summary.js';
import { folderSummaryZ } from '../folder/folder-summary.js';

export const AtomSummarySchema = S.Union([
  storageObjectSummaryZ,
  folderSummaryZ,
])

export type AtomSummary = S.Schema.Type<typeof AtomSummarySchema>
