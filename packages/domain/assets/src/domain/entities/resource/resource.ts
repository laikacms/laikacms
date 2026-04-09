import { FolderSchema } from '@laikacms/storage';
import * as S from 'effect/Schema';
import { AssetSchema } from '../asset/asset.js';

/**
 * Resource is the union type for the assets abstraction.
 * It represents either an Asset (binary file) or a Folder.
 *
 * This is analogous to:
 * - Atom (StorageObject | Folder) in the storage abstraction
 * - Record (Document | Unpublished | Folder) in the documents abstraction
 */
export const ResourceSchema = S.Union([
  AssetSchema,
  FolderSchema,
]);

export type Resource = S.Schema.Type<typeof ResourceSchema>;
