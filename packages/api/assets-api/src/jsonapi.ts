import { z } from 'zod';
import {
  type Asset,
  type AssetCreate,
  type AssetUpdate,
  type AssetVariations,
  type AssetUrl,
  type AssetMetadata,
  type Resource,
  assetZ,
  assetVariationsZ,
  assetUrlZ,
  assetMetadataZ,
  assetCreateZ,
  assetUpdateZ,
} from '@laikacms/assets';
import { Folder, FolderCreate, folderCreateZ, folderZ } from '@laikacms/storage';
import { fromJsonApi, toJsonApi } from '@laikacms/json-api';

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
// Asset to JSON:API Transformers
// ============================================

/**
 * Transform Asset to JSON:API resource
 * Includes relationships to asset-metadata, asset-url, asset-variation
 * The relationships only contain type and id (where id = asset key)
 */

const assetToJsonApiInternal = toJsonApi(assetZ, 'asset', 'key');

export const assetToJsonApi = assetZ.transform((asset: Asset): JsonApiResource => {
  return {
    ...assetToJsonApiInternal.parse(asset),
    relationships: {
      metadata: {
        data: { type: 'asset-metadata', id: asset.key },
      },
      urls: {
        data: { type: 'asset-url', id: asset.key },
      },
      variations: {
        data: { type: 'asset-variation', id: asset.key },
      },
    },
  };
});

export const folderToJsonApi = toJsonApi(folderZ, 'folder', 'key');

export const resourceToJsonApi = z.union([assetToJsonApi, folderToJsonApi]);

export const assetVariationsToJsonApi = toJsonApi(assetVariationsZ, 'asset-variation', 'key');

export const assetUrlToJsonApi = toJsonApi(assetUrlZ, 'asset-url', 'key');

export const assetMetadataToJsonApi = toJsonApi(assetMetadataZ, 'asset-metadata', 'key');

export const assetCreateWithContentZ = assetCreateZ.extend({
  content: z.base64(),
});

export const assetCreateFromJsonApiZ = fromJsonApi(assetCreateZ, 'asset', 'key');

export const assetUpdateFromJsonApiZ = fromJsonApi(assetUpdateZ, 'asset', 'key');

export const folderCreateFromJsonApiZ = fromJsonApi(folderCreateZ, 'folder', 'key');

export type IncludeType = 'asset-metadata' | 'asset-url' | 'asset-variation';

/**
 * Parse the ?include= query parameter into FetchHints
 */
export function parseIncludeQuery(includeParam: string | undefined): {
  metadata: boolean;
  urls: boolean;
  variations: boolean;
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
