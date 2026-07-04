import * as Effect from 'effect/Effect';

import { ErrorCodeToClassMap, InvalidData, type LaikaError, LaikaStream, LaikaTask } from 'laikacms/core';
import {
  type Atom,
  type AtomSummary,
  Capabilities,
  CompatibilityDate,
  type Folder,
  type FolderCreate,
  type ListAtomsDone,
  type ListAtomsOptions,
  type RemoveAtomsDone,
  type StorageObject,
  type StorageObjectCreate,
  type StorageObjectUpdate,
  StorageRepository,
} from 'laikacms/storage';
import {
  atomFromJsonApi,
  atomSummaryFromJsonApi,
  decodeJsonApiAtom,
  decodeJsonApiAtomSummary,
  decodeJsonApiFolder,
  decodeJsonApiStorageObject,
  folderCreateToJsonApi,
  folderFromJsonApi,
  type JsonApiAtom,
  type JsonApiAtomSummary,
  type JsonApiCollectionResponse,
  type JsonApiFolder,
  type JsonApiStorageObject,
  storageObjectCreateToJsonApi,
  storageObjectFromJsonApi,
  storageObjectUpdateToJsonApi,
} from 'laikacms/storage/api';

import { paginationCodec } from '../../shared/json-api/pagination-codec.js';
import { warningsFromMeta } from '../../shared/json-api/utilities.js';

export interface StorageJsonApiProxyRepositoryOptions {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider — called before each request. */
  tokenPromise?: () => Promise<string>;
}

/**
 * Proxies all storage operations through a remote JSON:API endpoint.
 */
export class StorageJsonApiProxyRepository extends StorageRepository {
  private readonly baseUrl: string;
  private readonly staticHeaders: HeadersInit;
  private readonly tokenPromise?: () => Promise<string>;

