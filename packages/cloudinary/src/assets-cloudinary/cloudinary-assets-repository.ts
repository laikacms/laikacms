import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  type LaikaDone,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
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
import { applyPagination, type Folder, type FolderCreate, naturalCompare } from 'laikacms/storage';

import { CloudinaryDataSource, type CloudinaryDataSourceOptions, type CloudinaryResource } from './cloudinary-datasource.js';

/** Declarative spec for a single Cloudinary URL transform. */
export interface CloudinaryVariationSpec {
  readonly name: string;
  /**
   * Cloudinary transformation string (e.g. `w_400,h_300,c_fill`). Inserted
   * verbatim into the delivery URL.
   */
  readonly transform: string;
  /** Optional fixed width — surfaced in the `AssetVariation`. */
  readonly width?: number;
  /** Optional fixed height — surfaced in the `AssetVariation`. */
  readonly height?: number;
  /** Optional MIME type override (e.g. `image/webp` when forcing a format). */
  readonly mimeType?: string;
}

/** Reasonable default variation set — six common transforms. */
export const DEFAULT_VARIATIONS: ReadonlyArray<CloudinaryVariationSpec> = [
  { name: 'thumbnail', transform: 'c_fill,w_150,h_150', width: 150, height: 150 },
  { name: 'small', transform: 'c_limit,w_400', width: 400 },
  { name: 'medium', transform: 'c_limit,w_800', width: 800 },
  { name: 'large', transform: 'c_limit,w_1600', width: 1600 },
  { name: 'webp', transform: 'f_webp,q_auto', mimeType: 'image/webp' },
  { name: 'avif', transform: 'f_avif,q_auto', mimeType: 'image/avif' },
];

export interface CloudinaryAssetsRepositoryOptions extends CloudinaryDataSourceOptions {
  /** Override the default variation set (six standard transforms). */
  readonly variations?: ReadonlyArray<CloudinaryVariationSpec>;
  /** Resource type to target for the repository. Defaults to `image`. */
  readonly resourceType?: 'image' | 'video' | 'raw';
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string; name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/** Pull a single content field out of an `Asset.content` defensively. */
const fieldOf = <T>(asset: Asset, key: string): T | undefined => {
  const value = (asset.content as Record<string, unknown>)[key];
  return value as T | undefined;
};

/**
 * An {@link AssetsRepository} backed by Cloudinary.
 *
 * Cloudinary is structured around **public ids** (path-like strings),
 * **formats** (stored separately from the id) and **transformations**
 * embedded in the delivery URL. This implementation maps each of those
 * onto the Laika `AssetsRepository` shape:
 *
 * - Asset key → Cloudinary `public_id` (`/` segments are real folders).
 * - `content` carries `{ publicId, version, format, resourceType, bytes,
 *   width?, height? }` so downstream code has everything it needs without
 *   another round-trip.
 * - `getUrls` and `getVariations` compute deterministic delivery URLs —
 *   no API call per call, every result is cache-friendly. The variation
 *   set is configurable; see {@link DEFAULT_VARIATIONS}.
 * - `getMetadata` returns the discriminated `ImageMetadata` union directly
 *   from the Admin API response.
 *
 * Auth: HTTP Basic for the Admin API + signed params for the Upload API.
 * Runtime-agnostic — only depends on `fetch` and Web Crypto.
 */
export class CloudinaryAssetsRepository extends AssetsRepository {
  private readonly dataSource: CloudinaryDataSource;
  private readonly variations: ReadonlyArray<CloudinaryVariationSpec>;
  private readonly resourceType: 'image' | 'video' | 'raw';

  constructor(options: CloudinaryAssetsRepositoryOptions) {
    super();
    this.dataSource = new CloudinaryDataSource(options);
    this.variations = options.variations ?? DEFAULT_VARIATIONS;
    this.resourceType = options.resourceType ?? 'image';
  }

