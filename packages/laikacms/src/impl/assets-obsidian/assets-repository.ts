import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { Readable } from 'node:stream';

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
  extNameToMimeType,
  type LaikaDone,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type { Folder, FolderCreate, Key } from 'laikacms/storage';
import { applyPagination, naturalCompare } from 'laikacms/storage';

/** Lift a `Promise<LaikaResult<A>>` into `Effect<A, LaikaError>`. */
const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/** Drain any supported binary content into a single `Uint8Array`. */
async function consumeBinary(
  content: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);

  const reader = content.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Map a Node filesystem error to a `LaikaError`. */
function fsError(error: unknown, key: string): LaikaError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return new NotFoundError(`Asset '${key}' not found in the vault`);
  const message = error instanceof Error ? error.message : String(error);
  return new BadRequestError(`Filesystem error for '${key}': ${message}`);
}

/**
 * Configuration for {@link ObsidianAssetsRepository}.
 */
export interface ObsidianAssetsRepositoryOptions {
  /**
   * Subdirectory of the vault treated as the asset root — e.g. Obsidian's
   * configured attachments folder. Asset keys are resolved relative to it.
   * Defaults to the vault root.
   */
  attachmentsDirectory?: string;
  /**
   * File extensions (without the leading dot) excluded from listings and
   * lookups because they belong to the documents layer. Defaults to `['md']`.
   */
  documentExtensions?: string[];
  /**
   * Directory / file basenames skipped while listing. Defaults to Obsidian and
   * VCS housekeeping entries.
   */
  ignore?: string[];
  /**
   * Builds a serving URL for an asset key. Defaults to returning the key
   * unchanged — supply this to point at a static host or CDN.
   */
  createUrl?: (key: string) => string;
}

const DEFAULT_IGNORE = ['.obsidian', '.trash', '.git', '.DS_Store', 'Thumbs.db'];

/**
 * An {@link AssetsRepository} backed by the files of an Obsidian vault.
 *
 * Every non-markdown file in the vault (images, PDFs, audio, ...) is exposed as
 * an `Asset` keyed by its path relative to the asset root. This is intended for
 * *retrieving* attachments that already live alongside your notes; writing
 * assets back into a vault bloats whatever syncs it (git, Obsidian Sync), so
 * for write-heavy workloads prefer an object-storage backend such as
 * `assets-r2`.
 *
 * An Obsidian vault has no place to keep per-file custom metadata or cache
 * headers, so `updateAsset` is unsupported — replace the file via
 * `createAsset` instead.
 */
export class ObsidianAssetsRepository extends AssetsRepository {
  private readonly assetRoot: string;
  private readonly documentExtensions: ReadonlySet<string>;
  private readonly ignore: ReadonlySet<string>;
  private readonly createUrlFn?: (key: string) => string;

  constructor(vaultPath: string, options: ObsidianAssetsRepositoryOptions = {}) {
    super();
    this.assetRoot = nodePath.resolve(
      vaultPath,
      options.attachmentsDirectory ?? '',
    );
    this.documentExtensions = new Set(
      (options.documentExtensions ?? ['md']).map(ext => ext.replace(/^\./, '').toLowerCase()),
    );
    this.ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
    this.createUrlFn = options.createUrl;
  }

  // ===== Path helpers =====

  /** Resolve an asset key to an absolute path, rejecting traversal outside the root. */
  private toFsPath(key: string): LaikaResult<string> {
    const normalized = key.replace(/^\/+/, '');
    const resolved = nodePath.resolve(this.assetRoot, normalized);
    if (resolved !== this.assetRoot && !resolved.startsWith(this.assetRoot + nodePath.sep)) {
      return Result.fail(new BadRequestError(`Asset key '${key}' escapes the vault root`));
    }
    return Result.succeed(resolved);
  }

  /** Convert an absolute path back into a forward-slash asset key. */
  private toKey(fsPath: string): string {
    const rel = nodePath.relative(this.assetRoot, fsPath);
    return rel.split(nodePath.sep).join('/');
  }

  private extensionOf(key: string): string {
    return nodePath.extname(key).replace(/^\./, '').toLowerCase();
  }

  private isDocument(key: string): boolean {
    return this.documentExtensions.has(this.extensionOf(key));
  }

  private mimeTypeOf(key: string): string {
    const ext = nodePath.extname(key).toLowerCase();
    return ext ? extNameToMimeType(ext) : 'application/octet-stream';
  }

  // ===== Mapping =====

