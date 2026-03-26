import { z } from 'zod';
import { folderZ } from '@laikacms/storage';
import { assetZ } from '../asset/asset.js';

/**
 * Resource is the union type for the assets abstraction.
 * It represents either an Asset (binary file) or a Folder.
 *
 * This is analogous to:
 * - Atom (StorageObject | Folder) in the storage abstraction
 * - Record (Document | Unpublished | Folder) in the documents abstraction
 */
export const resourceZ = z.discriminatedUnion('type', [
  assetZ,
  folderZ,
]);

export type Resource = z.infer<typeof resourceZ>;
