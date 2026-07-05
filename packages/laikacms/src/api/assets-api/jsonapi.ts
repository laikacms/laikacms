import {
  type Asset,
  type AssetCreate,
  type AssetMetadata,
  type AssetUpdate,
  type AssetUrl,
  type AssetVariations,
} from 'laikacms/assets';
import { type Folder, type FolderCreate } from 'laikacms/storage';

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
  /**
   * Intrinsic asset metadata (MIME type, size, dimensions, …) — surfaced via
   * JSON:API resource-level `meta` rather than as a separate related
   * resource. Only present when the caller passed `?include=metadata`.
   *
   * The redundant `AssetMetadata.key` wrapper is dropped here — the asset's
   * own `id` already supplies the key.
   */
  meta?: AssetMetadata['metadata'];
  /**
   * Computed / transient representations of the asset that the caller can
   * `?include=` and read from the top-level `included` array. `metadata` is
   * intentionally *not* listed here — it lives on `meta` above.
   */
  relationships?: {
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

// ============================================
// Asset to JSON:API Converters
// ============================================

/**
 * Build a JSON:API asset resource. Pass `metadata` to inline it on `meta`;
 * pass `hints` to advertise the `urls` / `variations` relationships so the
 * client knows what it could `?include=`.
 */
export function assetToJsonApi(
  asset: Asset,
  options?: {
    metadata?: AssetMetadata['metadata'],
    advertiseRelationships?: { urls?: boolean, variations?: boolean },
  },
): JsonApiAsset {
  const { key, ...attributes } = asset;
  const advertise = options?.advertiseRelationships;
  const relationships = (advertise?.urls || advertise?.variations)
    ? {
      ...(advertise.urls ? { urls: { data: { type: 'asset-url' as const, id: key } } } : {}),
      ...(advertise.variations
        ? { variations: { data: { type: 'asset-variation' as const, id: key } } }
        : {}),
    }
    : undefined;
  const out: JsonApiAsset = { type: 'asset', id: key, attributes };
  if (options?.metadata) out.meta = options.metadata;
  if (relationships) out.relationships = relationships;
  return out;
}

export function folderToJsonApi(folder: Folder): JsonApiFolder {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function resourceToJsonApi(
  resource: Asset | Folder,
  options?: Parameters<typeof assetToJsonApi>[1],
): JsonApiAsset | JsonApiFolder {
  if (resource.type === 'asset') {
    return assetToJsonApi(resource, options);
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

// `assetMetadataToJsonApi` was removed — AssetMetadata is no longer a
// separate JSON:API resource type; its content is folded onto
// `JsonApiAsset.meta` via the `metadata` option on `assetToJsonApi`.

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

/**
 * Accepted values for the `?include=` query parameter.
 *
 * Per the JSON:API spec, `?include=` is strictly for related-resource
 * traversal — values name relationships on the primary resource and the
 * fetched resources arrive under the top-level `included` array. Intrinsic
 * metadata is *not* a relationship, so it's opted into via the separate
 * `?meta=` query parameter (see `parseMetaQuery`).
 *
 * Short canonical names: `urls`, `variations`.
 * Long-form aliases (`asset-url`, `asset-variation`) are also accepted for
 * compatibility with callers following the documented JSON:API type names.
 */
export type IncludeType = 'urls' | 'variations';

/** Parse the `?include=` query parameter into included-relationship flags. */
export function parseIncludeQuery(includeParam: string | undefined): {
  urls: boolean,
  variations: boolean,
} {
  if (!includeParam) return { urls: false, variations: false };
  const includes = includeParam.split(',').map(s => s.trim().toLowerCase());
  return {
    urls: includes.includes('urls') || includes.includes('asset-url'),
    variations: includes.includes('variations') || includes.includes('asset-variation'),
  };
}

/**
 * Parse the `?meta=` query parameter. `?meta=true` (or `1`, `yes`) asks the
 * server to inline the asset's intrinsic metadata onto `data.meta`. Anything
 * else — including absent — opts out so the server can skip the extra
 * backend round-trip.
 *
 * Kept separate from `?include=` per JSON:API: `include` is reserved for
 * relationship traversal.
 */
export function parseMetaQuery(metaParam: string | undefined): { metadata: boolean } {
  if (!metaParam) return { metadata: false };
  const v = metaParam.trim().toLowerCase();
  return { metadata: v === 'true' || v === '1' || v === 'yes' };
}
