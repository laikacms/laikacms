import {
  storageObjectUpdateZ,
  storageObjectZ,
  folderCreateZ,
  folderZ,
  storageObjectSummaryZ,
  folderSummaryZ,
  storageObjectCreateZ,
} from '@laikacms/storage';
import {
  documentZ,
  documentCreateZ,
  documentUpdateZ,
  documentSummaryZ,
  revisionZ,
  revisionCreateZ,
  revisionSummaryZ,
  unpublishedZ,
  unpublishedCreateZ,
  unpublishedUpdateZ,
  unpublishedSummaryZ,
} from '@laikacms/documents'
import {
  toJsonApi,
  fromJsonApi,
} from '@laikacms/json-api';
import z from 'zod';

// Re-export common JSON:API utilities
export {
  toJsonApi,
  fromJsonApi,
  jsonApiDeleteZ,
  jsonApiDeleteMultipleZ,
  jsonApiErrorZ,
  type JsonApiError,
  type JsonApiCollectionResponse,
} from '@laikacms/json-api';

// ===== STORAGE OBJECTS =====
// From schemas
export const storageObjectUpdateFromJsonApiZ = fromJsonApi(storageObjectUpdateZ, 'object', 'key');
export const storageObjectFromJsonApiZ = fromJsonApi(storageObjectZ, 'object', 'key');
export const storageObjectSummaryFromJsonApiZ = fromJsonApi(storageObjectSummaryZ, 'object-summary', 'key');

// To schemas
export const storageObjectCreateToJsonApiZ = toJsonApi(storageObjectCreateZ, 'object', 'key');
export const storageObjectUpdateToJsonApiZ = toJsonApi(storageObjectUpdateZ, 'object', 'key');
export const storageObjectToJsonApiZ = toJsonApi(storageObjectZ, 'object', 'key');
export const storageObjectSummaryToJsonApiZ = toJsonApi(storageObjectSummaryZ, 'object-summary', 'key');

// ===== DOCUMENTS (PUBLISHED) =====
// From schemas
export const documentFromJsonApiZ = fromJsonApi(documentZ, 'published', 'key');
export const documentCreateFromJsonApiZ = fromJsonApi(documentCreateZ, 'published', 'key');
export const documentUpdateFromJsonApiZ = fromJsonApi(documentUpdateZ, 'published', 'key');
export const documentSummaryFromJsonApiZ = fromJsonApi(documentSummaryZ, 'published-summary', 'key');

// To schemas
export const documentToJsonApiZ = toJsonApi(documentZ, 'published', 'key');
export const documentCreateToJsonApiZ = toJsonApi(documentCreateZ, 'published', 'key');
export const documentUpdateToJsonApiZ = toJsonApi(documentUpdateZ, 'published', 'key');
export const documentSummaryToJsonApiZ = toJsonApi(documentSummaryZ, 'published-summary', 'key');

// ===== UNPUBLISHED =====
// From schemas
export const unpublishedFromJsonApiZ = fromJsonApi(unpublishedZ, 'unpublished', 'key');
export const unpublishedCreateFromJsonApiZ = fromJsonApi(unpublishedCreateZ, 'unpublished', 'key');
export const unpublishedUpdateFromJsonApiZ = fromJsonApi(unpublishedUpdateZ, 'unpublished', 'key');
export const unpublishedSummaryFromJsonApiZ = fromJsonApi(unpublishedSummaryZ, 'unpublished-summary', 'key');

// To schemas
export const unpublishedToJsonApiZ = toJsonApi(unpublishedZ, 'unpublished', 'key');
export const unpublishedCreateToJsonApiZ = toJsonApi(unpublishedCreateZ, 'unpublished', 'key');
export const unpublishedUpdateToJsonApiZ = toJsonApi(unpublishedUpdateZ, 'unpublished', 'key');
export const unpublishedSummaryToJsonApiZ = toJsonApi(unpublishedSummaryZ, 'unpublished-summary', 'key');

// ===== FOLDERS =====
// From schemas
export const folderCreateFromJsonApiZ = fromJsonApi(folderCreateZ, 'folder', 'key');
export const folderFromJsonApiZ = fromJsonApi(folderZ, 'folder', 'key');
export const folderSummaryFromJsonApiZ = fromJsonApi(folderSummaryZ, 'folder-summary', 'key');

// To schemas
export const folderCreateToJsonApiZ = toJsonApi(folderCreateZ, 'folder', 'key');
export const folderToJsonApiZ = toJsonApi(folderZ, 'folder', 'key');
export const folderSummaryToJsonApiZ = toJsonApi(folderSummaryZ, 'folder-summary', 'key');

// ===== REVISIONS =====
// From schemas
export const revisionFromJsonApiZ = fromJsonApi(revisionZ, 'revision', 'key');
export const revisionCreateFromJsonApiZ = fromJsonApi(revisionCreateZ, 'revision', 'key');
export const revisionSummaryFromJsonApiZ = fromJsonApi(revisionSummaryZ, 'revision-summary', 'key');

// To schemas
export const revisionToJsonApiZ = toJsonApi(revisionZ, 'revision', 'key');
export const revisionCreateToJsonApiZ = toJsonApi(revisionCreateZ, 'revision', 'key');
export const revisionSummaryToJsonApiZ = toJsonApi(revisionSummaryZ, 'revision-summary', 'key');

// ===== TYPE EXPORTS =====
export type StorageObjectUpdateJsonApi = z.infer<typeof storageObjectUpdateToJsonApiZ>;
export type StorageObjectJsonApi = z.infer<typeof storageObjectToJsonApiZ>;

export type DocumentJsonApi = z.infer<typeof documentToJsonApiZ>;
export type DocumentCreateJsonApi = z.infer<typeof documentCreateToJsonApiZ>;
export type DocumentSummaryJsonApi = z.infer<typeof documentSummaryToJsonApiZ>;

export type UnpublishedJsonApi = z.infer<typeof unpublishedToJsonApiZ>;
export type UnpublishedCreateJsonApi = z.infer<typeof unpublishedCreateToJsonApiZ>;
export type UnpublishedUpdateJsonApi = z.infer<typeof unpublishedUpdateToJsonApiZ>;
export type UnpublishedSummaryJsonApi = z.infer<typeof unpublishedSummaryToJsonApiZ>;

export type FolderCreateJsonApi = z.infer<typeof folderCreateToJsonApiZ>;
export type FolderJsonApi = z.infer<typeof folderToJsonApiZ>;
export type FolderSummaryJsonApi = z.infer<typeof folderSummaryToJsonApiZ>;
export type RevisionJsonApi = z.infer<typeof revisionToJsonApiZ>;
export type RevisionCreateJsonApi = z.infer<typeof revisionCreateToJsonApiZ>;
export type RevisionSummaryJsonApi = z.infer<typeof revisionSummaryToJsonApiZ>;
