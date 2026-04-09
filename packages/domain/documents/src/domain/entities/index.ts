// Document entities
export * from './document/index.js';
export * from './record/index.js';
export * from './revision/index.js';
export * from './unpublished/index.js';

// Re-export folder schemas and types from storage
export {
  type Folder,
  type FolderCreate,
  FolderCreateSchema,
  FolderSchema,
  type FolderSummary,
  FolderSummarySchema,
} from '@laikacms/storage';
