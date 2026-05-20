import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  ForbiddenError,
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

import {
  type CloudflareImageResource,
  CloudflareImagesDataSource,
  type CloudflareImagesDataSourceOptions,
} from './cf-images-datasource.js';

/**
 * Declarative spec for one Cloudflare Images variant. Cloudflare configures
 * variants at the **account level** (not per-URL like Cloudinary), so the
 * repository only needs the variant's *name*; the delivery URL is composed
 * from `imagedelivery.net/<accountHash>/<imageId>/<variantName>`.
 */
export interface CloudflareImagesVariantSpec {
  /** Variant name as configured in the Cloudflare dashboard. */
  readonly name: string;
  /** Optional declared dimensions — surfaced in the `AssetVariation`. */
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
}

export interface CloudflareImagesAssetsRepositoryOptions extends CloudflareImagesDataSourceOptions {
  /**
   * Account hash used in delivery URLs — visible in the Cloudflare Images
   * dashboard. NOT the same as the account id.
   */
  readonly accountHash: string;
  /** Variants configured at the account level. Empty by default — set them in your account first. */
  readonly variants?: ReadonlyArray<CloudflareImagesVariantSpec>;
  /**
   * Builds the public delivery URL for `(imageId, variantName)`. Defaults
   * to {@link defaultDeliveryUrl} which produces the standard
   * `imagedelivery.net/<hash>/<id>/<variant>` shape. Override for a
   * Worker-fronted custom delivery domain.
   */
  readonly deliveryUrl?: (input: { accountHash: string; imageId: string; variant: string }) => string;
  /** Optional MIME-type allowlist for `createAsset`. */
  readonly allowedMimeTypes?: ReadonlyArray<string>;
}

/** Default delivery-URL builder — `https://imagedelivery.net/<hash>/<id>/<variant>`. */
export const defaultDeliveryUrl = (input: { accountHash: string; imageId: string; variant: string }): string =>
  `https://imagedelivery.net/${input.accountHash}/${input.imageId}/${input.variant}`;

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/**
 * A {@link AssetsRepository} backed by Cloudflare Images. Sits alongside
 * `@laikacms/cloudflare/storage-d1` in the same package — second
 * dual-contract example in the suite (after `@laikacms/aws`).
 *
 * The interesting difference from Cloudinary (iter 10):
 *
 * - **Variants live in your Cloudflare account, not in the URL.** Cloudinary
 *   variations are arbitrary URL transforms (`c_fill,w_400`). Cloudflare
 *   Images variants are named entries configured at the account level
 *   (e.g. `public`, `thumbnail`, `medium`). The repository constructor
 *   takes the *names* of variants you've already configured; `getVariations`
 *   emits one URL per name. Misnamed variants 404 at the gateway, not at
 *   write time.
 * - **No native folder concept.** Cloudflare Images is a flat keyspace. The
 *   repository encodes folders into image ids via `/` (Cloudflare allows
 *   `/` in image ids up to 1024 chars) and filters listings client-side.
 *   Works fine for moderate volumes; document this for large accounts.
 *
 * Runtime-agnostic — only depends on `fetch`. Caller owns API-token
 * refresh via `auth.tokenProvider`.
 */
export class CloudflareImagesAssetsRepository extends AssetsRepository {
  private readonly dataSource: CloudflareImagesDataSource;
  private readonly accountHash: string;
  private readonly variants: ReadonlyArray<CloudflareImagesVariantSpec>;
  private readonly deliveryUrl: (input: { accountHash: string; imageId: string; variant: string }) => string;
  private readonly allowedMimeTypes: ReadonlySet<string> | null;

  constructor(options: CloudflareImagesAssetsRepositoryOptions) {
    super();
    this.dataSource = new CloudflareImagesDataSource(options);
    this.accountHash = options.accountHash;
    this.variants = options.variants ?? [];
    this.deliveryUrl = options.deliveryUrl ?? defaultDeliveryUrl;
    this.allowedMimeTypes = options.allowedMimeTypes ? new Set(options.allowedMimeTypes) : null;
  }

  // -----------------------------------------------------------------------
  // Asset shape conversion
  // -----------------------------------------------------------------------

  private buildAsset(resource: CloudflareImageResource): Asset {
    return {
      type: 'asset',
      key: resource.id,
      createdAt: resource.uploaded,
      updatedAt: resource.uploaded,
      content: {
        cloudflareId: resource.id,
        filename: resource.filename,
        meta: resource.meta,
        requireSignedURLs: resource.requireSignedURLs,
      },
    };
  }

