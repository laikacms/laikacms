// Document entities
export * from './document/index.js';
export * from './unpublished/index.js';
export * from './revision/index.js';
export * from './record/index.js';

// Re-export folder schemas and types from storage
export {
  FolderCreateSchema,
  FolderSummarySchema,
  FolderSchema,
  type Folder,
  type FolderCreate,
  type FolderSummary,
} from '@laikacms/storage';
