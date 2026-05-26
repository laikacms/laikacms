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
  AssetVariations,
  DeleteAssetsDone,
  GetResourceOptions,
  ListResourcesDone,
  ListResourcesOptions,
  Resource,
} from 'laikacms/assets';
import { AssetsCompatibilityDate, AssetsRepository } from 'laikacms/assets';
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

interface R2AssetsRepositoryOptions {
  bucket: R2Bucket;
  sanitizer: Sanitizer | { dangerouslyAllowAllFiles: true };
  createUrl?: (url: string) => string;
}

export class R2AssetsRepository extends AssetsRepository {
  private readonly datasource: R2AssetsDataSource;
  private readonly createUrl?: (url: string) => string;
  private readonly sanitizer?: Sanitizer;

  constructor(options: R2AssetsRepositoryOptions) {
    super();
    const hasSanitizer = 'sanitizer' in options && options.sanitizer !== undefined;
    const hasDangerousFlag = 'dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true;
    if (!hasSanitizer && !hasDangerousFlag) {
      throw new Error(
        'R2AssetsRepository requires either a `sanitizer` to strip privacy-sensitive metadata from files, '
          + 'or `dangerouslyAllowAllFiles: true` to explicitly bypass sanitization. '
          + 'See https://docs.laika-cms.com/security/file-sanitization for more information.',
      );
    }

    this.datasource = new R2AssetsDataSource(options.bucket);
    this.createUrl = options.createUrl;
    const noSanitizer = 'dangerouslyAllowAllFiles' in options && options.dangerouslyAllowAllFiles === true;
    const sanitizer = noSanitizer ? undefined : options.sanitizer as Sanitizer;
    this.sanitizer = 'sanitizer' in options && !noSanitizer ? sanitizer : undefined;
  }

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.succeed<AssetsCapabilities>({
      compatibilityDate: AssetsCompatibilityDate.make('2026-05-11'),
      pagination: {
        supported: true,
        description: 'In-memory slicing applied after the full recursive walk; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
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
        const depth = Math.max(1, options.depth ?? 1);

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
                if (Result.isSuccess(sub)) resources.push(...sub.success);
                // Continue even if a subfolder fails
              }
            }
            return resources;
          });

        const all = yield* listRecursive(folderKey, 1);
        const paginated = applyPagination(all, options.pagination);
        for (const r of paginated) yield* emit.data(r);
        return { total: paginated.length };
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
    return LaikaTask.make<Asset>(() =>
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
        return yield* LaikaTask.runValue(this.getAsset(create.key));
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.datasource.getObjectBody(update.key));
        yield* liftResult(
          this.datasource.putObject(update.key, existing.body, {
            contentType: update.mimeType || existing.meta.contentType || 'application/octet-stream',
            cacheControl: update.cacheControl,
            customMetadata: update.customMetadata || existing.meta.customMetadata,
          }),
        );
        return yield* LaikaTask.runValue(this.getAsset(update.key));
      })
    );
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
      Effect.gen(function*() {
        for (const asset of assets) {
          yield* emit.data({ key: asset.key, variations: {} });
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