  // -----------------------------------------------------------------------
  // AssetsRepository implementation
  // -----------------------------------------------------------------------

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.succeed<AssetsCapabilities>({
      compatibilityDate: AssetsCompatibilityDate.make('2026-05-20'),
      pagination: {
        supported: true,
        description: 'In-memory slicing over the full image list; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }

  getAsset(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const resource = yield* liftResult(this.dataSource.getImage(key));
        if (!resource) return yield* Effect.fail(new NotFoundError(`No asset found at key "${key}"`));
        return this.buildAsset(resource);
      })
    );
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        if (this.allowedMimeTypes && !this.allowedMimeTypes.has(create.mimeType)) {
          return yield* Effect.fail(new ForbiddenError(`Disallowed MIME type "${create.mimeType}"`));
        }
        const resource = yield* liftResult(this.dataSource.upload(create.key, create.content, {
          filename: create.filename,
          metadata: create.customMetadata,
          mimeType: create.mimeType,
        }));
        return this.buildAsset(resource);
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        // Cloudflare Images doesn't expose a metadata-only PATCH; confirm
        // the asset exists and return its current state. To rewrite the
        // binary, call `createAsset` again — Cloudflare overwrites on
        // matching id when the upload uses the same `id` form field.
        const resource = yield* liftResult(this.dataSource.getImage(update.key));
        if (!resource) return yield* Effect.fail(new NotFoundError(`No asset found at key "${update.key}"`));
        return this.buildAsset(resource);
      })
    );
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.deleteImage(key));
      })
    );
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const result = yield* Effect.result(liftResult(this.dataSource.deleteImage(key)));
          if (Result.isFailure(result)) {
            yield* emit.recoverableError(result.failure);
            skipped += 1;
          } else {
            yield* emit.data(key);
            removed += 1;
          }
        }
        return { removed, skipped };
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
          // "public" is the conventional default variant in Cloudflare Images.
          // If you want a different default, pass it as the first entry of
          // `variants` and rebuild the delivery URL via your `deliveryUrl`
          // builder.
          const url = this.deliveryUrl({
            accountHash: this.accountHash,
            imageId: asset.key,
            variant: 'public',
          });
          yield* emit.data({ key: asset.key, url });
        }
        return { total: assets.length } satisfies LaikaDone;
      })
    );
  }

  getVariations(assets: Asset[]): LaikaStream.LaikaStream<AssetVariations, LaikaDone> {
    return LaikaStream.make<AssetVariations, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          const variations: Record<string, AssetVariations['variations'][string]> = {};
          for (const spec of this.variants) {
            variations[spec.name] = {
              variant: spec.name,
              url: this.deliveryUrl({
                accountHash: this.accountHash,
                imageId: asset.key,
                variant: spec.name,
              }),
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
          const resource = yield* Effect.result(liftResult(this.dataSource.getImage(asset.key)));
          if (Result.isFailure(resource)) {
            yield* emit.recoverableError(resource.failure);
            continue;
          }
          if (!resource.success) {
            yield* emit.recoverableError(new NotFoundError(`Asset "${asset.key}" not found`));
            continue;
          }
          // Cloudflare Images doesn't return width/height in the API response,
          // so we surface BinaryMetadata. Width/height hints attached via
          // `customMetadata` at upload time *could* be promoted to ImageMetadata
          // — left as a follow-up to keep this iteration honest.
          const meta = resource.success.meta ?? {};
          yield* emit.data({
            key: asset.key,
            metadata: {
              kind: 'binary',
              size: 0, // Cloudflare doesn't surface size; left as 0 rather than guessed.
              mimeType: typeof meta['mimeType'] === 'string' ? String(meta['mimeType']) : 'application/octet-stream',
              hash: resource.success.id,
              hashAlgorithm: 'cloudflare-image-id',
            } as AssetMetadata['metadata'],
          });
        }
        return { total: assets.length } satisfies LaikaDone;
      })
    );
  }

  // -----------------------------------------------------------------------
  // Resource / folder operations — Cloudflare Images is flat, folders are
  // synthesised from id prefixes.
  // -----------------------------------------------------------------------

  getResource(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        const resource = yield* Effect.result(liftResult(this.dataSource.getImage(key)));
        if (Result.isSuccess(resource) && resource.success) {
          return [this.buildAsset(resource.success)] as ReadonlyArray<Resource>;
        }
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
        const all = yield* liftResult(this.dataSource.listImages());

        // Cloudflare Images is flat — synthesise folders from id prefixes.
        // Direct children of `folderKey`:
        //   asset → id starts with `folderKey/` and has no further `/`
        //   folder → id starts with `folderKey/` and has further `/`s,
        //            surface the first sub-segment as a folder once
        const folderSet = new Set<string>();
        const assets: Asset[] = [];
        const prefix = trimmed === '' ? '' : `${trimmed}/`;
        for (const image of all) {
          if (trimmed !== '' && !image.id.startsWith(prefix)) continue;
          const rel = trimmed === '' ? image.id : image.id.slice(prefix.length);
          if (rel === '') continue;
          const slash = rel.indexOf('/');
          if (slash === -1) {
            assets.push(this.buildAsset(image));
          } else {
            folderSet.add(trimmed === '' ? rel.slice(0, slash) : `${trimmed}/${rel.slice(0, slash)}`);
          }
        }

        const folders: Folder[] = [...folderSet].map(key => ({ type: 'folder', key }));
        const entries: Resource[] = [...folders, ...assets].sort((a, b) =>
          naturalCompare(a.key, b.key),
        );

        const sliced = applyPagination(entries, options.pagination);
        if (sliced.length > 0) yield* emit.dataMany(sliced);
        return { total: entries.length } satisfies LaikaDone;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        // Folder "exists" iff there's at least one image whose id starts
        // with `<folder>/`. Cloudflare Images has no separate folder concept.
        const all = yield* liftResult(this.dataSource.listImages());
        const hasAny = all.some(img => img.id.startsWith(`${trimmed}/`));
        if (!hasAny) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return { type: 'folder', key: trimmed } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // Cloudflare Images has no real folder concept and `requireSignedURLs`
        // is the closest thing to a marker. Folders are virtual — they
        // appear in listings the moment an image with a matching prefix
        // exists. Returning a synthetic folder is the honest answer.
        return { type: 'folder', key: trimSlashes(folderCreate.key) } satisfies Folder;
      })
    );
  }

  deleteFolder(key: string, _recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        // Virtual folder — nothing to delete by itself. To recursively
        // remove the children, list them and call `deleteAssets`.
        yield* Effect.succeed(undefined);
        // Lint: silence unused-variable warning while keeping the API.
        void key;
      })
    );
  }
}
