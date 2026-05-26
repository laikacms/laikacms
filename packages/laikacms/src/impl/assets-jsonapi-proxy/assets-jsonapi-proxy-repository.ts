import * as Effect from 'effect/Effect';

import {
  type Asset,
  type AssetCreate,
  type AssetMetadata,
  type AssetsCapabilities,
  AssetsCompatibilityDate,
  AssetsRepository,
  type AssetUpdate,
  type AssetUrl,
  type AssetVariations,
  type DeleteAssetsDone,
  type GetResourceOptions,
  type ListResourcesDone,
  type ListResourcesOptions,
  type Resource,
} from 'laikacms/assets';
import { InternalError, InvalidData, type LaikaDone, type LaikaError, LaikaStream, LaikaTask } from 'laikacms/core';
import type { JsonApiCollectionResponse } from 'laikacms/json-api';
import { type Folder, type FolderCreate } from 'laikacms/storage';

import { parseAsset, parseAssetUrl, parseAssetVariations, parseFolder, parseResource } from './jsonapi.js';

export interface AssetsJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider — called before each request. */
  tokenPromise?: () => Promise<string>;
}

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
}

/**
 * Proxies all assets operations through a remote JSON:API endpoint.
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
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenPromise = options.tokenPromise;
    this.staticHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      ...(options.authToken ? { 'Authorization': `Bearer ${options.authToken}` } : {}),
    };
  }

  private async getHeaders(): Promise<Record<string, string>> {
    if (this.tokenPromise) {
      const token = await this.tokenPromise();
      return { ...this.staticHeaders, 'Authorization': `Bearer ${token}` };
    }
    return this.staticHeaders;
  }

  private fetchJson<T = Record<string, unknown>>(
    path: string,
    init: { method: string, body?: unknown, multipart?: FormData } = { method: 'GET' },
  ): Effect.Effect<T, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const headers = yield* Effect.promise(() => this.getHeaders());
      let finalHeaders: Record<string, string> = headers;
      let body: BodyInit | undefined;
      if (init.multipart) {
        const { 'Content-Type': _ct, ...rest } = headers;
        finalHeaders = rest;
        body = init.multipart;
      } else if (init.body !== undefined) {
        body = JSON.stringify(init.body);
      }
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${this.baseUrl}${path}`, { method: init.method, headers: finalHeaders, body }),
        catch: e => new InvalidData(`Network error: ${(e as Error).message}`),
      });
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/vnd.api+json')
        || contentType?.includes('application/json');
      if (!isJson) {
        // Non-JSON response (often a stack trace on 500). Include the body so
        // the caller can actually see what went wrong on the server.
        const bodySnippet = yield* Effect.promise(() =>
          response.text().then(t => t.slice(0, 500)).catch(() => '<unreadable>')
        );
        return yield* Effect.fail(
          new InvalidData(
            `${init.method} ${path} → ${response.status} ${response.statusText} `
              + `(content-type: ${contentType ?? 'none'}): ${bodySnippet}`,
          ),
        );
      }
      const json = yield* Effect.promise(() => response.json() as Promise<Record<string, unknown>>);
      if (!response.ok || (Array.isArray(json.errors) && json.errors.length > 0)) {
        const errors = (Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }]) as Array<
          { detail?: string, title?: string }
        >;
        return yield* Effect.fail(
          new InvalidData(errors.map(e => e.detail || e.title || 'Unknown error').join(', ')),
        );
      }
      return json as T;
    });
  }

  private fetchVoid(
    path: string,
    init: { method: string } = { method: 'GET' },
  ): Effect.Effect<void, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const headers = yield* Effect.promise(() => this.getHeaders());
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${this.baseUrl}${path}`, { method: init.method, headers }),
        catch: e => new InvalidData(`Network error: ${(e as Error).message}`),
      });
      if (!response.ok) {
        const json = yield* Effect.promise(() => response.json().catch(() => ({}))) as Effect.Effect<
          { errors?: Array<{ detail?: string, title?: string }> }
        >;
        const errors = json.errors || [{ detail: 'Request failed' }];
        return yield* Effect.fail(
          new InvalidData(errors.map(e => e.detail || e.title || 'Unknown error').join(', ')),
        );
      }
    });
  }

  /**
   * Cached upstream capabilities. The remote assets-api exposes
   * `GET /capabilities` returning the real backing repo's capabilities, so
   * we fetch + cache it per repo instance. Falls back to a conservative
   * default if the upstream doesn't speak the endpoint yet.
   */
  private cachedCapabilities?: AssetsCapabilities;

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.make<AssetsCapabilities>(() =>
      Effect.gen({ self: this }, function*() {
        if (this.cachedCapabilities) return this.cachedCapabilities;
        const r = yield* Effect.result(
          this.fetchJson<{ data?: { attributes?: AssetsCapabilities } }>('/capabilities'),
        );
        if (r._tag === 'Success') {
          const data = r.success.data?.attributes;
          if (data) {
            this.cachedCapabilities = data;
            return data;
          }
        }
        const fallback: AssetsCapabilities = {
          compatibilityDate: AssetsCompatibilityDate.make('2026-05-11'),
          pagination: {
            supported: true,
            description: 'JSON:API pagination is forwarded to the remote endpoint.',
            styles: { offset: true, page: true, cursor: true },
          },
        };
        this.cachedCapabilities = fallback;
        return fallback;
      })
    );
  }

  private storeIncludedResources(included: readonly JsonApiResource[] | undefined): void {
    if (!included) return;
    for (const item of included) {
      if (item.type === 'asset-variants' || item.type === 'asset-variation') {
        const variation = parseAssetVariations(item);
        this.variations.set(variation.key, variation);
      } else if (item.type === 'asset-url') {
        const url = parseAssetUrl(item);
        this.urls.set(url.key, url);
      }
      // `asset-metadata` is no longer a separate JSON:API resource — the
      // server inlines it on each asset's `meta` instead. See `cacheMetaFromAsset`.
    }
  }

  /**
   * The server returns the asset's intrinsic metadata under the resource's
   * top-level `meta` (per JSON:API spec). Pull it out into the metadata cache
   * so `getMetadata()` calls can return without an extra round-trip.
   */
  private cacheMetaFromAsset(item: JsonApiResource): void {
    if (item.type !== 'asset') return;
    const raw = (item as { meta?: unknown }).meta;
    if (!raw || typeof raw !== 'object') return;
    this.metadata.set(item.id, {
      key: item.id,
      metadata: raw as AssetMetadata['metadata'],
    });
  }

  getResource(
    key: string,
    options?: GetResourceOptions,
  ): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        const params = new URLSearchParams();
        const includes: string[] = [];
        if (options?.hints?.variations) includes.push('variations');
        if (options?.hints?.urls) includes.push('urls');
        if (includes.length > 0) params.set('include', includes.join(','));
        // `meta` is its own query param per JSON:API: `?include=` is reserved
        // for relationship traversal, and intrinsic metadata isn't a related
        // resource.
        if (options?.hints?.metadata) params.set('meta', 'true');
        const queryString = params.toString();

        const json = yield* this.fetchJson<{ data: JsonApiResource, included?: JsonApiResource[] }>(
          `/resources/${encodeURIComponent(key)}${queryString ? `?${queryString}` : ''}`,
        );
        const resource = parseResource(json.data) as Resource;
        this.cacheMetaFromAsset(json.data);
        this.storeIncludedResources(json.included);
        return [resource];
      })
    );
  }

  listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): LaikaStream.LaikaStream<Resource, ListResourcesDone> {
    return LaikaStream.make<Resource, ListResourcesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = new URLSearchParams();
        if (folderKey) params.set('filter[prefix]', folderKey);
        const depth = Math.max(1, options?.depth ?? 1);
        if (depth > 1) params.set('filter[depth]', String(depth));

        if (options?.pagination) {
          const p = options.pagination;
          if ('offset' in p) {
            params.set('page[offset]', String(p.offset || 0));
            params.set('page[limit]', String(p.limit || 100));
          } else if ('page' in p) {
            params.set('page[number]', String(p.page));
            if (p.perPage) params.set('page[size]', String(p.perPage));
          } else if ('after' in p) {
            if (p.after) params.set('page[after]', p.after);
            if (p.perPage) params.set('page[size]', String(p.perPage));
          } else if ('before' in p) {
            if (p.before) params.set('page[before]', p.before);
            if (p.perPage) params.set('page[size]', String(p.perPage));
          }
        }

        const includes: string[] = [];
        if (options?.hints?.variations) includes.push('variations');
        if (options?.hints?.urls) includes.push('urls');
        if (includes.length > 0) params.set('include', includes.join(','));
        if (options?.hints?.metadata) params.set('meta', 'true');

        const queryString = params.toString();
        const json = yield* this.fetchJson<JsonApiCollectionResponse>(
          `/resources${queryString ? `?${queryString}` : ''}`,
        );

        let emitted = 0;
        for (const item of json.data as JsonApiResource[]) {
          this.cacheMetaFromAsset(item);
          yield* emit.data(parseResource(item) as Resource);
          emitted += 1;
        }
        this.storeIncludedResources(json.included as JsonApiResource[] | undefined);
        return { total: emitted };
      })
    );
  }

  getAsset(key: string, options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const resources = yield* LaikaTask.runValue(this.getResource(key, options));
        const resource = resources[0];
        if (!resource || resource.type !== 'asset') {
          return yield* Effect.fail(
            new InvalidData(`Expected asset but got ${resource?.type || 'nothing'}`),
          );
        }
        return resource as Asset;
      })
    );
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const formData = new FormData();
        formData.append('key', create.key);
        if (create.mimeType) formData.append('mimeType', create.mimeType);
        if (create.filename) formData.append('filename', create.filename);
        if (create.cacheControl) formData.append('cacheControl', create.cacheControl);
        if (create.customMetadata) {
          formData.append('customMetadata', JSON.stringify(create.customMetadata));
        }

        let blobContent: ArrayBuffer;
        if (create.content instanceof ArrayBuffer) {
          blobContent = create.content;
        } else if (create.content instanceof Uint8Array) {
          blobContent = create.content.slice().buffer as ArrayBuffer;
        } else if (typeof ReadableStream !== 'undefined' && create.content instanceof ReadableStream) {
          blobContent = yield* Effect.promise(async () => {
            const reader = (create.content as ReadableStream<Uint8Array>).getReader();
            const chunks: Uint8Array[] = [];
            let done = false;
            while (!done) {
              const r = await reader.read();
              done = r.done;
              if (r.value) chunks.push(r.value);
            }
            const total = chunks.reduce((a, c) => a + c.length, 0);
            const combined = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }
            return combined.buffer as ArrayBuffer;
          });
        } else {
          return yield* Effect.fail(new InvalidData('Unsupported content type'));
        }

        const filename = create.filename || create.key.split('/').pop() || 'file';
        const file = new File([blobContent], filename, { type: create.mimeType });
        formData.append('file', file, filename);

        const json = yield* this.fetchJson<{ data: JsonApiResource }>(
          `/resources`,
          { method: 'POST', multipart: formData },
        );
        return parseAsset(json.data);
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const jsonApiData = {
          type: 'asset',
          id: update.key,
          attributes: {
            ...(update.mimeType && { mimeType: update.mimeType }),
            ...(update.customMetadata && { customMetadata: update.customMetadata }),
            ...(update.cacheControl && { cacheControl: update.cacheControl }),
          },
        };
        const json = yield* this.fetchJson<{ data: JsonApiResource }>(
          `/resources/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: jsonApiData } },
        );
        return parseAsset(json.data);
      })
    );
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() => this.fetchVoid(`/resources/${encodeURIComponent(key)}`, { method: 'DELETE' }));
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const r = yield* Effect.result(
            this.fetchVoid(`/resources/${encodeURIComponent(key)}`, { method: 'DELETE' }),
          );
          if (r._tag === 'Failure') {
            yield* emit.recoverableError(r.failure);
            skipped += 1;
            continue;
          }
          yield* emit.data(key);
          removed += 1;
        }
        return { removed, skipped };
      })
    );
  }

  deleteFolder(key: string, recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() => {
      const params = new URLSearchParams();
      if (recursive) params.set('recursive', 'true');
      const queryString = params.toString();
      return this.fetchVoid(
        `/resources/${encodeURIComponent(key)}${queryString ? `?${queryString}` : ''}`,
        { method: 'DELETE' },
      );
    });
  }

  getVariations(assets: Asset[]): LaikaStream.LaikaStream<AssetVariations, LaikaDone> {
    return LaikaStream.make<AssetVariations, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let emitted = 0;
        for (const asset of assets) {
          const cached = this.variations.get(asset.key);
          if (cached) {
            yield* emit.data(cached);
            emitted += 1;
            continue;
          }
          // Trigger a getAsset with the hint to populate the cache, then fetch.
          const r = yield* Effect.result(
            LaikaTask.runValue(this.getAsset(asset.key, { hints: { variations: true } })),
          );
          if (r._tag === 'Failure') {
            yield* emit.recoverableError(r.failure);
            continue;
          }
          const variation = this.variations.get(asset.key);
          if (!variation) {
            yield* emit.recoverableError(
              new InternalError(`Hint for variations was requested but no variations found for asset: ${asset.key}`),
            );
            continue;
          }
          yield* emit.data(variation);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  getUrls(assets: Asset[]): LaikaStream.LaikaStream<AssetUrl, LaikaDone> {
    return LaikaStream.make<AssetUrl, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let emitted = 0;
        for (const asset of assets) {
          const cached = this.urls.get(asset.key);
          if (cached) {
            yield* emit.data(cached);
            emitted += 1;
            continue;
          }
          const r = yield* Effect.result(
            LaikaTask.runValue(this.getAsset(asset.key, { hints: { urls: true } })),
          );
          if (r._tag === 'Failure') {
            yield* emit.recoverableError(r.failure);
            continue;
          }
          const url = this.urls.get(asset.key);
          if (!url) {
            yield* emit.recoverableError(
              new InternalError(`Hint for URLs was requested but no URLs found for asset: ${asset.key}`),
            );
            continue;
          }
          yield* emit.data(url);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  getMetadata(assets: Asset[]): LaikaStream.LaikaStream<AssetMetadata, LaikaDone> {
    return LaikaStream.make<AssetMetadata, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let emitted = 0;
        for (const asset of assets) {
          const cached = this.metadata.get(asset.key);
          if (cached) {
            yield* emit.data(cached);
            emitted += 1;
            continue;
          }
          const r = yield* Effect.result(
            LaikaTask.runValue(this.getAsset(asset.key, { hints: { metadata: true } })),
          );
          if (r._tag === 'Failure') {
            yield* emit.recoverableError(r.failure);
            continue;
          }
          const meta = this.metadata.get(asset.key);
          if (!meta) {
            yield* emit.recoverableError(
              new InternalError(`Hint for metadata was requested but no metadata found for asset: ${asset.key}`),
            );
            continue;
          }
          yield* emit.data(meta);
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const resources = yield* LaikaTask.runValue(this.getResource(key));
        const resource = resources[0];
        if (!resource || resource.type !== 'folder') {
          return yield* Effect.fail(
            new InvalidData(`Expected folder but got ${resource?.type || 'nothing'}`),
          );
        }
        return resource as Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const json = yield* this.fetchJson<{ data: JsonApiResource }>(
          `/resources`,
          { method: 'POST', body: { data: { type: 'folder', id: folderCreate.key, attributes: {} } } },
        );
        return parseFolder(json.data);
      })
    );
  }
}
