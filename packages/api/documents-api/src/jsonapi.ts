import {
  StorageObjectUpdateSchema,
  StorageObjectSchema,
  FolderCreateSchema,
  FolderSchema,
  StorageObjectSummarySchema,
  FolderSummarySchema,
  StorageObjectCreateSchema,
  type StorageObject,
  type StorageObjectCreate,
  type StorageObjectUpdate,
  type StorageObjectSummary,
  type Folder,
  type FolderCreate,
  type FolderSummary,
} from '@laikacms/storage';
import {
  DocumentSchema,
  DocumentCreateSchema,
  DocumentUpdateSchema,
  DocumentSummarySchema,
  RevisionSchema,
  RevisionCreateSchema,
  RevisionSummarySchema,
  UnpublishedSchema,
  UnpublishedCreateSchema,
  UnpublishedUpdateSchema,
  UnpublishedSummarySchema,
  type Document,
  type DocumentCreate,
  type DocumentUpdate,
  type DocumentSummary,
  type Revision,
  type RevisionCreate,
  type RevisionSummary,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedUpdate,
  type UnpublishedSummary,
} from '@laikacms/documents'
import {
  toJsonApi,
  fromJsonApi,
  type JsonApiError,
  type JsonApiCollectionResponse,
} from '@laikacms/json-api';

// Re-export common JSON:API utilities
export {
  toJsonApi,
  fromJsonApi,
  type JsonApiError,
  type JsonApiCollectionResponse,
} from '@laikacms/json-api';

// ===== JSON:API RESOURCE TYPES =====

// Storage Object JSON:API types
export interface StorageObjectJsonApi {
  type: 'object';
  id: string;
  attributes: Omit<StorageObject, 'key'>;
}

export interface StorageObjectCreateJsonApi {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectCreate, 'key'>;
}

export interface StorageObjectUpdateJsonApi {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectUpdate, 'key'>;
}

export interface StorageObjectSummaryJsonApi {
  type: 'object-summary';
  id: string;
  attributes: Omit<StorageObjectSummary, 'key'>;
}

// Document JSON:API types
export interface DocumentJsonApi {
  type: 'published';
  id: string;
  attributes: Omit<Document, 'key'>;
}

export interface DocumentCreateJsonApi {
  type: 'published';
  id: string;
  attributes: Omit<DocumentCreate, 'key'>;
}

export interface DocumentUpdateJsonApi {
  type: 'published';
  id: string;
  attributes: Omit<DocumentUpdate, 'key'>;
}

export interface DocumentSummaryJsonApi {
  type: 'published-summary';
  id: string;
  attributes: Omit<DocumentSummary, 'key'>;
}

// Unpublished JSON:API types
export interface UnpublishedJsonApi {
  type: 'unpublished';
  id: string;
  attributes: Omit<Unpublished, 'key'>;
}

export interface UnpublishedCreateJsonApi {
  type: 'unpublished';
  id: string;
  attributes: Omit<UnpublishedCreate, 'key'>;
}

export interface UnpublishedUpdateJsonApi {
  type: 'unpublished';
  id: string;
  attributes: Omit<UnpublishedUpdate, 'key'>;
}

export interface UnpublishedSummaryJsonApi {
  type: 'unpublished-summary';
  id: string;
  attributes: Omit<UnpublishedSummary, 'key'>;
}

// Folder JSON:API types
export interface FolderJsonApi {
  type: 'folder';
  id: string;
  attributes: Omit<Folder, 'key'>;
}

export interface FolderCreateJsonApi {
  type: 'folder';
  id: string;
  attributes: Omit<FolderCreate, 'key'>;
}

export interface FolderSummaryJsonApi {
  type: 'folder-summary';
  id: string;
  attributes: Omit<FolderSummary, 'key'>;
}

// Revision JSON:API types
export interface RevisionJsonApi {
  type: 'revision';
  id: string;
  attributes: Omit<Revision, 'key'>;
}

export interface RevisionCreateJsonApi {
  type: 'revision';
  id: string;
  attributes: Omit<RevisionCreate, 'key'>;
}

export interface RevisionSummaryJsonApi {
  type: 'revision-summary';
  id: string;
  attributes: Omit<RevisionSummary, 'key'>;
}

// ===== TRANSFORMER FUNCTIONS =====

// Storage Object transformers
export const storageObjectToJsonApi = (obj: StorageObject): StorageObjectJsonApi =>
  toJsonApi(obj, 'object', 'key');

export const storageObjectFromJsonApi = (jsonApi: StorageObjectJsonApi): StorageObject =>
  fromJsonApi(jsonApi, 'object', 'key');

export const storageObjectCreateToJsonApi = (obj: StorageObjectCreate): StorageObjectCreateJsonApi =>
  toJsonApi(obj, 'object', 'key');

export const storageObjectUpdateToJsonApi = (obj: StorageObjectUpdate): StorageObjectUpdateJsonApi =>
  toJsonApi(obj, 'object', 'key');

export const storageObjectUpdateFromJsonApi = (jsonApi: StorageObjectUpdateJsonApi): StorageObjectUpdate =>
  fromJsonApi(jsonApi, 'object', 'key');

