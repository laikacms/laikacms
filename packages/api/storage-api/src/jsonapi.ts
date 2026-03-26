import {
  storageObjectUpdateZ,
  storageObjectZ,
  folderCreateZ,
  folderZ,
  storageObjectCreateZ,
  storageObjectSummaryZ,
  folderSummaryZ,
} from '@laikacms/storage';
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

// Storage-specific JSON:API transformers

// From JSON:API to domain
export const storageObjectCreateFromJsonApiZ = fromJsonApi(storageObjectCreateZ, 'object', 'key');
export const storageObjectUpdateFromJsonApiZ = fromJsonApi(storageObjectUpdateZ, 'object', 'key');
export const storageObjectFromJsonApiZ = fromJsonApi(storageObjectZ, 'object', 'key');
export const folderCreateFromJsonApiZ = fromJsonApi(folderCreateZ, 'folder', 'key');
export const folderFromJsonApiZ = fromJsonApi(folderZ, 'folder', 'key');

// To JSON:API from domain
export const storageObjectCreateToJsonApiZ = toJsonApi(storageObjectCreateZ, 'object', 'key');
export const storageObjectUpdateToJsonApiZ = toJsonApi(storageObjectUpdateZ, 'object', 'key');
export const storageObjectToJsonApiZ = toJsonApi(storageObjectZ, 'object', 'key');
export const folderCreateToJsonApiZ = toJsonApi(folderCreateZ, 'folder', 'key');
export const folderToJsonApiZ = toJsonApi(folderZ, 'folder', 'key');

export const atomCreateFromJsonApiZ = z.union([storageObjectCreateFromJsonApiZ, folderCreateFromJsonApiZ]);
export const atomUpdateFromJsonApiZ = z.union([storageObjectUpdateFromJsonApiZ]);
export const atomFromJsonApiZ = z.union([storageObjectFromJsonApiZ, folderFromJsonApiZ]);
export const atomToJsonApiZ = z.union([storageObjectToJsonApiZ, folderToJsonApiZ]);

export const storageObjectSummaryToJsonApiZ = toJsonApi(storageObjectSummaryZ, 'object-summary', 'key');
export const folderSummaryToJsonApiZ = toJsonApi(folderSummaryZ, 'folder-summary', 'key');
export const storageObjectSummaryFromJsonApiZ = fromJsonApi(storageObjectSummaryZ, 'object-summary', 'key').transform(data => ({ ...data, type: 'object-summary' as const }));
export const folderSummaryFromJsonApiZ = fromJsonApi(folderSummaryZ, 'folder-summary', 'key').transform(data => ({ ...data, type: 'folder-summary' as const }));

export const atomSummaryToJsonApiZ = z.union([storageObjectSummaryToJsonApiZ, folderSummaryToJsonApiZ]);
export const atomSummaryFromJsonApiZ = z.union([storageObjectSummaryFromJsonApiZ, folderSummaryFromJsonApiZ]);
