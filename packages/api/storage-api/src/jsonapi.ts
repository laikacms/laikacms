import {
  StorageObjectUpdate,
  StorageObject,
  FolderCreate,
  Folder,
  StorageObjectCreate,
  StorageObjectSummary,
  FolderSummary,
} from '@laikacms/storage';

// Re-export common JSON:API utilities
export {
  jsonApiDeleteZ,
  jsonApiDeleteMultipleZ,
  atomicOperationZ,
  atomicOperationsRequestZ,
  atomicOperationsResponseZ,
  jsonApiLinksZ,
  cursorPaginationMetaZ,
  jsonApiCollectionResponseZ,
  jsonApiErrorZ,
  parsePaginationQuery,
  buildPaginationLinks,
  type JsonApiError,
  type AtomicOperation,
  type AtomicOperationsRequest,
  type AtomicOperationsResponse,
  type JsonApiLinks,
  type CursorPaginationMeta,
  type JsonApiCollectionResponse,
  type JsonApiResource,
} from '@laikacms/json-api';

// JSON:API resource types
export interface JsonApiStorageObject {
  type: 'object';
  id: string;
  attributes: Omit<StorageObject, 'key'>;
}

export interface JsonApiStorageObjectCreate {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectCreate, 'key'>;
}

export interface JsonApiStorageObjectUpdate {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectUpdate, 'key'>;
}

export interface JsonApiFolder {
  type: 'folder';
  id: string;
  attributes: Omit<Folder, 'key'>;
}

export interface JsonApiFolderCreate {
  type: 'folder';
  id: string;
  attributes: Omit<FolderCreate, 'key'>;
}

export interface JsonApiStorageObjectSummary {
  type: 'object-summary';
  id: string;
  attributes: Omit<StorageObjectSummary, 'key'>;
}

export interface JsonApiFolderSummary {
  type: 'folder-summary';
  id: string;
  attributes: Omit<FolderSummary, 'key'>;
}

// To JSON:API converters
export function storageObjectToJsonApi(obj: StorageObject): JsonApiStorageObject {
  const { key, ...attributes } = obj;
  return { type: 'object', id: key, attributes };
}

export function storageObjectCreateToJsonApi(obj: StorageObjectCreate): JsonApiStorageObjectCreate {
  const { key, ...attributes } = obj;
  return { type: 'object', id: key, attributes };
}

export function storageObjectUpdateToJsonApi(obj: StorageObjectUpdate): JsonApiStorageObjectUpdate {
  const { key, ...attributes } = obj;
  return { type: 'object', id: key, attributes };
}

export function folderToJsonApi(folder: Folder): JsonApiFolder {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function folderCreateToJsonApi(folder: FolderCreate): JsonApiFolderCreate {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function storageObjectSummaryToJsonApi(obj: StorageObjectSummary): JsonApiStorageObjectSummary {
  const { key, ...attributes } = obj;
  return { type: 'object-summary', id: key, attributes };
}

export function folderSummaryToJsonApi(folder: FolderSummary): JsonApiFolderSummary {
  const { key, ...attributes } = folder;
  return { type: 'folder-summary', id: key, attributes };
}

// From JSON:API converters
export function storageObjectFromJsonApi(jsonApi: JsonApiStorageObject): StorageObject {
  return { key: jsonApi.id, ...jsonApi.attributes } as StorageObject;
}

export function storageObjectCreateFromJsonApi(jsonApi: JsonApiStorageObjectCreate): StorageObjectCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as StorageObjectCreate;
}

export function storageObjectUpdateFromJsonApi(jsonApi: JsonApiStorageObjectUpdate): StorageObjectUpdate {
  return { key: jsonApi.id, ...jsonApi.attributes } as StorageObjectUpdate;
}

export function folderFromJsonApi(jsonApi: JsonApiFolder): Folder {
  return { key: jsonApi.id, ...jsonApi.attributes } as Folder;
}

export function folderCreateFromJsonApi(jsonApi: JsonApiFolderCreate): FolderCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as FolderCreate;
}

export function storageObjectSummaryFromJsonApi(jsonApi: JsonApiStorageObjectSummary): StorageObjectSummary {
  return { key: jsonApi.id, ...jsonApi.attributes } as StorageObjectSummary;
}

export function folderSummaryFromJsonApi(jsonApi: JsonApiFolderSummary): FolderSummary {
  return { key: jsonApi.id, ...jsonApi.attributes } as FolderSummary;
}

// Union types for atoms
export type JsonApiAtom = JsonApiStorageObject | JsonApiFolder;
export type JsonApiAtomCreate = JsonApiStorageObjectCreate | JsonApiFolderCreate;
export type JsonApiAtomSummary = JsonApiStorageObjectSummary | JsonApiFolderSummary;

export function atomToJsonApi(atom: StorageObject | Folder): JsonApiAtom {
  if (atom.type === 'object') {
    return storageObjectToJsonApi(atom);
  }
  return folderToJsonApi(atom);
}

export function atomSummaryToJsonApi(atom: StorageObjectSummary | FolderSummary): JsonApiAtomSummary {
  if (atom.type === 'object-summary') {
    return storageObjectSummaryToJsonApi(atom);
  }
  return folderSummaryToJsonApi(atom);
}