  constructor(options: StorageJsonApiProxyRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenPromise = options.tokenPromise;
    this.staticHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      ...(options.authToken ? { 'Authorization': `Bearer ${options.authToken}` } : {}),
    };
  }

  private async getHeaders(): Promise<HeadersInit> {
    if (this.tokenPromise) {
      const token = await this.tokenPromise();
      return { ...this.staticHeaders, 'Authorization': `Bearer ${token}` };
    }
    return this.staticHeaders;
  }

  /** Execute an HTTP request and return the JSON:API resource or fail. */
  private fetchResource<T>(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<T, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const json = yield* this.fetchJson(path, init);
      return json.data as T;
    });
  }

  /**
   * Like {@link fetchResource} but also re-emits upstream `meta.warnings` as
   * recoverableErrors on the outer LaikaTask. Used by single-resource
   * write/read routes so warnings flow end-to-end through proxy chains.
   */
  private fetchResourceWithWarnings<T>(
    path: string,
    init: { method: string, body?: unknown },
    emit: LaikaTask.LaikaTaskEmit,
  ): Effect.Effect<T, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const json = yield* this.fetchJson(path, init);
      for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
      return json.data as T;
    });
  }

  /** Execute an HTTP request and return the parsed JSON. */
  private fetchJson(
    path: string,
    init: { method: string, body?: unknown } = { method: 'GET' },
  ): Effect.Effect<{ data?: unknown, errors?: unknown[] } & Record<string, unknown>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const headers = yield* Effect.promise(() => this.getHeaders());
      const response = yield* Effect.promise(() =>
        fetch(`${this.baseUrl}${path}`, {
          method: init.method,
          headers,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        })
      );
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/vnd.api+json')
        || contentType?.includes('application/json');
      if (!isJson) {
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
          { detail?: string, title?: string, code?: string }
        >;
        const detail = errors.map(e => e.detail || e.title || 'Unknown error').join(', ');
        // Use the first error's `code` to reconstruct the original LaikaError
        // subclass (NotFoundError, ValidationError, ...) so consumers can
        // `instanceof` against them. Fall back to InvalidData if the code is
        // unknown or absent.
        const firstCode = errors[0]?.code;
        const ErrorCtor = firstCode
          ? (ErrorCodeToClassMap as Record<string, new(msg: string) => LaikaError>)[firstCode]
          : undefined;
        return yield* Effect.fail(
          ErrorCtor ? new ErrorCtor(detail) : new InvalidData(detail),
        );
      }
      return json as { data?: unknown, errors?: unknown[] } & Record<string, unknown>;
    });
  }

  private decodeStorageObject(raw: unknown): Effect.Effect<StorageObject, LaikaError> {
    return Effect.try({
      try: () => storageObjectFromJsonApi(decodeJsonApiStorageObject(raw) as JsonApiStorageObject),
      catch: e => new InvalidData((e as { message?: string }).message ?? 'Invalid JSON:API response'),
    });
  }

  private decodeFolder(raw: unknown): Effect.Effect<Folder, LaikaError> {
    return Effect.try({
      try: () => folderFromJsonApi(decodeJsonApiFolder(raw) as JsonApiFolder),
      catch: e => new InvalidData((e as { message?: string }).message ?? 'Invalid JSON:API response'),
    });
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<JsonApiStorageObject>(
          `/objects/${encodeURIComponent(key)}`,
          { method: 'GET' },
          emit,
        );
        return yield* this.decodeStorageObject(raw);
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<JsonApiStorageObject>(
          `/objects/${encodeURIComponent(update.key)}`,
          { method: 'PATCH', body: { data: storageObjectUpdateToJsonApi(update) } },
          emit,
        );
        return yield* this.decodeStorageObject(raw);
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<JsonApiStorageObject>(
          `/objects`,
          { method: 'POST', body: { data: storageObjectCreateToJsonApi(create) } },
          emit,
        );
        return yield* this.decodeStorageObject(raw);
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.result(LaikaTask.runValueForwarding(this.getObject(create.key), emit));
        if (existing._tag === 'Success') {
          return yield* LaikaTask.runValueForwarding(
            this.updateObject({
              key: create.key,
              content: create.content,
              metadata: create.metadata,
            }),
            emit,
          );
        }
        return yield* LaikaTask.runValueForwarding(this.createObject(create), emit);
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<JsonApiFolder>(
          `/folders/${encodeURIComponent(key)}`,
          { method: 'GET' },
          emit,
        );
        return yield* this.decodeFolder(raw);
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(emit =>
      Effect.gen({ self: this }, function*() {
        const raw = yield* this.fetchResourceWithWarnings<JsonApiFolder>(
          `/atoms`,
          { method: 'POST', body: { data: folderCreateToJsonApi(folderCreate) } },
          emit,
        );
        return yield* this.decodeFolder(raw);
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(emit =>
      Effect.gen({ self: this }, function*() {
        const asObject = yield* Effect.result(LaikaTask.runValueForwarding(this.getObject(key), emit));
        if (asObject._tag === 'Success') return asObject.success;
        return yield* LaikaTask.runValueForwarding(this.getFolder(key), emit);
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = paginationCodec.encode(options.pagination);
        const depthParam = `filter[depth]=${options.depth}`;
        const path = folderKey
          ? `/atoms/${encodeURIComponent(folderKey)}?${params}&${depthParam}`
          : `/atoms?${params}&${depthParam}`;
        const json = yield* this.fetchJson(path);
        const collection = json as unknown as JsonApiCollectionResponse;
        // Re-emit upstream `meta.warnings` first so they stay associated with
        // this listing rather than getting mixed into per-item decode failures.
        for (const w of warningsFromMeta(collection.meta)) yield* emit.recoverableError(w);
        let emitted = 0;
        for (const item of collection.data) {
          const decoded = yield* Effect.result(
            Effect.try({
              try: () => atomFromJsonApi(decodeJsonApiAtom(item) as JsonApiAtom),
              catch: e => new InvalidData((e as { message?: string }).message ?? 'Invalid JSON:API response'),
            }),
          );
          if (decoded._tag === 'Failure') {
            yield* emit.recoverableError(decoded.failure);
          } else {
            yield* emit.data(decoded.success);
            emitted += 1;
          }
        }
        return { total: collection.meta?.page?.total ?? emitted };
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const params = paginationCodec.encode(options.pagination);
        const depthParam = `filter[depth]=${options.depth}`;
        const path = folderKey
          ? `/atom-summaries/${encodeURIComponent(folderKey)}?${params}&${depthParam}`
          : `/atom-summaries?${params}&${depthParam}`;
        const json = yield* this.fetchJson(path);
        const collection = json as unknown as JsonApiCollectionResponse;
        for (const w of warningsFromMeta(collection.meta)) yield* emit.recoverableError(w);
        let emitted = 0;
        for (const item of collection.data) {
          const decoded = yield* Effect.result(
            Effect.try({
              try: () => atomSummaryFromJsonApi(decodeJsonApiAtomSummary(item) as JsonApiAtomSummary),
              catch: e => new InvalidData((e as { message?: string }).message ?? 'Invalid JSON:API response'),
            }),
          );
          if (decoded._tag === 'Failure') {
            yield* emit.recoverableError(decoded.failure);
          } else {
            yield* emit.data(decoded.success);
            emitted += 1;
          }
        }
        return { total: collection.meta?.page?.total ?? emitted };
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const operations = keys.map(key => ({
          op: 'remove' as const,
          ref: { type: 'atom' as const, id: key },
        }));
        const json = yield* this.fetchJson(`/operations`, {
          method: 'POST',
          body: { 'atomic:operations': operations },
        });
        // Top-level meta.warnings ride alongside batch-level warnings (e.g.
        // upstream listed but couldn't fully enumerate).
        for (const w of warningsFromMeta(json.meta)) yield* emit.recoverableError(w);
        const results = (json['atomic:results'] as
          | Array<{ errors?: unknown, meta?: unknown }>
          | undefined) ?? [];
        let removed = 0;
        let skipped = 0;
        for (let i = 0; i < results.length; i++) {
          const entry = results[i]!;
          // Per-entry meta.warnings: a successful remove may still have
          // surfaced a warning (e.g. an orphaned sidecar couldn't be cleaned
          // up). Forward them regardless of success/failure of the op itself.
          for (const w of warningsFromMeta(entry.meta)) yield* emit.recoverableError(w);
          if (entry.errors) {
            yield* emit.recoverableError(new InvalidData(`Failed to remove "${keys[i]}"`));
            skipped += 1;
          } else {
            yield* emit.data(keys[i]!);
            removed += 1;
          }
        }
        return { removed, skipped };
      })
    );
  }

  /**
   * Cached upstream capabilities. The remote storage-api exposes
   * `GET /capabilities` returning the real capabilities of the backing
   * repository (filesystem vs R2 vs GitHub, etc.), so we fetch + cache it
   * per repo instance. Falls back to a safe minimal default if the upstream
   * doesn't speak the endpoint yet.
   */
  private cachedCapabilities?: Capabilities;

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.make<Capabilities>(() =>
      Effect.gen({ self: this }, function*() {
        if (this.cachedCapabilities) return this.cachedCapabilities;
        const r = yield* Effect.result(this.fetchJson('/capabilities'));
        if (r._tag === 'Success') {
          const data = (r.success.data as { attributes?: Capabilities } | undefined)?.attributes;
          if (data) {
            this.cachedCapabilities = data;
            return data;
          }
        }
        // Upstream may be an older server without /capabilities — bail to a
        // conservative default that says "pagination is whatever the remote
        // supports, file extensions are handled remotely".
        const fallback: Capabilities = {
          compatibilityDate: CompatibilityDate.make('2026-05-11'),
          fileExtensions: {
            supported: false,
            description:
              'Upstream storage-api did not expose /capabilities. File-extension support is delegated to the remote.',
          },
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
}