  // -----------------------------------------------------------------------
  // Capability + helpers
  // -----------------------------------------------------------------------

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.succeed<AssetsCapabilities>({
      compatibilityDate: AssetsCompatibilityDate.make('2026-05-20'),
      pagination: {
        supported: true,
        description: 'In-memory slicing over the Cloudinary admin listing; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }

  /** Build the deterministic delivery URL for a resource + optional transform. */
  private deliveryUrl(resource: { publicId: string; version: number; format: string }, transform = ''): string {
    const parts = [
      this.dataSource.deliveryBase,
      this.dataSource.cloudName,
      this.resourceType,
      'upload',
    ];
    if (transform !== '') parts.push(transform);
    parts.push(`v${resource.version}`);
    parts.push(`${resource.publicId}.${resource.format}`);
    return parts.join('/');
  }

  /** Convert a raw Cloudinary resource into a Laika {@link Asset}. */
  private toAsset(resource: CloudinaryResource): Asset {
    return {
      type: 'asset',
      key: resource.public_id,
      createdAt: resource.created_at,
      updatedAt: resource.created_at,
      content: {
        publicId: resource.public_id,
        version: resource.version,
        format: resource.format,
        resourceType: resource.resource_type,
        bytes: resource.bytes,
        width: resource.width,
        height: resource.height,
        etag: resource.etag,
      },
    };
  }

  /** Convert a raw Cloudinary resource into an `ImageMetadata`-shaped payload. */
  private toMetadata(resource: CloudinaryResource): AssetMetadata {
    return {
      key: resource.public_id,
      metadata: resource.resource_type === 'image' && resource.width && resource.height
        ? {
          kind: 'image',
          size: resource.bytes,
          mimeType: `image/${resource.format}`,
          extension: resource.format,
          width: resource.width,
          height: resource.height,
          hash: resource.etag,
          hashAlgorithm: resource.etag ? 'etag' : undefined,
        } as AssetMetadata['metadata']
        : {
          kind: 'binary',
          size: resource.bytes,
          mimeType: `application/${resource.format}`,
          extension: resource.format,
          hash: resource.etag,
          hashAlgorithm: resource.etag ? 'etag' : undefined,
        } as AssetMetadata['metadata'],
    };
  }

  // -----------------------------------------------------------------------
  // Asset operations
  // -----------------------------------------------------------------------

  getAsset(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const resource = yield* liftResult(this.dataSource.getResource(key, this.resourceType));
        if (!resource) {
          return yield* Effect.fail(new NotFoundError(`No asset found at key "${key}"`));
        }
        return this.toAsset(resource);
      })
    );
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const uploaded = yield* liftResult(
          this.dataSource.upload(create.key, create.content, create.mimeType, {
            overwrite: false,
            resourceType: this.resourceType,
          }),
        );
        return this.toAsset(uploaded);
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        // Cloudinary's "update" surface is the context API; for now we treat
        // updateAsset as a confirm-exists + return-current call. Editing
        // mimeType / customMetadata would route through `/resources/.../context`,
        // which is straightforward to layer on top later.
        const resource = yield* liftResult(this.dataSource.getResource(update.key, this.resourceType));
        if (!resource) {
          return yield* Effect.fail(new NotFoundError(`No asset found at key "${update.key}"`));
        }
        return this.toAsset(resource);
      })
    );
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const deleted = yield* liftResult(this.dataSource.deleteResources([key], this.resourceType));
        const verdict = deleted[key];
        if (verdict !== 'deleted' && verdict !== 'not_found') {
          return yield* Effect.fail(new NotFoundError(`Cloudinary did not confirm delete of "${key}"`));
        }
      })
    );
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        if (keys.length === 0) return { removed: 0, skipped: 0 };
        const deleted = yield* Effect.result(
          liftResult(this.dataSource.deleteResources(keys, this.resourceType)),
        );
        if (Result.isFailure(deleted)) {
          for (const key of keys) yield* emit.recoverableError(deleted.failure);
          return { removed: 0, skipped: keys.length };
        }
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const verdict = deleted.success[key];
          if (verdict === 'deleted') {
            yield* emit.data(key);
            removed += 1;
          } else {
            yield* emit.recoverableError(new NotFoundError(`Cloudinary asset "${key}" was not found`));
            skipped += 1;
          }
        }
        return { removed, skipped };
      })
    );
  }

  // -----------------------------------------------------------------------
  // Resource / listing operations
  // -----------------------------------------------------------------------

  getResource(
    key: string,
    options?: GetResourceOptions,
  ): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        // Try as an asset first.
        const asset = yield* Effect.result(liftResult(this.dataSource.getResource(key, this.resourceType)));
        if (Result.isSuccess(asset) && asset.success) {
          return [this.toAsset(asset.success)] as ReadonlyArray<Resource>;
        }
        // Fall through — maybe it's a folder.
        const folder = yield* LaikaTask.runValue(this.getFolder(key));
        return [folder] as ReadonlyArray<Resource>;
      })
    );
  }

  listResources(
    folderKey: string,
    options: ListResourcesOptions,
  ): LaikaStream.LaikaStream<Resource, ListResourcesDone> {
    return LaikaStream.make<Resource, ListResourcesDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(folderKey);

        const folders = yield* Effect.result(liftResult(this.dataSource.listFolders(trimmed)));
        if (Result.isFailure(folders)) {
          if (folders.failure instanceof NotFoundError) {
            yield* emit.recoverableError(folders.failure);
            return { total: 0 } satisfies LaikaDone;
          }
          return yield* Effect.fail(folders.failure);
        }

        const assets = yield* liftResult(this.dataSource.listResources(trimmed, this.resourceType));

        // Filter assets to *direct* children — Cloudinary's prefix match is
        // recursive by default, so we drop anything with another `/` after
        // the configured folder.
        const directAssets = assets.filter(resource => {
          const relative = trimmed === ''
            ? resource.public_id
            : resource.public_id.startsWith(`${trimmed}/`)
            ? resource.public_id.slice(trimmed.length + 1)
            : resource.public_id;
          return !relative.includes('/');
        });

        const folderResources: Folder[] = folders.success.map(f => ({
          type: 'folder',
          key: f.path,
        }));
        const assetResources: Asset[] = directAssets.map(r => this.toAsset(r));

        const summaries: Resource[] = [...folderResources, ...assetResources];
        summaries.sort((a, b) => naturalCompare(keyOf(a), keyOf(b)));

        const sliced = applyPagination(summaries, options.pagination);
        if (sliced.length > 0) yield* emit.dataMany(sliced);
        return { total: summaries.length } satisfies LaikaDone;
      })
    );
  }

  // -----------------------------------------------------------------------
  // URL / variation / metadata streams
  // -----------------------------------------------------------------------

  getUrls(assets: Asset[]): LaikaStream.LaikaStream<AssetUrl, LaikaDone> {
    return LaikaStream.make<AssetUrl, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          const publicId = fieldOf<string>(asset, 'publicId');
          const version = fieldOf<number>(asset, 'version');
          const format = fieldOf<string>(asset, 'format');
          if (!publicId || version === undefined || !format) {
            yield* emit.recoverableError(
              new NotFoundError(`Asset "${asset.key}" is missing publicId/version/format`),
            );
            continue;
          }
          yield* emit.data({
            key: asset.key,
            url: this.deliveryUrl({ publicId, version, format }),
          });
        }
        return { total: assets.length } satisfies LaikaDone;
      })
    );
  }

  getVariations(assets: Asset[]): LaikaStream.LaikaStream<AssetVariations, LaikaDone> {
    return LaikaStream.make<AssetVariations, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          const publicId = fieldOf<string>(asset, 'publicId');
          const version = fieldOf<number>(asset, 'version');
          const format = fieldOf<string>(asset, 'format');
          if (!publicId || version === undefined || !format) {
            yield* emit.recoverableError(
              new NotFoundError(`Asset "${asset.key}" is missing publicId/version/format`),
            );
            continue;
          }
          const variations: Record<string, AssetVariations['variations'][string]> = {};
          for (const spec of this.variations) {
            variations[spec.name] = {
              variant: spec.name,
              url: this.deliveryUrl({ publicId, version, format }, spec.transform),
              width: spec.width,
              height: spec.height,
              mimeType: spec.mimeType,
            };
          }
          yield* emit.data({ key: asset.key, variations });
        }
        return { total: assets.length } satisfies LaikaDone;
      })
    );
  }

  getMetadata(assets: Asset[]): LaikaStream.LaikaStream<AssetMetadata, LaikaDone> {
    return LaikaStream.make<AssetMetadata, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          const resource = yield* Effect.result(liftResult(this.dataSource.getResource(asset.key, this.resourceType)));
          if (Result.isFailure(resource)) {
            yield* emit.recoverableError(resource.failure);
            continue;
          }
          if (!resource.success) {
            yield* emit.recoverableError(new NotFoundError(`Asset "${asset.key}" not found`));
            continue;
          }
          yield* emit.data(this.toMetadata(resource.success));
        }
        return { total: assets.length } satisfies LaikaDone;
      })
    );
  }

  // -----------------------------------------------------------------------
  // Folder operations
  // -----------------------------------------------------------------------

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        // GET /folders/{path} 404s when the folder doesn't exist — use it as the probe.
        yield* liftResult(this.dataSource.listFolders(trimmed));
        return { type: 'folder', key: trimmed } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.createFolder(trimSlashes(folderCreate.key)));
        return { type: 'folder', key: trimSlashes(folderCreate.key) } satisfies Folder;
      })
    );
  }

  deleteFolder(key: string, _recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        // Cloudinary refuses non-empty folders with a 409 (Conflict). We surface
        // that as the upstream error rather than silently recursing — bulk-delete
        // assets first if you really want a recursive purge.
        yield* liftResult(this.dataSource.deleteFolder(trimSlashes(key)));
      })
    );
  }
}

/** Read the key off either an Asset or a Folder for sorting. */
const keyOf = (r: Resource): string => r.key;
