import {
  type Asset,
  type AssetCreate,
  type AssetMetadata,
  AssetsRepository,
  type AssetUpdate,
  type AssetUrl,
  type AssetVariations,
  type GetResourceOptions,
  type ListResourcesOptions,
  type Resource,
} from '@laikacms/assets';
import type { LaikaError, LaikaResult } from '@laikacms/core';
import { InternalError, InvalidData } from '@laikacms/core';
import type { JsonApiCollectionResponse } from '@laikacms/json-api';
import { type Folder, type FolderCreate } from '@laikacms/storage';
import * as Result from 'effect/Result';
import {
  parseAsset,
  parseAssetMetadata,
  parseAssetUrl,
  parseAssetVariations,
  parseFolder,
  parseResource,
} from './jsonapi.js';

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
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
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

  private async handleResponse<T, I = undefined, Data = JsonApiCollectionResponse & { data: T, included?: I[] }>(
    response: Response,
  ): Promise<LaikaResult<Data>> {
    const contentType = response.headers.get('content-type');

    if (!contentType?.includes('application/vnd.api+json') && !contentType?.includes('application/json')) {
      return Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
    }

    const json = await response.json();

    if (!response.ok) {
      const errors = json.errors || [{ detail: 'Unknown error' }];
      return Result.fail(
        new InvalidData(
          errors.map((e: { detail?: string, title?: string }) => e.detail || e.title || 'Unknown error').join(', '),
        ),
      );
    }

    if (json.errors) {
      return Result.fail(
        new InvalidData(
          json.errors.map((e: { detail?: string, title?: string }) => e.detail || e.title || 'Unknown error').join(
            ', ',
          ),
        ),
      );
    }

    // Return the full JSON response, not just json.data
    // The caller expects { data: T, included?: I[] } structure
    return Result.succeed(json as Data);
  }

  async *getResource(key: string, options?: GetResourceOptions): AsyncGenerator<LaikaResult<Resource[]>> {
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
      if (Result.isFailure(result)) {
        yield failAs<Resource[]>(result.failure);
        return;
      }

      const resource = parseResource(result.success.data) as Resource;

      this.storeIncludedResources(result.success.included);
      yield Result.succeed([resource]);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  storeIncludedResources(included: readonly (JsonApiResource)[] | undefined): void {
    if (!included) return;
    for (const item of included) {
      if (item.type === 'asset-variants') {
        const variation = parseAssetVariations(item);
        this.variations.set(variation.key, variation);
      } else if (item.type === 'asset-url') {
        const url = parseAssetUrl(item);
        this.urls.set(url.key, url);
      } else if (item.type === 'metadata' || item.type === 'asset-metadata') {
        const metadata = parseAssetMetadata(item);
        this.metadata.set(metadata.key, metadata);
      }
    }
  }

  async *listResources(folderKey: string, options: ListResourcesOptions): AsyncGenerator<LaikaResult<Resource[]>> {
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
        yield Result.fail(new InvalidData(`Expected JSON:API response, got ${contentType}`));
        return;
      }

      const json: JsonApiCollectionResponse = await response.json();

      if (!response.ok || 'errors' in json) {
        const errors = 'errors' in json && Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }];
        yield Result.fail(new InvalidData(errors.map(e => e.detail || e.title || 'Unknown error').join(', ')));
        return;
      }

      const resources: Resource[] = json.data.map((item: JsonApiResource) => parseResource(item) as Resource);
      this.storeIncludedResources(json.included);
      yield Result.succeed(resources);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *getAsset(key: string, options?: GetResourceOptions): AsyncGenerator<LaikaResult<Asset>> {
    for await (const result of this.getResource(key, options)) {
      if (Result.isFailure(result)) {
        yield failAs<Asset>(result.failure);
        return;
      }

      const resource = result.success[0];
      if (!resource || resource.type !== 'asset') {
        yield Result.fail(new InvalidData(`Expected asset but got ${resource?.type || 'nothing'}`));
        return;
      }

      yield Result.succeed(resource as Asset);
    }
  }

  async *createAsset(create: AssetCreate): AsyncGenerator<LaikaResult<Asset>> {
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
          const readResult = await reader.read();
          done = readResult.done;
          if (readResult.value) {
            chunks.push(readResult.value);
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
        yield Result.fail(new InvalidData('Unsupported content type'));
        return;
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
      if (Result.isFailure(result)) {
        yield failAs<Asset>(result.failure);
        return;
      }

      yield Result.succeed(parseAsset(result.success.data));
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *updateAsset(update: AssetUpdate): AsyncGenerator<LaikaResult<Asset>> {
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
      if (Result.isFailure(result)) {
        yield failAs<Asset>(result.failure);
        return;
      }

      yield Result.succeed(parseAsset(result.success.data));
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *deleteAssets(keys: readonly string[]): AsyncGenerator<LaikaResult<string[]>> {
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

      yield Result.succeed(deletedKeys);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *deleteAsset(key: string): AsyncGenerator<LaikaResult<void>> {
    try {
      const headers = await this.getHeaders();

      const response = await fetch(`${this.baseUrl}/resources/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        const errors = json.errors || [{ detail: 'Failed to delete asset' }];
        yield Result.fail(
          new InvalidData(
            errors.map((e: { detail?: string, title?: string }) => e.detail || e.title || 'Unknown error').join(', '),
          ),
        );
        return;
      }

      yield Result.succeed(undefined);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *deleteFolder(key: string, recursive?: boolean): AsyncGenerator<LaikaResult<void>> {
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
        yield Result.fail(
          new InvalidData(
            errors.map((e: { detail?: string, title?: string }) => e.detail || e.title || 'Unknown error').join(', '),
          ),
        );
        return;
      }

      yield Result.succeed(undefined);
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }

  async *getVariations(assets: Asset[]): AsyncGenerator<LaikaResult<AssetVariations[]>> {
    const results: AssetVariations[] = [];
    for (const asset of assets) {
      const variation = this.variations.get(asset.key);
      if (variation) {
        results.push(variation);
      } else {
        for await (const result of this.getAsset(asset.key, { hints: { variations: true } })) {
          if (Result.isFailure(result)) {
            yield failAs<AssetVariations[]>(result.failure);
            return;
          }
          if (!this.variations.has(asset.key)) {
            yield Result.fail(
              new InternalError(`Hint for variations was requested but no variations found for asset: ${asset.key}`),
            );
            return;
          }
          results.push(this.variations.get(asset.key)!);
        }
      }
    }
    yield Result.succeed(results);
  }

  async *getUrls(assets: Asset[]): AsyncGenerator<LaikaResult<AssetUrl[]>> {
    const results: AssetUrl[] = [];
    for (const asset of assets) {
      const url = this.urls.get(asset.key);
      if (url) {
        results.push(url);
      } else {
        for await (const result of this.getAsset(asset.key, { hints: { urls: true } })) {
          if (Result.isFailure(result)) {
            yield failAs<AssetUrl[]>(result.failure);
            return;
          }
          if (!this.urls.has(asset.key)) {
            yield Result.fail(
              new InternalError(`Hint for URLs was requested but no URLs found for asset: ${asset.key}`),
            );
            return;
          }
          results.push(this.urls.get(asset.key)!);
        }
      }
    }
    yield Result.succeed(results);
  }

  async *getMetadata(assets: Asset[]): AsyncGenerator<LaikaResult<AssetMetadata[]>> {
    const results: AssetMetadata[] = [];
    for (const asset of assets) {
      const metadataContent = this.metadata.get(asset.key);
      if (metadataContent) {
        results.push(metadataContent);
      } else {
        for await (const result of this.getAsset(asset.key, { hints: { metadata: true } })) {
          if (Result.isFailure(result)) {
            yield failAs<AssetMetadata[]>(result.failure);
            return;
          }
          if (!this.metadata.has(asset.key)) {
            yield Result.fail(
              new InternalError(`Hint for metadata was requested but no metadata found for asset: ${asset.key}`),
            );
            return;
          }
          results.push(this.metadata.get(asset.key)!);
        }
      }
    }
    yield Result.succeed(results);
  }

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    for await (const result of this.getResource(key)) {
      if (Result.isFailure(result)) {
        yield failAs<Folder>(result.failure);
        return;
      }

      const resource = result.success[0];
      if (!resource || resource.type !== 'folder') {
        yield Result.fail(new InvalidData(`Expected folder but got ${resource?.type || 'nothing'}`));
        return;
      }

      yield Result.succeed(resource as Folder);
    }
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
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
      if (Result.isFailure(result)) {
        yield failAs<Folder>(result.failure);
        return;
      }

      yield Result.succeed(parseFolder(result.success.data));
    } catch (error) {
      yield Result.fail(new InvalidData(`Network error: ${(error as Error).message}`));
    }
  }
}
