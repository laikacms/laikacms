import { z } from 'zod';
import { documentZ } from '../document/document.js';
import { unpublishedZ } from '../unpublished/unpublished.js';
import { revisionZ } from '../revision/revision.js';
import { folderZ } from '@laikacms/storage';

export const recordZ = z.discriminatedUnion('type', [
  documentZ,
  unpublishedZ,
  folderZ
]);

export type Record = z.infer<typeof recordZ>;
