
import { assetCreateZ, assetMetadataZ, assetUpdateZ, assetUrlZ, assetVariationsZ, assetZ } from '@laikacms/assets';
import {
  toJsonApi,
  fromJsonApi,
} from '@laikacms/json-api';
import z from 'zod';
import { folderCreateZ, folderSummaryZ, folderZ } from '@laikacms/storage';

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

export const assetCreateFromJsonApiZ = fromJsonApi(assetCreateZ, 'asset', 'key');
export const assetUpdateFromJsonApiZ = fromJsonApi(assetUpdateZ, 'asset', 'key');
export const assetFromJsonApi = fromJsonApi(assetZ, 'asset', 'key');
export const folderCreateFromJsonApiZ = fromJsonApi(folderCreateZ, 'folder', 'key');
export const folderFromJsonApiZ = fromJsonApi(folderZ, 'folder', 'key');

export const assetCreateToJsonApiZ = toJsonApi(assetCreateZ, 'asset', 'key');
export const assetUpdateToJsonApiZ = toJsonApi(assetUpdateZ, 'asset', 'key');
export const assetToJsonApiZ = toJsonApi(assetZ, 'asset', 'key');
export const folderCreateToJsonApiZ = toJsonApi(folderCreateZ, 'folder', 'key');
export const folderToJsonApiZ = toJsonApi(folderZ, 'folder', 'key');

export const resourceCreateFromJsonApiZ = z.union([assetCreateFromJsonApiZ, folderCreateFromJsonApiZ]);
export const resourceUpdateFromJsonApiZ = z.union([assetUpdateFromJsonApiZ]);
export const resourceFromJsonApiZ = z.union([assetFromJsonApi, folderFromJsonApiZ]);
export const resourceToJsonApiZ = z.union([assetToJsonApiZ, folderToJsonApiZ]);

export const assetMetadataFromJsonApiZ = fromJsonApi(assetMetadataZ, 'asset-metadata', 'key');
export const assetMetadataToJsonApiZ = toJsonApi(assetMetadataZ, 'asset-metadata', 'key');

export const assetUrlFromJsonApiZ = fromJsonApi(assetUrlZ, 'asset-url', 'key');
export const assetUrlToJsonApiZ = toJsonApi(assetUrlZ, 'asset-url', 'key');

export const assetVariantsFromJsonApiZ = fromJsonApi(assetVariationsZ, 'asset-variants', 'key');
export const assetVariantsToJsonApiZ = toJsonApi(assetVariationsZ, 'asset-variants', 'key');

export const folderSummaryToJsonApiZ = toJsonApi(folderSummaryZ, 'folder-summary', 'key');
export const folderSummaryFromJsonApiZ = fromJsonApi(folderSummaryZ, 'folder-summary', 'key').transform(data => ({ ...data, type: 'folder-summary' as const }));

export const includedFromJsonApiZ = z.union([
  assetMetadataFromJsonApiZ,
  assetUrlFromJsonApiZ,
  assetVariantsFromJsonApiZ,
]);

export const icludedToJsonApiZ = z.union([
  assetMetadataToJsonApiZ,
  assetUrlToJsonApiZ,
  assetVariantsToJsonApiZ,
]);