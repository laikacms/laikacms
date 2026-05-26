import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  type Asset,
  type AssetCreate,
  type AssetMetadata,
  type AssetMetadataContent,
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
import type { ContentBaseSettingsProvider, MediaCollectionSettings } from 'laikacms/contentbase-settings';
import type { LaikaDone, LaikaError, LaikaResult } from 'laikacms/core';
import { BadRequestError, LaikaStream, LaikaTask } from 'laikacms/core';
import type { Atom, AtomSummary, Folder, FolderCreate, StorageRepository } from 'laikacms/storage';
import { pathCombine, pathToSegments } from 'laikacms/storage';

/** Lift a Promise<LaikaResult<A>> into Effect<A, LaikaError>. */
const liftPromiseResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/** Encode a Uint8Array to a base64 string. Works in Node and Workers (no Buffer dep). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Drain a BinaryContent into a single Uint8Array. */
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

/**
 * ContentBase-backed AssetsRepository.
 *
 * Asset binary content is persisted through a `StorageRepository` by encoding the bytes
 * as base64 inside a `StorageObjectContent` payload (alongside `mimeType`, `size`, and
 * optional metadata). Logical asset keys are `<collection>/<rest>`.
 */
export class ContentBaseAssetsRepository extends AssetsRepository {
  constructor(
    private readonly storageRepository: StorageRepository,
    private readonly settingsProvider: ContentBaseSettingsProvider,
  ) {
    super();
  }

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.make<AssetsCapabilities>(() =>
      Effect.gen({ self: this }, function*() {
        const caps = yield* LaikaTask.runValue(this.storageRepository.getCapabilities());
        return {
          compatibilityDate: AssetsCompatibilityDate.make('2026-05-11'),
          pagination: caps.pagination,
        };
      })
    );
  }

  /** Split a logical key into its collection prefix and the remainder. */
  private parseKey(key: string): { collection: string, remainder: string } {
    const segments = pathToSegments(key);
    if (segments.length === 0) return { collection: '', remainder: '' };
    const [collection, ...rest] = segments;
    return { collection, remainder: rest.length > 0 ? pathCombine(...rest) : '' };
  }

  /** Resolve a collection name to its underlying directory and settings. */
  private async resolveCollection(
    collection: string,
  ): Promise<LaikaResult<{ directory: string, settings: MediaCollectionSettings }>> {
    const settings = await this.settingsProvider.getMediaCollectionSettings(collection);
    if (Result.isFailure(settings)) return Result.fail(settings.failure);
    const directory = settings.success.directory ?? collection;
    return Result.succeed({ directory, settings: settings.success });
  }

  /** Resolve a logical asset key to its physical storage path plus collection settings. */
  private async getAssetPath(key: string): Promise<
    LaikaResult<{
      physical: string,
      directory: string,
      collection: string,
      settings: MediaCollectionSettings,
    }>
  > {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Asset key '${key}' is missing a collection prefix`));
    }
    const resolved = await this.resolveCollection(collection);
    if (Result.isFailure(resolved)) return Result.fail(resolved.failure);
    const { directory, settings } = resolved.success;
    const physical = remainder ? pathCombine(directory, remainder) : directory;
    return Result.succeed({ physical, directory, collection, settings });
  }

  /** Convert a physical storage path back to a logical key. */
  private extractKeyFromPath(fullPath: string, directory: string, collection: string): string {
    const physSegments = pathToSegments(fullPath);
    const dirSegments = pathToSegments(directory);
    let stripped = physSegments;
    if (
      dirSegments.length <= physSegments.length
      && dirSegments.every((segment, i) => segment === physSegments[i])
    ) {
      stripped = physSegments.slice(dirSegments.length);
    }
    return stripped.length > 0 ? pathCombine(collection, ...stripped) : collection;
  }

  /** Render a `MediaCollectionSettings.url` template against an asset key. */
  private renderUrlTemplate(template: string, logicalKey: string): string {
    const segments = pathToSegments(logicalKey);
    const filename = segments.length > 0 ? segments[segments.length - 1]! : logicalKey;
    return template
      .replace(/\{key\}/g, logicalKey)
      .replace(/\{filename\}/g, filename)
      .replace(/\{path\}/g, logicalKey);
  }

  /** Build the public-facing asset content payload, stripping the base64 binary. */
  private toAssetContent(content: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {
      size: typeof content.size === 'number' ? content.size : 0,
      contentType: typeof content.mimeType === 'string' ? content.mimeType : 'application/octet-stream',
    };
    if (content.customMetadata && typeof content.customMetadata === 'object') {
      result.customMetadata = content.customMetadata;
    }
    return result;
  }

  private atomToResource(atom: Atom, directory: string, collection: string): Resource {
    const logicalKey = this.extractKeyFromPath(atom.key, directory, collection);
    if (atom.type === 'folder') {
      return { ...atom, key: logicalKey };
    }
    return {
      type: 'asset',
      key: logicalKey,
      createdAt: atom.createdAt,
      updatedAt: atom.updatedAt,
      content: this.toAssetContent(atom.content),
    };
  }

  private summaryToResource(atom: AtomSummary, directory: string, collection: string): Resource {
    const logicalKey = this.extractKeyFromPath(atom.key, directory, collection);
    if (atom.type === 'folder-summary') {
      return {
        type: 'folder',
        key: logicalKey,
        createdAt: atom.createdAt,
        updatedAt: atom.updatedAt,
      };
    }
    return {
      type: 'asset',
      key: logicalKey,
      createdAt: atom.createdAt,
      updatedAt: atom.updatedAt,
      content: {},
    };
  }

  // ===== Resource Operations =====

  getResource(
    key: string,
    _options?: GetResourceOptions,
  ): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(key));
        const atom = yield* LaikaTask.runValue(this.storageRepository.getAtom(path.physical));
        return [this.atomToResource(atom, path.directory, path.collection)];
      })
    );
  }

  listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): LaikaStream.LaikaStream<Resource, ListResourcesDone> {
    return LaikaStream.make<Resource, ListResourcesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { collection, remainder } = this.parseKey(folderKey);
        if (!collection) {
          return yield* Effect.fail(
            new BadRequestError(`folderKey '${folderKey}' is missing a collection prefix`),
          );
        }
        const resolved = yield* liftPromiseResult(this.resolveCollection(collection));
        const physicalFolder = remainder ? pathCombine(resolved.directory, remainder) : resolved.directory;

        const summaries = yield* Effect.map(
          LaikaStream.runCollect(this.storageRepository.listAtomSummaries(physicalFolder, {
            pagination: options.pagination,
            depth: options.depth,
          })),
          r => r.data,
        );

        let emitted = 0;
        for (const atom of summaries) {
          yield* emit.data(this.summaryToResource(atom, resolved.directory, collection));
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  // ===== Asset Operations =====

  getAsset(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(key));
        const obj = yield* LaikaTask.runValue(this.storageRepository.getObject(path.physical));
        return {
          type: 'asset',
          key,
          createdAt: obj.createdAt,
          updatedAt: obj.updatedAt,
          content: this.toAssetContent(obj.content),
        } satisfies Asset;
      })
    );
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(create.key));
        if (
          path.settings.accept && path.settings.accept.length > 0
          && !path.settings.accept.includes(create.mimeType)
        ) {
          return yield* Effect.fail(
            new BadRequestError(
              `MIME type '${create.mimeType}' is not allowed in collection '${path.settings.key}'. `
                + `Allowed: ${path.settings.accept.join(', ')}`,
            ),
          );
        }

        const bytes = yield* Effect.promise(() => consumeBinary(create.content));
        const storedContent: Record<string, unknown> = {
          data: bytesToBase64(bytes),
          mimeType: create.mimeType,
          size: bytes.byteLength,
        };
        if (create.filename) storedContent.filename = create.filename;
        if (create.customMetadata) storedContent.customMetadata = create.customMetadata;
        if (create.cacheControl) storedContent.cacheControl = create.cacheControl;

        const result = yield* LaikaTask.runValue(this.storageRepository.createOrUpdateObject({
          type: 'object',
          key: path.physical,
          content: storedContent,
        }));
        return {
          type: 'asset',
          key: create.key,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          content: this.toAssetContent(storedContent),
        };
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(update.key));
        const existing = yield* LaikaTask.runValue(this.storageRepository.getObject(path.physical));
        const merged: Record<string, unknown> = { ...existing.content };
        if (update.mimeType) merged.mimeType = update.mimeType;
        if (update.cacheControl) merged.cacheControl = update.cacheControl;
        if (update.customMetadata) merged.customMetadata = update.customMetadata;

        const result = yield* LaikaTask.runValue(this.storageRepository.updateObject({
          key: path.physical,
          content: merged,
        }));
        return {
          type: 'asset',
          key: update.key,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          content: this.toAssetContent(merged),
        };
      })
    );
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(key));
        yield* Effect.map(
          LaikaStream.runCollect(this.storageRepository.removeAtoms([path.physical])),
          r => r.data,
        );
      })
    );
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const physicalToLogical = new Map<string, string>();
        const physicalKeys: string[] = [];
        for (const key of keys) {
          const path = yield* Effect.result(liftPromiseResult(this.getAssetPath(key)));
          if (Result.isFailure(path)) {
            yield* emit.recoverableError(path.failure);
            continue;
          }
          physicalKeys.push(path.success.physical);
          physicalToLogical.set(path.success.physical, key);
        }
        if (physicalKeys.length === 0) return { removed: 0, skipped: keys.length };

        const removed = yield* Effect.map(
          LaikaStream.runCollect(this.storageRepository.removeAtoms(physicalKeys)),
          r => r.data,
        );
        let count = 0;
        for (const physical of removed) {
          yield* emit.data(physicalToLogical.get(physical) ?? physical);
          count += 1;
        }
        return { removed: count, skipped: keys.length - count };
      })
    );
  }

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
        let emitted = 0;
        for (const asset of assets) {
          const r = yield* Effect.result(liftPromiseResult(this.getAssetPath(asset.key)));
          if (Result.isFailure(r)) {
            yield* emit.recoverableError(r.failure);
            continue;
          }
          const url = r.success.settings.url
            ? this.renderUrlTemplate(r.success.settings.url, asset.key)
            : asset.key;
          yield* emit.data({ key: asset.key, url });
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
          const pathR = yield* Effect.result(liftPromiseResult(this.getAssetPath(asset.key)));
          if (Result.isFailure(pathR)) {
            yield* emit.recoverableError(pathR.failure);
            continue;
          }
          const objR = yield* Effect.result(
            LaikaTask.runValue(this.storageRepository.getObject(pathR.success.physical)),
          );
          if (Result.isFailure(objR)) {
            yield* emit.recoverableError(objR.failure);
            continue;
          }
          const content = objR.success.content;
          const metadata: AssetMetadataContent = {
            kind: 'binary',
            size: typeof content.size === 'number' ? content.size : 0,
            mimeType: typeof content.mimeType === 'string' ? content.mimeType : 'application/octet-stream',
            ...(typeof content.filename === 'string' ? { filename: content.filename } : {}),
          };
          yield* emit.data({ key: asset.key, metadata });
          emitted += 1;
        }
        return { total: emitted };
      })
    );
  }

  // ===== Folder Operations =====

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(key));
        const folder = yield* LaikaTask.runValue(this.storageRepository.getFolder(path.physical));
        return { ...folder, key };
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(folderCreate.key));
        const folder = yield* LaikaTask.runValue(this.storageRepository.createFolder({
          type: 'folder',
          key: path.physical,
        }));
        return { ...folder, key: folderCreate.key };
      })
    );
  }

  deleteFolder(key: string, _recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getAssetPath(key));
        yield* Effect.map(
          LaikaStream.runCollect(this.storageRepository.removeAtoms([path.physical])),
          r => r.data,
        );
      })
    );
  }
}
