import {
  type Asset,
  type AssetCreate,
  type AssetMetadata,
  type AssetUpdate,
  type AssetUrl,
  type AssetVariations,
} from '@laikacms/assets';
import { type Folder, type FolderCreate } from '@laikacms/storage';

// ============================================
// JSON:API Resource Types
// ============================================

export interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, string>;
}

export interface JsonApiResponse {
  data: JsonApiResource;
  included?: JsonApiResource[];
  links?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export interface JsonApiCollectionResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
  links?: Record<string, string | null>;
  meta?: Record<string, unknown>;
}

// ============================================
// JSON:API Type Definitions
// ============================================

export interface JsonApiAsset {
  type: 'asset';
  id: string;
  attributes: Omit<Asset, 'key'>;
  relationships?: {
    metadata?: { data: { type: 'asset-metadata', id: string } },
    urls?: { data: { type: 'asset-url', id: string } },
    variations?: { data: { type: 'asset-variation', id: string } },
  };
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

export interface JsonApiAssetVariations {
  type: 'asset-variation';
  id: string;
  attributes: Omit<AssetVariations, 'key'>;
}

export interface JsonApiAssetUrl {
  type: 'asset-url';
  id: string;
  attributes: Omit<AssetUrl, 'key'>;
}

export interface JsonApiAssetMetadata {
  type: 'asset-metadata';
  id: string;
  attributes: Omit<AssetMetadata, 'key'>;
}

// ============================================
// Asset to JSON:API Converters
// ============================================

export function assetToJsonApi(asset: Asset): JsonApiAsset {
  const { key, ...attributes } = asset;
  return {
    type: 'asset',
    id: key,
    attributes,
    relationships: {
      metadata: { data: { type: 'asset-metadata', id: key } },
      urls: { data: { type: 'asset-url', id: key } },
      variations: { data: { type: 'asset-variation', id: key } },
    },
  };
}

export function folderToJsonApi(folder: Folder): JsonApiFolder {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function resourceToJsonApi(resource: Asset | Folder): JsonApiAsset | JsonApiFolder {
  if (resource.type === 'asset') {
    return assetToJsonApi(resource);
  }
  return folderToJsonApi(resource);
}

export function assetVariationsToJsonApi(variations: AssetVariations): JsonApiAssetVariations {
  const { key, ...attributes } = variations;
  return { type: 'asset-variation', id: key, attributes };
}

export function assetUrlToJsonApi(url: AssetUrl): JsonApiAssetUrl {
  const { key, ...attributes } = url;
  return { type: 'asset-url', id: key, attributes };
}

export function assetMetadataToJsonApi(metadata: AssetMetadata): JsonApiAssetMetadata {
  const { key, ...attributes } = metadata;
  return { type: 'asset-metadata', id: key, attributes };
}

// ============================================
// JSON:API to Domain Converters
// ============================================

export function assetCreateFromJsonApi(jsonApi: JsonApiAssetCreate): AssetCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetCreate;
}

export function assetUpdateFromJsonApi(jsonApi: JsonApiAssetUpdate): AssetUpdate {
  return { key: jsonApi.id, ...jsonApi.attributes } as AssetUpdate;
}

export function folderCreateFromJsonApi(jsonApi: JsonApiFolderCreate): FolderCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as FolderCreate;
}

export function folderFromJsonApi(jsonApi: JsonApiFolder): Folder {
  return { key: jsonApi.id, ...jsonApi.attributes } as Folder;
}

// ============================================
// Query Parsing
// ============================================

export type IncludeType = 'asset-metadata' | 'asset-url' | 'asset-variation';

/**
 * Parse the ?include= query parameter into FetchHints
 */
export function parseIncludeQuery(includeParam: string | undefined): {
  metadata: boolean,
  urls: boolean,
  variations: boolean,
} {
  if (!includeParam) {
    return { metadata: false, urls: false, variations: false };
  }

  const includes = includeParam.split(',').map(s => s.trim().toLowerCase());

  return {
    metadata: includes.includes('asset-metadata'),
    urls: includes.includes('asset-url'),
    variations: includes.includes('asset-variation'),
  };
}

export interface PaginationQuery {
  limit?: number;
  cursor?: string;
  direction?: 'forward' | 'backward';
}

export function parsePaginationQuery(query: Record<string, string | undefined>): PaginationQuery {
  return {
    limit: query['page[limit]'] ? parseInt(query['page[limit]'], 10) : undefined,
    cursor: query['page[cursor]'],
    direction: query['page[direction]'] === 'backward' ? 'backward' : 'forward',
  };
}

export function buildPaginationLinks(
  baseUrl: string,
  pagination: PaginationQuery,
  hasMore: boolean,
  nextCursor?: string,
  prevCursor?: string,
): Record<string, string | null> {
  const url = new URL(baseUrl);
  const links: Record<string, string | null> = {
    self: baseUrl,
    first: null,
    last: null,
    prev: null,
    next: null,
  };

  // First link (no cursor)
  const firstUrl = new URL(url);
  firstUrl.searchParams.delete('page[cursor]');
  if (pagination.limit) {
    firstUrl.searchParams.set('page[limit]', String(pagination.limit));
  }
  links.first = firstUrl.toString();

  // Next link
  if (hasMore && nextCursor) {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set('page[cursor]', nextCursor);
    if (pagination.limit) {
      nextUrl.searchParams.set('page[limit]', String(pagination.limit));
    }
    links.next = nextUrl.toString();
  }

  // Prev link
  if (prevCursor) {
    const prevUrl = new URL(url);
    prevUrl.searchParams.set('page[cursor]', prevCursor);
    prevUrl.searchParams.set('page[direction]', 'backward');
    if (pagination.limit) {
      prevUrl.searchParams.set('page[limit]', String(pagination.limit));
    }
    links.prev = prevUrl.toString();
  }

  return links;
}
