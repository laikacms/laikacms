import {
  type Asset,
  type AssetCreate,
  type AssetUpdate,
  type AssetMetadata,
  type AssetUrl,
  type AssetVariations,
} from '@laikacms/assets';
import {
  type Folder,
  type FolderCreate,
  type FolderSummary,
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

// ============================================
// JSON:API Type Definitions
// ============================================

export interface JsonApiAsset {
  type: 'asset';
  id: string;
  attributes: Omit<Asset, 'key'>;
}

export interface JsonApiAssetCreate {
  type: 'asset';
  id: string;
  attributes: Omit<AssetCreate, 'key'>;
}

export interface JsonApiAssetUpdate {
  type: 'asset';
  id: string;
  attributes: Omit<AssetUpdate, 'key'>;
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

export interface JsonApiFolderSummary {
  type: 'folder-summary';
  id: string;
  attributes: Omit<FolderSummary, 'key'>;
}

export interface JsonApiAssetMetadata {
  type: 'asset-metadata';
  id: string;
  attributes: Omit<AssetMetadata, 'key'>;
}

export interface JsonApiAssetUrl {
  type: 'asset-url';
  id: string;
  attributes: Omit<AssetUrl, 'key'>;
}

export interface JsonApiAssetVariations {
  type: 'asset-variants';
  id: string;
  attributes: Omit<AssetVariations, 'key'>;
}

// ============================================
// To JSON:API Converters
// ============================================

export function assetToJsonApi(asset: Asset): JsonApiAsset {
  const { key, ...attributes } = asset;
  return { type: 'asset', id: key, attributes };
}

export function assetCreateToJsonApi(asset: AssetCreate): JsonApiAssetCreate {
  const { key, ...attributes } = asset;
  return { type: 'asset', id: key, attributes };
}

export function assetUpdateToJsonApi(asset: AssetUpdate): JsonApiAssetUpdate {
  const { key, ...attributes } = asset;
  return { type: 'asset', id: key, attributes };
}

export function folderToJsonApi(folder: Folder): JsonApiFolder {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function folderCreateToJsonApi(folder: FolderCreate): JsonApiFolderCreate {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function folderSummaryToJsonApi(folder: FolderSummary): JsonApiFolderSummary {
  const { key, ...attributes } = folder;
  return { type: 'folder-summary', id: key, attributes };
}

export function assetMetadataToJsonApi(metadata: AssetMetadata): JsonApiAssetMetadata {
  const { key, ...attributes } = metadata;
  return { type: 'asset-metadata', id: key, attributes };
}

export function assetUrlToJsonApi(url: AssetUrl): JsonApiAssetUrl {
  const { key, ...attributes } = url;
  return { type: 'asset-url', id: key, attributes };
}

export function assetVariationsToJsonApi(variations: AssetVariations): JsonApiAssetVariations {
  const { key, ...attributes } = variations;
  return { type: 'asset-variants', id: key, attributes };
}

export function resourceToJsonApi(resource: Asset | Folder): JsonApiAsset | JsonApiFolder {
  if (resource.type === 'asset') {
    return assetToJsonApi(resource);
  }
  return folderToJsonApi(resource);
}

// ============================================
// From JSON:API Converters
// ============================================

export function assetFromJsonApi(jsonApi: JsonApiAsset): Asset {
  return { key: jsonApi.id, ...jsonApi.attributes } as Asset;
}

export function assetCreateFromJsonApi(jsonApi: JsonApiAssetCreate): AssetCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetCreate;
}

export function assetUpdateFromJsonApi(jsonApi: JsonApiAssetUpdate): AssetUpdate {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetUpdate;
}

export function folderFromJsonApi(jsonApi: JsonApiFolder): Folder {
  return { key: jsonApi.id, ...jsonApi.attributes } as Folder;
}

export function folderCreateFromJsonApi(jsonApi: JsonApiFolderCreate): FolderCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as FolderCreate;
}

export function folderSummaryFromJsonApi(jsonApi: JsonApiFolderSummary): FolderSummary {
  const { type: _type, ...rest } = jsonApi.attributes;
  return { key: jsonApi.id, type: 'folder-summary', ...rest } as FolderSummary;
}

export function assetMetadataFromJsonApi(jsonApi: JsonApiAssetMetadata): AssetMetadata {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetMetadata;
}

export function assetUrlFromJsonApi(jsonApi: JsonApiAssetUrl): AssetUrl {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetUrl;
}

export function assetVariationsFromJsonApi(jsonApi: JsonApiAssetVariations): AssetVariations {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetVariations;
}

export function resourceFromJsonApi(jsonApi: JsonApiAsset | JsonApiFolder): Asset | Folder {
  if (jsonApi.type === 'asset') {
    return assetFromJsonApi(jsonApi);
  }
  return folderFromJsonApi(jsonApi);
}

export function includedFromJsonApi(jsonApi: JsonApiAssetMetadata | JsonApiAssetUrl | JsonApiAssetVariations): AssetMetadata | AssetUrl | AssetVariations {
  if (jsonApi.type === 'asset-metadata') {
    return assetMetadataFromJsonApi(jsonApi);
  }
  if (jsonApi.type === 'asset-url') {
    return assetUrlFromJsonApi(jsonApi);
  }
  return assetVariationsFromJsonApi(jsonApi);
}

export function includedToJsonApi(included: AssetMetadata | AssetUrl | AssetVariations): JsonApiAssetMetadata | JsonApiAssetUrl | JsonApiAssetVariations {
  if ('mimeType' in included && 'size' in included) {
    return assetMetadataToJsonApi(included as AssetMetadata);
  }
  if ('url' in included) {
    return assetUrlToJsonApi(included as AssetUrl);
  }
  return assetVariationsToJsonApi(included as AssetVariations);
}

// ============================================
// Type Guards
// ============================================

export function isJsonApiAsset(jsonApi: { type: string; id: string; attributes?: Record<string, unknown> }): jsonApi is JsonApiAsset {
  return jsonApi.type === 'asset';
}

export function isJsonApiFolder(jsonApi: { type: string; id: string; attributes?: Record<string, unknown> }): jsonApi is JsonApiFolder {
  return jsonApi.type === 'folder';
}

export function isJsonApiAssetMetadata(jsonApi: { type: string; id: string; attributes?: Record<string, unknown> }): jsonApi is JsonApiAssetMetadata {
  return jsonApi.type === 'asset-metadata';
}

export function isJsonApiAssetUrl(jsonApi: { type: string; id: string; attributes?: Record<string, unknown> }): jsonApi is JsonApiAssetUrl {
  return jsonApi.type === 'asset-url';
}

export function isJsonApiAssetVariations(jsonApi: { type: string; id: string; attributes?: Record<string, unknown> }): jsonApi is JsonApiAssetVariations {
  return jsonApi.type === 'asset-variants';
}

// ============================================
// Generic Converters (accept any JSON:API resource shape)
// ============================================

interface GenericJsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
}

/**
 * Parse a generic JSON:API resource into a domain Asset or Folder
 */
export function parseResource(jsonApi: GenericJsonApiResource): Asset | Folder {
  if (jsonApi.type === 'asset') {
    return { key: jsonApi.id, type: 'asset', ...jsonApi.attributes } as Asset;
  }
  return { key: jsonApi.id, type: 'folder', ...jsonApi.attributes } as Folder;
}

/**
 * Parse a generic JSON:API resource into a domain Asset
 */
export function parseAsset(jsonApi: GenericJsonApiResource): Asset {
  return { key: jsonApi.id, type: 'asset', ...jsonApi.attributes } as Asset;
}

/**
 * Parse a generic JSON:API resource into a domain Folder
 */
export function parseFolder(jsonApi: GenericJsonApiResource): Folder {
  return { key: jsonApi.id, type: 'folder', ...jsonApi.attributes } as Folder;
}

/**
 * Parse a generic JSON:API resource into AssetMetadata
 */
export function parseAssetMetadata(jsonApi: GenericJsonApiResource): AssetMetadata {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetMetadata;
}

/**
 * Parse a generic JSON:API resource into AssetUrl
 */
export function parseAssetUrl(jsonApi: GenericJsonApiResource): AssetUrl {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetUrl;
}

/**
 * Parse a generic JSON:API resource into AssetVariations
 */
export function parseAssetVariations(jsonApi: GenericJsonApiResource): AssetVariations {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetVariations;
}