export const storageObjectSummaryToJsonApi = (obj: StorageObjectSummary): StorageObjectSummaryJsonApi =>
  toJsonApi(obj, 'object-summary', 'key');

export const storageObjectSummaryFromJsonApi = (jsonApi: StorageObjectSummaryJsonApi): StorageObjectSummary =>
  fromJsonApi(jsonApi, 'object-summary', 'key');

// Document transformers
export const documentToJsonApi = (doc: Document): DocumentJsonApi =>
  toJsonApi(doc, 'published', 'key');

export const documentFromJsonApi = (jsonApi: DocumentJsonApi): Document =>
  fromJsonApi(jsonApi, 'published', 'key');

export const documentCreateToJsonApi = (doc: DocumentCreate): DocumentCreateJsonApi =>
  toJsonApi(doc, 'published', 'key');

export const documentCreateFromJsonApi = (jsonApi: DocumentCreateJsonApi): DocumentCreate =>
  fromJsonApi(jsonApi, 'published', 'key');

export const documentUpdateToJsonApi = (doc: DocumentUpdate): DocumentUpdateJsonApi =>
  toJsonApi(doc, 'published', 'key');

export const documentUpdateFromJsonApi = (jsonApi: DocumentUpdateJsonApi): DocumentUpdate =>
  fromJsonApi(jsonApi, 'published', 'key');

export const documentSummaryToJsonApi = (doc: DocumentSummary): DocumentSummaryJsonApi =>
  toJsonApi(doc, 'published-summary', 'key');

export const documentSummaryFromJsonApi = (jsonApi: DocumentSummaryJsonApi): DocumentSummary =>
  fromJsonApi(jsonApi, 'published-summary', 'key');

// Unpublished transformers
export const unpublishedToJsonApi = (doc: Unpublished): UnpublishedJsonApi =>
  toJsonApi(doc, 'unpublished', 'key');

export const unpublishedFromJsonApi = (jsonApi: UnpublishedJsonApi): Unpublished =>
  fromJsonApi(jsonApi, 'unpublished', 'key');

export const unpublishedCreateToJsonApi = (doc: UnpublishedCreate): UnpublishedCreateJsonApi =>
  toJsonApi(doc, 'unpublished', 'key');

export const unpublishedCreateFromJsonApi = (jsonApi: UnpublishedCreateJsonApi): UnpublishedCreate =>
  fromJsonApi(jsonApi, 'unpublished', 'key');

export const unpublishedUpdateToJsonApi = (doc: UnpublishedUpdate): UnpublishedUpdateJsonApi =>
  toJsonApi(doc, 'unpublished', 'key');

export const unpublishedUpdateFromJsonApi = (jsonApi: UnpublishedUpdateJsonApi): UnpublishedUpdate =>
  fromJsonApi(jsonApi, 'unpublished', 'key');

export const unpublishedSummaryToJsonApi = (doc: UnpublishedSummary): UnpublishedSummaryJsonApi =>
  toJsonApi(doc, 'unpublished-summary', 'key');

export const unpublishedSummaryFromJsonApi = (jsonApi: UnpublishedSummaryJsonApi): UnpublishedSummary =>
  fromJsonApi(jsonApi, 'unpublished-summary', 'key');

// Folder transformers
export const folderToJsonApi = (folder: Folder): FolderJsonApi =>
  toJsonApi(folder, 'folder', 'key');

export const folderFromJsonApi = (jsonApi: FolderJsonApi): Folder =>
  fromJsonApi(jsonApi, 'folder', 'key');

export const folderCreateToJsonApi = (folder: FolderCreate): FolderCreateJsonApi =>
  toJsonApi(folder, 'folder', 'key');

export const folderCreateFromJsonApi = (jsonApi: FolderCreateJsonApi): FolderCreate =>
  fromJsonApi(jsonApi, 'folder', 'key');

export const folderSummaryToJsonApi = (folder: FolderSummary): FolderSummaryJsonApi =>
  toJsonApi(folder, 'folder-summary', 'key');

export const folderSummaryFromJsonApi = (jsonApi: FolderSummaryJsonApi): FolderSummary =>
  fromJsonApi(jsonApi, 'folder-summary', 'key');

// Revision transformers
export const revisionToJsonApi = (rev: Revision): RevisionJsonApi =>
  toJsonApi(rev, 'revision', 'key');

export const revisionFromJsonApi = (jsonApi: RevisionJsonApi): Revision =>
  fromJsonApi(jsonApi, 'revision', 'key');

export const revisionCreateToJsonApi = (rev: RevisionCreate): RevisionCreateJsonApi =>
  toJsonApi(rev, 'revision', 'key');

export const revisionCreateFromJsonApi = (jsonApi: RevisionCreateJsonApi): RevisionCreate =>
  fromJsonApi(jsonApi, 'revision', 'key');

export const revisionSummaryToJsonApi = (rev: RevisionSummary): RevisionSummaryJsonApi =>
  toJsonApi(rev, 'revision-summary', 'key');

export const revisionSummaryFromJsonApi = (jsonApi: RevisionSummaryJsonApi): RevisionSummary =>
  fromJsonApi(jsonApi, 'revision-summary', 'key');
