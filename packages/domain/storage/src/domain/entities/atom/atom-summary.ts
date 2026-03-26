import { z } from 'zod';
import { storageObjectSummaryZ } from '../object/storage-object-summary.js';
import { folderSummaryZ } from '../folder/folder-summary.js';

export const atomSummaryZ = z.discriminatedUnion('type', [
  storageObjectSummaryZ,
  folderSummaryZ,
])

export type AtomSummary = z.infer<typeof atomSummaryZ>