import * as Effect from 'effect/Effect';

import type * as HttpClient from 'effect/unstable/http/HttpClient';
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
  type GetSyncTokenOptions,
  type ListChangesDone,
  type ListChangesOptions,
  type ListResourcesDone,
  type ListResourcesOptions,
  type Resource,
} from 'laikacms/assets';

import {
  ErrorCodeToClassMap,
  InternalError,
  InvalidData,
  type LaikaDone,
  type LaikaError,
  LaikaStream,
  LaikaTask,
} from 'laikacms/core';
import { type JsonApiCollectionResponse, warningsFromMeta } from 'laikacms/json-api';

import { type ChangeSummary, type Folder, type FolderCreate, SyncToken } from 'laikacms/storage';
import { JsonApiHttpTransport } from '../../shared/json-api/http-transport.js';

import { parseAsset, parseAssetUrl, parseAssetVariations, parseFolder, parseResource } from './jsonapi.js';

export interface AssetsJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider — called before each request. */
  tokenPromise?: () => Promise<string>;
  /**
   * Effect `HttpClient` used for every request. Provide one client per
   * process (see `httpClientFromFetch` in `laikacms/json-api`) so all proxy
   * repositories share a single connection pool. Defaults to a client backed
   * by `globalThis.fetch`.
   */
  httpClient?: HttpClient.HttpClient;
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
  private readonly transport: JsonApiHttpTransport;

  private metadata: Map<string, AssetMetadata> = new Map();
  private variations: Map<string, AssetVariations> = new Map();
  private urls: Map<string, AssetUrl> = new Map();

  constructor(options: AssetsJsonApiProxyRepositoryOptions) {
    super();
    this.transport = new JsonApiHttpTransport(options);
  }

  /**
   * Always re-hydrates the upstream error's typed `LaikaError` subclass from
   * its `code` field (falling back to `InvalidData`), so a 404/400/409 from
   * the backing API surfaces through the proxy as `NotFoundError`/
   * `BadRequestError`/`ConflictError` instead of a generic 500.
   */
  private fetchJson<T = Record<string, unknown>>(
    path: string,
    init: { method: string, body?: unknown, multipart?: FormData } = { method: 'GET' },
  ): Effect.Effect<T, LaikaError> {
    return this.transport.fetchJson(path, init, { rehydrateErrorCodes: true }) as Effect.Effect<T, LaikaError>;
  }

  private fetchVoid(
    path: string,
    init: { method: string } = { method: 'GET' },
  ): Effect.Effect<void, LaikaError> {
    return this.fetchVoidWithWarnings(path, init);
  }

  /**
   * Issue a void/DELETE request, surface non-2xx as a typed failure, and
   * (on success with a JSON body) re-emit any `meta.warnings` to the
   * caller's `emit`. The upstream assets-api returns 204 No Content on a
   * clean delete and 200 + `{meta: {deleted, warnings}}` when warnings
   * exist — both shapes are handled.
   */
  private fetchVoidWithWarnings(
    path: string,
    init: { method: string },
    emit?: LaikaTask.LaikaMetadataEmit,
  ): Effect.Effect<void, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const response = yield* this.transport.request(path, init);
      // `response.json` yields null on an empty body and fails on malformed
      // JSON — both collapse to {} to mirror the old `.json().catch(() => ({}))`.
      const readJson = Effect.map(
        Effect.result(response.json as Effect.Effect<Record<string, unknown> | null, unknown>),
        r => r._tag === 'Success' && r.success !== null ? r.success : {} as Record<string, unknown>,
      );
      if (response.status < 200 || response.status >= 300) {
        const json = (yield* readJson) as {
          errors?: Array<{ detail?: string, title?: string, code?: string }>,
        };
        const errors = json.errors || [{ detail: 'Request failed' }];
        const detail = errors.map(e => e.detail || e.title || 'Unknown error').join(', ');
        // Re-hydrate the upstream error's typed LaikaError subclass from its
        // `code` field (falling back to InvalidData) — mirrors
        // JsonApiHttpTransport#fetchJson's `rehydrateErrorCodes` behavior, so
        // a 404/400/409 on a void route (DELETE) surfaces as
        // NotFoundError/BadRequestError/ConflictError instead of a 500.
        const firstCode = errors[0]?.code;
        const ErrorCtor = firstCode
          ? (ErrorCodeToClassMap as Record<string, new(msg: string) => LaikaError>)[firstCode]
          : undefined;
        return yield* Effect.fail(ErrorCtor ? new ErrorCtor(detail) : new InvalidData(detail));
      }
      // 204 No Content carries no body; 200 + JSON may have meta.warnings.
      if (!emit || response.status === 204) return;
      const contentType = response.headers['content-type'];
      if (!contentType?.includes('json')) return;
      const json = yield* readJson;
      for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
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
          versionTracking: {
            supported: false,
            description: 'The remote endpoint did not advertise its capabilities.',
          },
          changes: {
            supported: false,
            description: 'The remote endpoint did not advertise its capabilities.',
          },
          filtering: {
            supported: false,
            description: 'The remote endpoint did not advertise its capabilities.',
          },
        };
        this.cachedCapabilities = fallback;
        return fallback;
      })
    );
  }

  // ===== CHANGE SIGNALS =====

  override getSyncToken(options?: GetSyncTokenOptions): LaikaTask.LaikaTask<SyncToken> {
    return LaikaTask.make<SyncToken>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = new URLSearchParams();
        if (options?.folder) params.set('filter[folder]', options.folder);
        const qs = params.size > 0 ? `?${params}` : '';
        const json = yield* this.fetchJson<{
          data?: { attributes?: { syncToken?: unknown } },
          meta?: Record<string, unknown>,
        }>(`/sync-token${qs}`, { method: 'GET' });
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
        const token = json.data?.attributes?.syncToken;
        if (typeof token !== 'string') {
          return yield* Effect.fail(
            new InvalidData('Upstream /sync-token response is missing attributes.syncToken'),
          );
        }
        return SyncToken.make(token);
      })
    );
  }

  override listChanges(
    options: ListChangesOptions,
  ): LaikaStream.LaikaStream<ChangeSummary, ListChangesDone> {
    return LaikaStream.make<ChangeSummary, ListChangesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = new URLSearchParams();
        params.set('filter[since]', options.since);
        if (options.folder) params.set('filter[folder]', options.folder);

        const json = yield* this.fetchJson<
          JsonApiCollectionResponse & { meta?: { syncToken?: unknown, page?: { total?: number } } }
        >(`/changes?${params}`, { method: 'GET' });
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);

        let emitted = 0;
        for (const item of json.data ?? []) {
          const entry = item as { id: string, attributes?: { deleted?: unknown, version?: unknown } };
          const version = entry.attributes?.version;
          yield* emit.data({
            key: entry.id,
            deleted: entry.attributes?.deleted === true,
            ...(typeof version === 'string' ? { version } : {}),
          });
          emitted += 1;
        }

        const token = json.meta?.syncToken;
        if (typeof token !== 'string') {
          return yield* Effect.fail(new InvalidData('Upstream /changes response is missing meta.syncToken'));
        }
        return {
          syncToken: SyncToken.make(token),
          total: json.meta?.page?.total ?? emitted,
        };
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
    return LaikaTask.make<ReadonlyArray<Resource>>(emit =>
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

        const json = yield* this.fetchJson<
          { data: JsonApiResource, included?: JsonApiResource[], meta?: unknown }
        >(`/resources/${encodeURIComponent(key)}${queryString ? `?${queryString}` : ''}`);
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
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
        // Named listing filters travel as filter[<name>] params, verbatim.
        // The server validates names against the backend's declared
        // filtering capability, so this stays generic — new filters need no
        // proxy changes.
        for (const [name, value] of Object.entries(options?.filters ?? {})) {
          params.set(`filter[${name}]`, value);
        }

        if (options?.pagination) {
          const p = options.pagination;
          if ('offset' in p) {
            params.set('page[offset]', String(p.offset || 0));
            params.set('page[limit]', String(p.limit || 100));
          } else if ('page' in p) {
            params.set('page[number]', String(p.page));
            if (p.perPage) params.set('page[size]', String(p.perPage));
          } else if ('after' in p) {
            // An empty page[after]= is meaningful: it tells the server to
            // start a cursor iteration (cursor-shaped from the first page),
            // so backends with native cursors never fall back to a walk.
            params.set('page[after]', p.after ?? '');
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
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);

        let emitted = 0;
        for (const item of json.data as JsonApiResource[]) {
          this.cacheMetaFromAsset(item);
          yield* emit.data(parseResource(item) as Resource);
          emitted += 1;
        }
        this.storeIncludedResources(json.included as JsonApiResource[] | undefined);

        // Surface the server's links.next as done.pagination so callers can
        // continue a cursor iteration without knowing the link format.
        let nextPagination: { after: string, perPage?: number } | undefined;
        const nextLink = (json.links as { next?: string } | undefined)?.next;
        if (typeof nextLink === 'string') {
          try {
            const nextUrl = new URL(nextLink, 'http://relative-link.invalid');
            const after = nextUrl.searchParams.get('page[after]');
            if (after) {
              const size = Number.parseInt(nextUrl.searchParams.get('page[size]') ?? '', 10);
              nextPagination = { after, ...(Number.isFinite(size) ? { perPage: size } : {}) };
            }
          } catch {
            // Malformed next link: treat as no continuation rather than fail the page.
          }
        }

        // With a continuation pending, the upstream total (when present) is
        // authoritative; `emitted` is just this page's size, so don't let it
        // masquerade as a total.
        const total = json.meta?.page?.total ?? (nextPagination ? undefined : emitted);
        return {
          ...(typeof total === 'number' ? { total } : {}),
          ...(nextPagination ? { pagination: nextPagination } : {}),
        };
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
    return LaikaTask.make<Asset>(emit =>
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

        const json = yield* this.fetchJson<{ data: JsonApiResource, meta?: unknown }>(
          `/resources`,
          { method: 'POST', multipart: formData },
        );
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
        return parseAsset(json.data);
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(emit =>
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
        const json = yield* this.fetchJson<{ data: JsonApiResource, meta?: unknown }>(
          `/resources/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: jsonApiData } },
        );
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
        return parseAsset(json.data);
      })
    );
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      this.fetchVoidWithWarnings(
        `/resources/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
        emit,
      )
    );
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const r = yield* Effect.result(
            this.fetchVoidWithWarnings(
              `/resources/${encodeURIComponent(key)}`,
              { method: 'DELETE' },
              emit,
            ),
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
    return LaikaTask.make<void>(emit => {
      const params = new URLSearchParams();
      if (recursive) params.set('recursive', 'true');
      const queryString = params.toString();
      return this.fetchVoidWithWarnings(
        `/resources/${encodeURIComponent(key)}${queryString ? `?${queryString}` : ''}`,
        { method: 'DELETE' },
        emit,
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
    return LaikaTask.make<Folder>(emit =>
      Effect.gen({ self: this }, function*() {
        const json = yield* this.fetchJson<{ data: JsonApiResource, meta?: unknown }>(
          `/resources`,
          { method: 'POST', body: { data: { type: 'folder', id: folderCreate.key, attributes: {} } } },
        );
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
        return parseFolder(json.data);
      })
    );
  }
}
