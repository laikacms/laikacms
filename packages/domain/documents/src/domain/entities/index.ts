// Document entities
export * from './document/index.js';
export * from './unpublished/index.js';
export * from './revision/index.js';
export * from './record/index.js';

import { folderCreateZ, folderSummaryZ, folderZ } from '@laikacms/storage';
import type { Folder, FolderCreate, FolderSummary } from '@laikacms/storage';

export {
  folderCreateZ,
  folderSummaryZ,
  folderZ,
}

export type {
  Folder,
  FolderCreate,
  FolderSummary,
}