  private async statAsset(key: string): Promise<LaikaResult<Asset>> {
    const pathResult = this.toFsPath(key);
    if (Result.isFailure(pathResult)) return Result.fail(pathResult.failure);
    if (this.isDocument(key)) {
      return Result.fail(
        new BadRequestError(`'${key}' is a document, not an asset`),
      );
    }
    try {
      const stat = await fs.stat(pathResult.success);
      if (!stat.isFile()) {
        return Result.fail(new NotFoundError(`Asset '${key}' is not a file`));
      }
      return Result.succeed(this.assetFromStat(key, stat));
    } catch (error) {
      return Result.fail(fsError(error, key));
    }
  }

  private assetFromStat(key: string, stat: import('node:fs').Stats): Asset {
    return {
      type: 'asset',
      key,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      content: {
        size: stat.size,
        mimeType: this.mimeTypeOf(key),
        extension: this.extensionOf(key),
        filename: nodePath.basename(key),
      },
    };
  }

  private folderFromStat(key: string, stat: import('node:fs').Stats): Folder {
    return {
      type: 'folder',
      key,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  // ===== Capabilities =====

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.succeed<AssetsCapabilities>({
      compatibilityDate: AssetsCompatibilityDate.make('2026-05-19'),
      pagination: {
        supported: true,
        description: 'In-memory slicing applied after the directory walk; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }

  // ===== Resources =====

  getResource(
    key: string,
    _options?: GetResourceOptions,
  ): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        const fsPath = yield* Effect.fromResult(this.toFsPath(key));
        const stat = yield* liftResult(
          fs.stat(fsPath).then(Result.succeed, e => Result.fail(fsError(e, key))),
        );
        if (stat.isDirectory()) return [this.folderFromStat(key, stat) as Resource];
        if (stat.isFile() && !this.isDocument(key)) {
          return [this.assetFromStat(key, stat) as Resource];
        }
        return yield* Effect.fail(new NotFoundError(`No asset or folder at '${key}'`));
      })
    );
  }

  listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): LaikaStream.LaikaStream<Resource, ListResourcesDone> {
    return LaikaStream.make<Resource, ListResourcesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const maxDepth = Math.max(1, options.depth ?? 1);
        const collected = yield* liftResult(this.walk(folderKey, maxDepth));
        const sorted = [...collected].sort((a, b) => naturalCompare(a.key, b.key));
        const page = applyPagination(sorted, options.pagination);
        for (const resource of page) yield* emit.data(resource);
        return { total: page.length };
      })
    );
  }

  /** Recursively collect assets and folders under `folderKey` up to `maxDepth` levels. */
  private async walk(folderKey: string, maxDepth: number): Promise<LaikaResult<Resource[]>> {
    const pathResult = this.toFsPath(folderKey);
    if (Result.isFailure(pathResult)) return Result.fail(pathResult.failure);

    const out: Resource[] = [];
    const visit = async (dirPath: string, depth: number): Promise<LaikaError | undefined> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch (error) {
        return fsError(error, this.toKey(dirPath));
      }
      for (const entry of entries) {
        if (this.ignore.has(entry.name)) continue;
        const childPath = nodePath.join(dirPath, entry.name);
        const childKey = this.toKey(childPath);
        let stat: import('node:fs').Stats;
        try {
          stat = await fs.stat(childPath);
        } catch {
          continue; // Skip entries that vanished mid-walk (e.g. broken symlinks).
        }
        if (entry.isDirectory()) {
          out.push(this.folderFromStat(childKey, stat));
          if (depth < maxDepth) await visit(childPath, depth + 1);
        } else if (entry.isFile() && !this.isDocument(childKey)) {
          out.push(this.assetFromStat(childKey, stat));
        }
      }
      return undefined;
    };

    const error = await visit(pathResult.success, 1);
    if (error) return Result.fail(error);
    return Result.succeed(out);
  }

  // ===== Assets =====

  getAsset(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() => liftResult(this.statAsset(key)));
  }

  /**
   * Stream an asset's bytes — for HTTP handlers that serve the file directly.
   * Returns a `LaikaResult` rather than a `LaikaTask` because the body is a
   * live stream the caller must consume.
   */
  async getAssetContent(
    key: string,
  ): Promise<LaikaResult<{ body: ReadableStream<Uint8Array>, contentType: string, size: number }>> {
    const pathResult = this.toFsPath(key);
    if (Result.isFailure(pathResult)) return Result.fail(pathResult.failure);
    if (this.isDocument(key)) {
      return Result.fail(new BadRequestError(`'${key}' is a document, not an asset`));
    }
    try {
      const stat = await fs.stat(pathResult.success);
      if (!stat.isFile()) return Result.fail(new NotFoundError(`Asset '${key}' is not a file`));
      const body = Readable.toWeb(
        createReadStream(pathResult.success),
      ) as ReadableStream<Uint8Array>;
      return Result.succeed({ body, contentType: this.mimeTypeOf(key), size: stat.size });
    } catch (error) {
      return Result.fail(fsError(error, key));
    }
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        if (this.isDocument(create.key)) {
          return yield* Effect.fail(
            new BadRequestError(
              `Refusing to write '${create.key}': that extension belongs to the documents layer`,
            ),
          );
        }
        const fsPath = yield* Effect.fromResult(this.toFsPath(create.key));
        const bytes = yield* Effect.promise(() => consumeBinary(create.content));
        yield* liftResult(
          (async (): Promise<LaikaResult<void>> => {
            try {
              await fs.mkdir(nodePath.dirname(fsPath), { recursive: true });
              await fs.writeFile(fsPath, bytes);
              return Result.succeed(undefined);
            } catch (error) {
              return Result.fail(fsError(error, create.key));
            }
          })(),
        );
        return yield* liftResult(this.statAsset(create.key));
      })
    );
  }

  /**
   * Unsupported: an Obsidian vault stores no per-file custom metadata or cache
   * headers, so there is nothing for an update to change. Replace the file with
   * {@link createAsset} instead.
   */
  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.fail(
      new BadRequestError(
        `Cannot update asset '${update.key}': an Obsidian vault keeps no per-file metadata. `
          + 'Replace the file with createAsset instead.',
      ),
    );
  }

  deleteAsset(key: Key): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const fsPath = yield* Effect.fromResult(this.toFsPath(key));
        yield* liftResult(
          fs.rm(fsPath, { force: false }).then(
            () => Result.succeed(undefined),
            e => Result.fail(fsError(e, key)),
          ),
        );
      })
    );
  }

  deleteAssets(keys: readonly Key[]): LaikaStream.LaikaStream<Key, DeleteAssetsDone> {
    return LaikaStream.make<Key, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const result = yield* Effect.result(LaikaTask.runValue(this.deleteAsset(key)));
          if (Result.isFailure(result)) {
            yield* emit.recoverableError(result.failure);
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

  /** No transformation pipeline — an Obsidian vault holds originals only. */
  getVariations(assets: Asset[]): LaikaStream.LaikaStream<AssetVariations, LaikaDone> {
    return LaikaStream.make<AssetVariations, LaikaDone>(emit =>
      Effect.gen(function*() {
        for (const asset of assets) yield* emit.data({ key: asset.key, variations: {} });
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
            url: this.createUrlFn ? this.createUrlFn(asset.key) : asset.key,
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
          const result = yield* Effect.result(liftResult(this.statAsset(asset.key)));
          if (Result.isFailure(result)) {
            yield* emit.recoverableError(result.failure);
            continue;
          }
          const fresh = result.success;
          const metadata: AssetMetadataContent = {
            kind: 'binary',
            size: typeof fresh.content.size === 'number' ? fresh.content.size : 0,
            mimeType: this.mimeTypeOf(asset.key),
            extension: this.extensionOf(asset.key),
            filename: nodePath.basename(asset.key),
          };
          yield* emit.data({ key: asset.key, metadata });
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  // ===== Folders =====

  getFolder(key: Key): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const fsPath = yield* Effect.fromResult(this.toFsPath(key));
        const stat = yield* liftResult(
          fs.stat(fsPath).then(Result.succeed, e => Result.fail(fsError(e, key))),
        );
        if (!stat.isDirectory()) {
          return yield* Effect.fail(new NotFoundError(`'${key}' is not a folder`));
        }
        return this.folderFromStat(key, stat);
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const fsPath = yield* Effect.fromResult(this.toFsPath(folderCreate.key));
        yield* liftResult(
          fs.mkdir(fsPath, { recursive: true }).then(
            () => Result.succeed(undefined),
            e => Result.fail(fsError(e, folderCreate.key)),
          ),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  deleteFolder(key: string, recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const fsPath = yield* Effect.fromResult(this.toFsPath(key));
        yield* liftResult(
          fs.rm(fsPath, { recursive: recursive ?? false, force: false }).then(
            () => Result.succeed(undefined),
            e => Result.fail(fsError(e, key)),
          ),
        );
      })
    );
  }
}
