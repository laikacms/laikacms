import {
  AssetsRepository,
  type Asset,
  type AssetCreate,
  type AssetUpdate,
  type AssetVariations,
  type AssetUrl,
  type AssetMetadata,
  type AssetMetadataContent,
  type Resource,
  type GetResourceOptions,
  type ListResourcesOptions,
} from '@laikacms/assets';
import { type Folder, type FolderCreate } from '@laikacms/storage';
import { Result, success, failure, InvalidData, InternalError } from '@laikacms/core';
import { JsonApiCollectionResponse } from '@laikacms/json-api';
import { assetFromJsonApi, assetMetadataFromJsonApiZ, assetUrlFromJsonApiZ, assetVariantsFromJsonApiZ, folderFromJsonApiZ, includedFromJsonApiZ, resourceFromJsonApiZ } from './jsonapi.js';

export interface AssetsJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider - called before each request */
  tokenPromise?: () => Promise<string>;
}

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
}

/**
 * JSON:API Proxy implementation of AssetsRepository
 *
 * This implementation proxies all assets operations through a JSON:API
 * endpoint, enabling microservice architecture by communicating with
 * packages/apis/assets-api over HTTP.
 */
export class AssetsJsonApiProxyRepository extends AssetsRepository {
  private readonly baseUrl: string;
  private readonly staticHeaders: Record<string, string>;
  private readonly tokenPromise?: () => Promise<string>;

  private metadata: Map<string, AssetMetadata> = new Map();
  private variations: Map<string, AssetVariations> = new Map();
  private urls: Map<string, AssetUrl> = new Map();

  constructor(options: AssetsJsonApiProxyRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.tokenPromise = options.tokenPromise;
    this.staticHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      ...(options.authToken ? { 'Authorization': `Bearer ${options.authToken}` } : {}),
    };
  }

  /**
   * Get headers with dynamic token if tokenPromise is provided
   */
  private async getHeaders(): Promise<Record<string, string>> {
    if (this.tokenPromise) {
      const token = await this.tokenPromise();
      return {
        ...this.staticHeaders,
        'Authorization': `Bearer ${token}`,
      };
    }
    return this.staticHeaders;
  }

  private async handleResponse<T, I = undefined, Data = JsonApiCollectionResponse & { data: T, included?: I[] }>(response: Response): Promise<Result<Data>> {
    const contentType = response.headers.get('content-type');
    
    if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
      return failure(InvalidData.CODE, [`Expected JSON:API response, got ${contentType}`]);
    }

    const json = await response.json();

    if (!response.ok) {
      const errors = json.errors || [{ detail: 'Unknown error' }];
      return failure(InvalidData.CODE, errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || 'Unknown error'));
    }

    if (json.errors) {
      return failure(InvalidData.CODE, json.errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || 'Unknown error'));
    }

    // Return the full JSON response, not just json.data
    // The caller expects { data: T, included?: I[] } structure
    return success(json as Data);
  }

  async getResource(key: string, options?: GetResourceOptions): Promise<Result<Resource>> {
    try {
      const headers = await this.getHeaders();
      
      // Build include query parameter from hints
      const includeParams: string[] = [];
      if (options?.hints?.variations) includeParams.push('asset-variation');
      if (options?.hints?.urls) includeParams.push('asset-url');
      if (options?.hints?.metadata) includeParams.push('asset-metadata');
      
      const queryString = includeParams.length > 0 ? `?include=${includeParams.join(',')}` : '';
      
      const response = await fetch(`${this.baseUrl}/resources/${encodeURIComponent(key)}${queryString}`, {
        method: 'GET',
        headers,
      });

      const result = await this.handleResponse<JsonApiResource, JsonApiResource>(response);
      if (!result.success) return result;

      const resource = resourceFromJsonApiZ.parse(result.data.data) as Resource;

      this.storeIncludedResources(result.data.included);
      return success(resource);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  storeIncludedResources(included: readonly (JsonApiResource)[] | undefined): void {
    if (!included) return;
    for (const item of included) {
      if (item.type === 'asset-variants') {
        const variation = assetVariantsFromJsonApiZ.parse(item);
        this.variations.set(variation.key, variation);
      } else if (item.type === 'asset-url') {
        const url = assetUrlFromJsonApiZ.parse(item);
        this.urls.set(url.key, url);
      } else if (item.type === 'metadata') {
        const metadata = assetMetadataFromJsonApiZ.parse(item);
        this.metadata.set(metadata.key, metadata);
      }
    }
  }

  async *listResources(folderKey: string, options: ListResourcesOptions): AsyncGenerator<Result<readonly Resource[]>> {
    try {
      const headers = await this.getHeaders();
      
      // Build query parameters
      const params = new URLSearchParams();
      
      // Use folderKey as the prefix filter
      if (folderKey) {
        params.set('filter[prefix]', folderKey);
      }
      
      // Handle depth for recursive listing (minimum 1)
      const depth = Math.max(1, options?.depth ?? 1);
      if (depth > 1) {
        params.set('filter[depth]', String(depth));
      }
      
      // Handle pagination - check which type it is
      if (options?.pagination) {
        const pagination = options.pagination;
        if ('offset' in pagination) {
          params.set('page[offset]', String(pagination.offset || 0));
          params.set('page[limit]', String(pagination.limit || 100));
        } else if ('page' in pagination) {
          params.set('page[number]', String(pagination.page));
          if (pagination.perPage) params.set('page[size]', String(pagination.perPage));
        } else if ('after' in pagination) {
          if (pagination.after) params.set('page[after]', pagination.after);
          if (pagination.perPage) params.set('page[size]', String(pagination.perPage));
        } else if ('before' in pagination) {
          if (pagination.before) params.set('page[before]', pagination.before);
          if (pagination.perPage) params.set('page[size]', String(pagination.perPage));
        }
      }
      
      // Build include query parameter from hints
      const includeParams: string[] = [];
      if (options?.hints?.variations) includeParams.push('asset-variation');
      if (options?.hints?.urls) includeParams.push('asset-url');
      if (options?.hints?.metadata) includeParams.push('asset-metadata');
      if (includeParams.length > 0) {
        params.set('include', includeParams.join(','));
      }
      
      const queryString = params.toString();
      const url = `${this.baseUrl}/resources${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
        yield failure(InvalidData.CODE, [`Expected JSON:API response, got ${contentType}`]);
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || 'errors' in json) {
        const errors = 'errors' in json && Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }];
        yield failure(InvalidData.CODE, errors.map((e) => e.detail || e.title || 'Unknown error'));
        return;
      }

      const resources: Resource[] = json.data.map((item: JsonApiResource) => resourceFromJsonApiZ.parse(item) as Resource);
      this.storeIncludedResources(json.included);
      yield success(resources);
    } catch (error) {
      yield failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async getAsset(key: string, options?: GetResourceOptions): Promise<Result<Asset>> {
    const result = await this.getResource(key, options);
    if (!result.success) return result;
    
    if (result.data.type !== 'asset') {
      return failure(InvalidData.CODE, [`Expected asset but got ${result.data.type}`]);
    }
    
    return success(result.data as Asset);
  }

  async createAsset(create: AssetCreate): Promise<Result<Asset>> {
    try {
      const headers = await this.getHeaders();
      
      // For binary content, we need to use multipart/form-data
      const formData = new FormData();
      formData.append('key', create.key);
      if (create.mimeType) formData.append('mimeType', create.mimeType);
      if (create.filename) formData.append('filename', create.filename);
      if (create.cacheControl) formData.append('cacheControl', create.cacheControl);
      if (create.customMetadata) {
        formData.append('customMetadata', JSON.stringify(create.customMetadata));
      }
      
      // Handle different content types - convert to ArrayBuffer for Blob compatibility
      let blobContent: ArrayBuffer;
      
      if (create.content instanceof ArrayBuffer) {
        blobContent = create.content;
      } else if (create.content instanceof Uint8Array) {
        // Copy to a new ArrayBuffer to avoid SharedArrayBuffer issues
        blobContent = create.content.slice().buffer as ArrayBuffer;
      } else if (typeof ReadableStream !== 'undefined' && create.content instanceof ReadableStream) {
        // For streams, we need to read them first
        const reader = (create.content as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (result.value) {
            chunks.push(result.value);
          }
        }
        // Calculate total length
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        blobContent = combined.buffer as ArrayBuffer;
      } else {
        throw new Error('Unsupported content type');
      }
      
      // Use File instead of Blob to preserve the filename
      const filename = create.filename || create.key.split('/').pop() || 'file';
      const file = new File([blobContent], filename, { type: create.mimeType });
      formData.append('file', file, filename);
      
      // Remove Content-Type header to let browser set it with boundary
      const headersWithoutContentType = { ...headers };
      delete headersWithoutContentType['Content-Type'];
      
      const response = await fetch(`${this.baseUrl}/resources`, {
        method: 'POST',
        headers: headersWithoutContentType,
        body: formData,
      });

      const result = await this.handleResponse<JsonApiResource, JsonApiResource>(response);
      if (!result.success) return result;

      for (const element of result.data.included || []) {
        
      }

      return success(assetFromJsonApi.parse(result.data.data));
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async updateAsset(update: AssetUpdate): Promise<Result<Asset>> {
    try {
      const headers = await this.getHeaders();
      
      // AssetUpdate only has metadata fields, no content
      const jsonApiData = {
        type: 'asset',
        id: update.key,
        attributes: {
          ...(update.mimeType && { mimeType: update.mimeType }),
          ...(update.customMetadata && { customMetadata: update.customMetadata }),
          ...(update.cacheControl && { cacheControl: update.cacheControl }),
        },
      };
      
      const response = await fetch(`${this.baseUrl}/resources/${encodeURIComponent(update.key)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<JsonApiResource>(response);
      if (!result.success) return result;

      return success(assetFromJsonApi.parse(result.data));
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async *deleteAssets(keys: readonly string[]): AsyncGenerator<Result<readonly string[]>> {
    try {
      const headers = await this.getHeaders();
      const deletedKeys: string[] = [];
      
      for (const key of keys) {
        const response = await fetch(`${this.baseUrl}/resources/${encodeURIComponent(key)}`, {
          method: 'DELETE',
          headers,
        });

        if (response.ok) {
          deletedKeys.push(key);
        }
      }
      
      yield success(deletedKeys);
    } catch (error) {
      yield failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async deleteAsset(key: string): Promise<Result<void>> {
    try {
      const headers = await this.getHeaders();
      
      const response = await fetch(`${this.baseUrl}/resources/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        const errors = json.errors || [{ detail: 'Failed to delete asset' }];
        return failure(InvalidData.CODE, errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || 'Unknown error'));
      }

      return success(undefined);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async deleteFolder(key: string, recursive?: boolean): Promise<Result<void>> {
    try {
      const headers = await this.getHeaders();
      
      // Build query parameters for recursive deletion
      const params = new URLSearchParams();
      if (recursive) {
        params.set('recursive', 'true');
      }
      const queryString = params.toString();
      const url = `${this.baseUrl}/resources/${encodeURIComponent(key)}${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        const errors = json.errors || [{ detail: 'Failed to delete folder' }];
        return failure(InvalidData.CODE, errors.map((e: { detail?: string; title?: string }) => e.detail || e.title || 'Unknown error'));
      }

      return success(undefined);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }

  async *getVariations(assets: Asset[]): AsyncGenerator<Result<AssetVariations[]>> {
    const results: AssetVariations[] = [];
    for (const asset of assets) {
      const variation = this.variations.get(asset.key);
      if (variation) {
        results.push(variation);
      } else {
        const result = await this.getAsset(asset.key, { hints: { variations: true } });
        if (!result.success) yield result;
        else if (!this.variations.has(asset.key)) {
          yield failure(InternalError.CODE, [`Hint for variations was requested but no variations found for asset: ${asset.key}`]);
        } else {
          results.push(this.variations.get(asset.key)!);
        }
      }
    }
    yield success(results);
  }

  async *getUrls(assets: Asset[]): AsyncGenerator<Result<AssetUrl[]>> {
    const results: AssetUrl[] = [];
    for (const asset of assets) {
      const url = this.urls.get(asset.key);
      if (url) {
        results.push(url);
      } else {
        const result = await this.getAsset(asset.key, { hints: { urls: true } });
        if (!result.success) yield result;
        else if (!this.urls.has(asset.key)) {
          yield failure(InternalError.CODE, [`Hint for URLs was requested but no URLs found for asset: ${asset.key}`]);
        } else {
          results.push(this.urls.get(asset.key)!);
        }
      }
    }
    yield success(results);
  }

  async *getMetadata(assets: Asset[]): AsyncGenerator<Result<AssetMetadata[]>> {
    const results: AssetMetadata[] = [];
    for (const asset of assets) {
      const metadataContent = this.metadata.get(asset.key);
      if (metadataContent) {
        results.push(metadataContent);
      } else {
        const result = await this.getAsset(asset.key, { hints: { metadata: true } });
        if (!result.success) yield result;
        else if (!this.metadata.has(asset.key)) {
          yield failure(InternalError.CODE, [`Hint for metadata was requested but no metadata found for asset: ${asset.key}`]);
        } else {
          results.push(this.metadata.get(asset.key)!);
        }
      }
    }
    yield success(results);
  }

  async getFolder(key: string): Promise<Result<Folder>> {
    const result = await this.getResource(key);
    if (!result.success) return result;
    
    if (result.data.type !== 'folder') {
      return failure(InvalidData.CODE, [`Expected folder but got ${result.data.type}`]);
    }
    
    return success(result.data as Folder);
  }

  async createFolder(folderCreate: FolderCreate): Promise<Result<Folder>> {
    try {
      const headers = await this.getHeaders();
      
      const jsonApiData = {
        type: 'folder',
        id: folderCreate.key,
        attributes: {},
      };
      
      const response = await fetch(`${this.baseUrl}/resources`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: jsonApiData }),
      });

      const result = await this.handleResponse<JsonApiResource>(response);
      if (!result.success) return result;

      return success(folderFromJsonApiZ.parse(result.data.data) as Folder);
    } catch (error) {
      return failure(InvalidData.CODE, [`Network error: ${(error as Error).message}`]);
    }
  }
}
