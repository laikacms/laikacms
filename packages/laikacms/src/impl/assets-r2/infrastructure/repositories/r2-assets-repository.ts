import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import type {
  Asset,
  AssetCreate,
  AssetMetadata,
  AssetMetadataContent,
  AssetsCapabilities,
  AssetUpdate,
  AssetUrl,
  AssetVariation,
  AssetVariations,
  DeleteAssetsDone,
  GetResourceOptions,
  ListResourcesDone,
  ListResourcesOptions,
  Resource,
} from 'laikacms/assets';
import { AssetsCompatibilityDate, AssetsRepository, validateListFilters } from 'laikacms/assets';
import {
  BadRequestError,
  type LaikaDone,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type { Sanitizer } from 'laikacms/sanitizer';
import type { Folder, FolderCreate } from 'laikacms/storage';
import { applyPagination } from 'laikacms/storage';

import { R2AssetsDataSource } from '../datasources/r2-assets-datasource.js';

const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/**
 * Filters honored by `listResources`, advertised via
 * `getCapabilities().filtering`. Extend by appending descriptors and handling
 * the new name in `buildKeyPredicate` — nothing else needs to change.
 */
const SUPPORTED_LIST_FILTERS = [
  {
    name: 'search',
    description: 'Case-insensitive substring match on the object key.',
  },
] as const;

/** Compose declared filters into a single key predicate. */
function buildKeyPredicate(filters: Readonly<Record<string, string>> | undefined): (key: string) => boolean {
  const search = filters?.['search']?.toLowerCase();
  if (!search) return () => true;
  return key => key.toLowerCase().includes(search);
}

const R2_FILTERING_CAPABILITY = {
  supported: true,
  description: 'Filters compose (AND) and apply to resource keys during listing.',
  filters: SUPPORTED_LIST_FILTERS,
} as const;

export type R2AssetsRepositoryOptions =
  | {
    bucket: R2Bucket,
    sanitizer: Sanitizer,
    createUrl?: (key: string) => string,
    createVariations?: (key: string) => Record<string, AssetVariation>,
  }
  | {
    bucket: R2Bucket,
    dangerouslyAllowAllFiles: true,
    createUrl?: (key: string) => string,
    createVariations?: (key: string) => Record<string, AssetVariation>,
  };

export class R2AssetsRepository extends AssetsRepository {
  private readonly datasource: R2AssetsDataSource;
  private readonly createUrl?: (key: string) => string;
  private readonly createVariations?: (key: string) => Record<string, AssetVariation>;
  private readonly sanitizer?: Sanitizer;

  constructor(options: R2AssetsRepositoryOptions) {
    super();
    if (
      !('sanitizer' in options) && !('dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true)
    ) {
      throw new Error(
        'R2AssetsRepository requires either a `sanitizer` to strip privacy-sensitive metadata from files, '
          + 'or `dangerouslyAllowAllFiles: true` to explicitly bypass sanitization. '
          + 'See https://docs.laika-cms.com/security/file-sanitization for more information.',
      );
    }
    this.datasource = new R2AssetsDataSource(options.bucket);
    this.createUrl = options.createUrl;
    this.createVariations = options.createVariations;
    this.sanitizer = 'dangerouslyAllowAllFiles' in options ? undefined : options.sanitizer;
  }

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.succeed<AssetsCapabilities>({
      compatibilityDate: AssetsCompatibilityDate.make('2026-05-11'),
      pagination: {
        supported: true,
        description: "Cursor pagination (`after`) maps to R2's native list cursor: each page is one R2 list call, "
          + 'no full walk. Cursor pages list recursively in flat key order and emit assets only (no folder '
          + 'resources); `depth` is honored by dropping deeper keys. Offset/page styles fall back to in-memory '
          + 'slicing after a full recursive walk. Backward cursors (`before`) are not supported.',
        styles: { offset: true, page: true, cursor: true },
      },
      filtering: R2_FILTERING_CAPABILITY,
      versionTracking: {
        supported: false,
        description: 'R2 ETags are not surfaced as version tokens.',
      },
      changes: {
        supported: false,
        description: 'R2 offers no change feed; getSyncToken/listChanges are not implemented.',
      },
    });
  }

  getResource(
    key: string,
    _options?: GetResourceOptions,
  ): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* Effect.promise(() => this.datasource.exists(key));
        if (exists) {
          const asset = yield* LaikaTask.runValue(this.getAsset(key, _options));
          return [asset as Resource];
        }
        const isDir = yield* Effect.promise(() => this.datasource.isDirectory(key));
        if (isDir) {
          const folder = yield* LaikaTask.runValue(this.getFolder(key));
          return [folder as Resource];
        }
        return yield* Effect.fail(new NotFoundError(`Resource at ${key} does not exist`));
      })
    );
  }

  listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): LaikaStream.LaikaStream<Resource, ListResourcesDone> {
    return LaikaStream.make<Resource, ListResourcesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const filterError = validateListFilters(options.filters, R2_FILTERING_CAPABILITY);
        if (filterError) {
          return yield* Effect.fail(filterError);
        }
        const hasFilters = Object.keys(options.filters ?? {}).length > 0;
        const matchesKey = buildKeyPredicate(options.filters);
        const depth = Math.max(1, options.depth ?? 1);

        // Forward-cursor pagination maps to R2's native list cursor: one R2
        // list call per requested page instead of a full recursive walk per
        // page. Lists recursively (no delimiter) in flat key order, emitting
        // assets only; `depth` is honored by dropping deeper keys. With
        // filters, batches keep being fetched until the page fills or the
        // listing is exhausted — pages only ever end on an R2 batch boundary,
        // so the returned cursor never skips unemitted matches (a filtered
        // page may therefore carry slightly more than `perPage` items).
        if ('after' in options.pagination) {
          const perPage = options.pagination.perPage ?? 100;
          const batchLimit = hasFilters ? Math.max(perPage, 500) : perPage;
          const normalizedFolder = folderKey.replace(/^\/+|\/+$/g, '');
          const searchPrefix = normalizedFolder ? `${normalizedFolder}/` : '';
          const withinDepth = (key: string): boolean =>
            depth === Infinity || key.slice(searchPrefix.length).split('/').length <= depth;

          let cursor: string | undefined = options.pagination.after;
          let emitted = 0;
          while (true) {
            const page = yield* liftResult(
              this.datasource.listPage(folderKey, { cursor, limit: batchLimit, includeMetadata: true }),
            );
            for (const entry of page.entries) {
              if (!withinDepth(entry.key)) continue;
              if (!matchesKey(entry.key)) continue;
              yield* emit.data({
                type: 'asset',
                key: entry.key,
                createdAt: entry.uploaded?.toISOString() ?? new Date().toISOString(),
                updatedAt: entry.uploaded?.toISOString() ?? new Date().toISOString(),
                content: {
                  size: entry.size,
                  etag: entry.etag,
                  contentType: entry.httpMetadata?.contentType,
                  customMetadata: entry.customMetadata,
                },
              });
              emitted++;
            }
            cursor = page.cursor;
            if (cursor === undefined) {
              // Exhausted: no next-page pagination on the done value.
              return {};
            }
            if (emitted >= perPage) {
              return { pagination: { after: cursor, perPage } };
            }
          }
        }

        const listDirectory = (key: string): Effect.Effect<ReadonlyArray<Resource>, LaikaError> =>
          Effect.gen({ self: this }, function*() {
            const entries = yield* liftResult(
              this.datasource.listDirectory(key, { includeMetadata: true }),
            );
            return entries.map((entry): Resource => {
              if (entry.type === 'file') {
                return {
                  type: 'asset',
                  key: entry.key,
                  createdAt: entry.uploaded?.toISOString() ?? new Date().toISOString(),
                  updatedAt: entry.uploaded?.toISOString() ?? new Date().toISOString(),
                  content: {
                    size: entry.size,
                    etag: entry.etag,
                    contentType: entry.httpMetadata?.contentType,
                    customMetadata: entry.customMetadata,
                  },
                };
              }
              return {
                type: 'folder',
                key: entry.key,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            });
          });

        const listRecursive = (
          key: string,
          currentDepth: number,
        ): Effect.Effect<ReadonlyArray<Resource>, LaikaError> =>
          Effect.gen(function*() {
            const resources = [...(yield* listDirectory(key))];
            if (currentDepth < depth) {
              const folders = resources.filter(r => r.type === 'folder');
              for (const folder of folders) {
                const sub = yield* Effect.result(listRecursive(folder.key, currentDepth + 1));
                if (Result.isSuccess(sub)) {
                  resources.push(...sub.success);
                } else {
                  yield* emit.recoverableError(sub.failure);
                }
              }
            }
            return resources;
          });

        const all = yield* listRecursive(folderKey, 1);
        const filtered = hasFilters ? all.filter(r => matchesKey(r.key)) : all;
        const paginated = applyPagination(filtered, options.pagination);
        for (const r of paginated) yield* emit.data(r);
        return { total: filtered.length };
      })
    );
  }

  getAsset(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.datasource.getObjectMeta(key));
        return {
          type: 'asset',
          key: meta.key,
          createdAt: meta.uploaded.toISOString(),
          updatedAt: meta.uploaded.toISOString(),
          content: {
            size: meta.size,
            etag: meta.etag,
            contentType: meta.contentType,
            customMetadata: meta.customMetadata,
          },
        } satisfies Asset;
      })
    );
  }

  /** Direct (non-LaikaTask) access to asset content body for HTTP handlers. */
  async getAssetContent(
    key: string,
  ): Promise<LaikaResult<{ body: ArrayBuffer | ReadableStream, contentType: string, size: number }>> {
    const bodyResult = await this.datasource.getObjectBody(key);
    if (Result.isFailure(bodyResult)) return Result.fail(bodyResult.failure);
    return Result.succeed({
      body: bodyResult.success.body,
      contentType: bodyResult.success.meta.contentType || 'application/octet-stream',
      size: bodyResult.success.meta.size,
    });
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(emit =>
      Effect.gen({ self: this }, function*() {
        let body: Uint8Array;

        if (create.content instanceof ArrayBuffer) {
          body = new Uint8Array(create.content);
        } else if (create.content instanceof Uint8Array) {
          body = create.content;
        } else if (create.content instanceof ReadableStream) {
          body = yield* Effect.promise(async () => {
            const reader = (create.content as ReadableStream<Uint8Array>).getReader();
            const chunks: Uint8Array[] = [];
            let totalSize = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              totalSize += value.byteLength;
            }
            const combined = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return combined;
          });
        } else {
          return yield* Effect.fail(
            new BadRequestError('Content must be ArrayBuffer, Uint8Array, or ReadableStream'),
          );
        }

        if (this.sanitizer) {
          const sanitizeResult = yield* Effect.promise(() => this.sanitizer!.sanitize(body, {}, create.mimeType));
          body = sanitizeResult.data;
        }

        yield* liftResult(
          this.datasource.putObject(create.key, body, {
            contentType: create.mimeType,
            cacheControl: create.cacheControl,
            customMetadata: create.customMetadata,
          }),
        );
        return yield* this.readbackOrSynthesizeAsset(create.key, body.byteLength, create, emit);
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.datasource.getObjectBody(update.key));
        yield* liftResult(
          this.datasource.putObject(update.key, existing.body, {
            contentType: update.mimeType || existing.meta.contentType || 'application/octet-stream',
            cacheControl: update.cacheControl,
            customMetadata: update.customMetadata || existing.meta.customMetadata,
          }),
        );
        return yield* this.readbackOrSynthesizeAsset(
          update.key,
          existing.meta.size,
          { mimeType: update.mimeType ?? existing.meta.contentType, customMetadata: update.customMetadata },
          emit,
        );
      })
    );
  }

  /**
   * After a confirmed-successful putObject, try `getAsset` to return the
   * canonical server-side view. If R2's eventual-consistency window means
   * the readback fails, emit a recoverableError and synthesize the Asset
   * from the write input — the bytes we wrote ARE durable, so failing
   * fatally would be misleading. Timestamps are synthesized (the only
   * fields we can't recover); key, size, content-type are authoritative.
   */
  private readbackOrSynthesizeAsset(
    key: string,
    size: number,
    hints: { mimeType?: string | undefined, customMetadata?: Record<string, string> | undefined },
    emit: LaikaTask.LaikaTaskEmit,
  ): Effect.Effect<Asset, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const readback = yield* Effect.result(LaikaTask.runValueForwarding(this.getAsset(key), emit));
      if (readback._tag === 'Success') return readback.success;
      yield* emit.recoverableError(readback.failure);
      const now = new Date().toISOString();
      return {
        type: 'asset' as const,
        key,
        createdAt: now,
        updatedAt: now,
        content: {
          size,
          etag: undefined as unknown as string,
          contentType: hints.mimeType,
          customMetadata: hints.customMetadata,
        },
      } satisfies Asset;
    });
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.datasource.deleteObject(key));
      })
    );
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const results = yield* Effect.promise(async () => {
          const out: LaikaResult<string>[] = [];
          for await (const r of this.datasource.deleteObjects(keys)) out.push(r);
          return out;
        });
        let removed = 0;
        let skipped = 0;
        for (const r of results) {
          if (Result.isFailure(r)) {
            yield* emit.recoverableError(r.failure);
            skipped += 1;
            continue;
          }
          yield* emit.data(r.success);
          removed += 1;
        }
        return { removed, skipped };
      })
    );
  }

  getVariations(assets: Asset[]): LaikaStream.LaikaStream<AssetVariations, LaikaDone> {
    return LaikaStream.make<AssetVariations, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          yield* emit.data({
            key: asset.key,
            variations: this.createVariations ? this.createVariations(asset.key) : {},
          });
        }
        return { total: assets.length };
      })
    );
  }

  getUrls(assets: Asset[]): LaikaStream.LaikaStream<AssetUrl, LaikaDone> {
    return LaikaStream.make<AssetUrl, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          yield* emit.data({
            key: asset.key,
            url: this.createUrl ? this.createUrl(asset.key) : asset.key,
          });
        }
        return { total: assets.length };
      })
    );
  }

  getMetadata(assets: Asset[]): LaikaStream.LaikaStream<AssetMetadata, LaikaDone> {
    return LaikaStream.make<AssetMetadata, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let emitted = 0;
        for (const asset of assets) {
          const metaR = yield* Effect.result(liftResult(this.datasource.getObjectMeta(asset.key)));
          if (Result.isFailure(metaR)) {
            yield* emit.recoverableError(metaR.failure);
            continue;
          }
          const meta = metaR.success;
          const metadata: AssetMetadataContent = {
            size: meta.size,
            kind: 'binary',
            mimeType: meta.contentType || 'application/octet-stream',
          };
          yield* emit.data({ key: meta.key, metadata });
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.datasource.getFolderMeta(key));
        return {
          type: 'folder',
          key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
        } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.datasource.createFolder(folderCreate.key));
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  deleteFolder(key: string, recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.datasource.deleteFolder(key, recursive));
      })
    );
  }
}
