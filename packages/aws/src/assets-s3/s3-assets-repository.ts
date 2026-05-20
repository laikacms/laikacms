import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  type LaikaDone,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
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
import { applyPagination, type Folder, type FolderCreate, naturalCompare, pathCombine } from 'laikacms/storage';

/**
 * Declarative spec for one variation URL. The repository hands you the
 * resolved S3 object name (incl. base path) and the format extracted from
 * the key; you return the deliverable URL. Static-string templating is
 * available via `defaultS3AssetUrl` when you don't need full flexibility.
 */
export interface S3AssetVariationSpec {
  readonly name: string;
  /** Build the delivery URL for this variant. */
  readonly url: (input: { key: string; bucket: string; basePath: string }) => string;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
}

export interface S3AssetsRepositoryOptions {
  readonly client: S3Client;
  readonly bucket: string;
  /** Optional key prefix — every asset is read/written under `<basePath>/...`. */
  readonly basePath?: string;
  /**
   * Builds the `getUrls` result for the original asset. Defaults to
   * {@link defaultS3AssetUrl} which produces `https://<bucket>.s3.amazonaws.com/<key>`.
   * Set this to a CloudFront / Lambda@Edge / custom CDN URL builder.
   */
  readonly urlFor?: (input: { key: string; bucket: string; basePath: string }) => string;
  /** Variation specs — typically a fixed set of resize templates. Defaults to `[]`. */
  readonly variations?: ReadonlyArray<S3AssetVariationSpec>;
  /**
   * Optional list of registered MIME types accepted by `createAsset`. When
   * present, anything outside the list is rejected upfront with
   * `BadRequestError` so misconfigured clients fail early.
   */
  readonly allowedMimeTypes?: ReadonlyArray<string>;
}

/** Default URL builder — points at the standard virtual-hosted-style S3 URL. */
export const defaultS3AssetUrl = (
  input: { key: string; bucket: string; basePath: string },
): string => `https://${input.bucket}.s3.amazonaws.com/${input.key}`;

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/** Recognise S3 "not found" across statusCode / Code shapes. */
const isNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === 'NoSuchKey' || e.name === 'NotFound') return true;
  if (e.Code === 'NoSuchKey' || e.Code === 'NotFound') return true;
  return e.$metadata?.httpStatusCode === 404;
};

const mapS3Error = (error: unknown, context: string): LaikaError => {
  if (isNotFound(error)) return new NotFoundError(`S3 object not found: ${context}`, { cause: error });
  if (typeof error === 'object' && error !== null) {
    const e = error as { $metadata?: { httpStatusCode?: number } };
    const status = e.$metadata?.httpStatusCode;
    if (status === 401) return new AuthenticationError(`S3 authentication failed for ${context}`, { cause: error });
    if (status === 403) return new ForbiddenError(`S3 access denied for ${context}`, { cause: error });
    if (status === 429) return new TooManyRequestsError(`S3 throttled request for ${context}`, { cause: error });
    if (status !== undefined && status >= 500) {
      return new ServiceUnavailableError(`S3 returned HTTP ${status} for ${context}`, { cause: error });
    }
  }
  return new InternalError(`S3 operation failed for ${context}`, { cause: error });
};

/**
 * Best-effort filename → MIME-type → extension hint. Used only to derive a
 * `format` field on the asset's content object when the upload didn't carry
 * an explicit one.
 */
const extensionFromMime = (mime: string): string | undefined => {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
  };
  return map[mime];
};

/**
 * An {@link AssetsRepository} backed by Amazon S3 (or any S3-API-compatible
 * store). This is the **second contract** layered on the same S3 client used
 * by `@laikacms/aws/storage-s3` — same bucket, same auth, same key model.
 *
 * The interesting design choice: **variations are pure URL transforms**. S3
 * doesn't process images; you pair this repository with CloudFront +
 * Lambda@Edge / Cloudflare Image Resizing / Imgix / your own resize worker.
 * Each {@link S3AssetVariationSpec} owns the function that produces the
 * variant's URL from the asset's key. The default variations list is empty,
 * because variants only make sense once you've named your CDN.
 *
 * Same per-bucket / per-prefix model as the storage repo:
 *
 * - One asset = one S3 object.
 * - Folders are virtual prefixes; an empty folder is materialized as a
 *   `.keep` placeholder so listings can surface it.
 * - `metadata.revisionId` is the object's ETag.
 *
 * Pair this with `@laikacms/aws/storage-s3` on the same bucket — they
 * don't conflict because the assets repository writes under different keys
 * (typically `assets/<key>` via `basePath`).
 */
export class S3AssetsRepository extends AssetsRepository {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly basePath: string;
  private readonly urlFor: (input: { key: string; bucket: string; basePath: string }) => string;
  private readonly variations: ReadonlyArray<S3AssetVariationSpec>;
  private readonly allowedMimeTypes: ReadonlySet<string> | null;

  constructor(options: S3AssetsRepositoryOptions) {
    super();
    this.client = options.client;
    this.bucket = options.bucket;
    this.basePath = options.basePath ?? '';
    this.urlFor = options.urlFor ?? defaultS3AssetUrl;
    this.variations = options.variations ?? [];
    this.allowedMimeTypes = options.allowedMimeTypes ? new Set(options.allowedMimeTypes) : null;
  }

  // -----------------------------------------------------------------------
  // Path helpers — keep the storage and assets repos using compatible keys.
  // -----------------------------------------------------------------------

  private fullKey(relativeKey: string): string {
    const base = trimSlashes(this.basePath);
    const k = trimSlashes(relativeKey);
    return base === '' ? k : k === '' ? base : `${base}/${k}`;
  }

  private relativeKey(fullKey: string): string {
    const base = trimSlashes(this.basePath);
    if (base === '') return fullKey;
    if (fullKey === base) return '';
    return fullKey.startsWith(`${base}/`) ? fullKey.slice(base.length + 1) : fullKey;
  }

  // -----------------------------------------------------------------------
  // Asset shape conversion
  // -----------------------------------------------------------------------

  /** Construct a Laika `Asset` from the headers we hold on a created/fetched object. */
  private buildAsset(
    relativeKey: string,
    props: {
      size: number;
      etag?: string;
      contentType?: string;
      lastModified?: Date;
      filename?: string;
      customMetadata?: Record<string, string>;
    },
  ): Asset {
    const format = props.contentType ? extensionFromMime(props.contentType) : undefined;
    return {
      type: 'asset',
      key: trimSlashes(relativeKey),
      createdAt: props.lastModified?.toISOString(),
      updatedAt: props.lastModified?.toISOString(),
      content: {
        size: props.size,
        etag: props.etag,
        mimeType: props.contentType,
        filename: props.filename,
        format,
        customMetadata: props.customMetadata,
      },
    };
  }

  private async headAsset(relativeKey: string): Promise<LaikaResult<{
    size: number;
    etag?: string;
    contentType?: string;
    lastModified?: Date;
    customMetadata: Record<string, string>;
  } | null>> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(relativeKey) }),
      );
      return Result.succeed({
        size: out.ContentLength ?? 0,
        etag: out.ETag,
        contentType: out.ContentType,
        lastModified: out.LastModified,
        customMetadata: (out.Metadata ?? {}) as Record<string, string>,
      });
    } catch (error) {
      if (isNotFound(error)) return Result.succeed(null);
      return Result.fail(mapS3Error(error, relativeKey));
    }
  }

  // -----------------------------------------------------------------------
  // AssetsRepository implementation
  // -----------------------------------------------------------------------

  getCapabilities(): LaikaTask.LaikaTask<AssetsCapabilities> {
    return LaikaTask.succeed<AssetsCapabilities>({
      compatibilityDate: AssetsCompatibilityDate.make('2026-05-20'),
      pagination: {
        supported: true,
        description: 'In-memory slicing over `ListObjectsV2`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }

  getAsset(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        const head = yield* liftResult(this.headAsset(key));
        if (!head) return yield* Effect.fail(new NotFoundError(`No asset found at key "${key}"`));
        return this.buildAsset(key, {
          size: head.size,
          etag: head.etag,
          contentType: head.contentType,
          lastModified: head.lastModified,
          filename: head.customMetadata['filename'],
          customMetadata: head.customMetadata,
        });
      })
    );
  }

  createAsset(create: AssetCreate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        if (this.allowedMimeTypes && !this.allowedMimeTypes.has(create.mimeType)) {
          return yield* Effect.fail(new ForbiddenError(`Disallowed MIME type "${create.mimeType}"`));
        }

        const metadata: Record<string, string> = { ...(create.customMetadata ?? {}) };
        if (create.filename) metadata['filename'] = create.filename;

        const fullKey = this.fullKey(create.key);
        // Effect.tryPromise turns SDK rejections into proper Effect failures.
        // Plain Effect.promise treats them as defects, which deadlocks the
        // outer Channel — surface mapped LaikaErrors instead.
        const result = yield* Effect.tryPromise({
          try: async () => this.client.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: fullKey,
              // S3 SDK v3 accepts Uint8Array / ArrayBuffer / streams directly.
              Body: create.content as unknown as Uint8Array,
              ContentType: create.mimeType,
              CacheControl: create.cacheControl,
              Metadata: metadata,
            }),
          ),
          catch: error => mapS3Error(error, create.key),
        });
        // Refresh metadata via HeadObject so size/lastModified are accurate.
        const head = yield* liftResult(this.headAsset(create.key));
        if (!head) {
          return yield* Effect.fail(new InternalError(`Asset disappeared immediately after upload: ${create.key}`));
        }
        return this.buildAsset(create.key, {
          size: head.size,
          etag: head.etag ?? result.ETag,
          contentType: head.contentType ?? create.mimeType,
          lastModified: head.lastModified,
          filename: create.filename,
          customMetadata: head.customMetadata,
        });
      })
    );
  }

  updateAsset(update: AssetUpdate): LaikaTask.LaikaTask<Asset> {
    return LaikaTask.make<Asset>(() =>
      Effect.gen({ self: this }, function*() {
        // Without a content body S3 can't atomically rewrite just headers —
        // confirm the asset exists and return its current metadata.
        // To actually rewrite the headers, callers should re-upload content.
        const head = yield* liftResult(this.headAsset(update.key));
        if (!head) return yield* Effect.fail(new NotFoundError(`No asset found at key "${update.key}"`));
        return this.buildAsset(update.key, {
          size: head.size,
          etag: head.etag,
          contentType: update.mimeType ?? head.contentType,
          lastModified: head.lastModified,
          customMetadata: { ...head.customMetadata, ...(update.customMetadata ?? {}) },
        });
      })
    );
  }

  deleteAsset(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        yield* Effect.tryPromise({
          try: async () => this.client.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
          ),
          catch: error => mapS3Error(error, key),
        });
      })
    );
  }

  deleteAssets(keys: readonly string[]): LaikaStream.LaikaStream<string, DeleteAssetsDone> {
    return LaikaStream.make<string, DeleteAssetsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const result = yield* Effect.result(Effect.tryPromise({
            try: async () => this.client.send(
              new DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
            ),
            catch: error => mapS3Error(error, key),
          }));
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
  // URL + variation + metadata streams
  // -----------------------------------------------------------------------

  getUrls(assets: Asset[]): LaikaStream.LaikaStream<AssetUrl, LaikaDone> {
    return LaikaStream.make<AssetUrl, LaikaDone>(emit =>
      Effect.gen({ self: this }, function*() {
        for (const asset of assets) {
          const url = this.urlFor({ key: this.fullKey(asset.key), bucket: this.bucket, basePath: this.basePath });
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
          for (const spec of this.variations) {
            variations[spec.name] = {
              variant: spec.name,
              url: spec.url({ key: this.fullKey(asset.key), bucket: this.bucket, basePath: this.basePath }),
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
          const head = yield* Effect.result(liftResult(this.headAsset(asset.key)));
          if (Result.isFailure(head)) {
            yield* emit.recoverableError(head.failure);
            continue;
          }
          if (!head.success) {
            yield* emit.recoverableError(new NotFoundError(`Asset "${asset.key}" not found`));
            continue;
          }
          // S3 doesn't intrinsically know image dimensions; surface user-metadata
          // width/height hints when callers attached them at upload time.
          const widthHint = head.success.customMetadata['width'];
          const heightHint = head.success.customMetadata['height'];
          const isImage = head.success.contentType?.startsWith('image/');
          const baseMime = head.success.contentType ?? 'application/octet-stream';
          const metadata = isImage && widthHint && heightHint
            ? {
              kind: 'image' as const,
              size: head.success.size,
              mimeType: baseMime,
              hash: head.success.etag,
              hashAlgorithm: head.success.etag ? 'etag' : undefined,
              width: Number(widthHint),
              height: Number(heightHint),
            }
            : {
              kind: 'binary' as const,
              size: head.success.size,
              mimeType: baseMime,
              hash: head.success.etag,
              hashAlgorithm: head.success.etag ? 'etag' : undefined,
            };
          yield* emit.data({ key: asset.key, metadata: metadata as AssetMetadata['metadata'] });
        }
        return { total: assets.length } satisfies LaikaDone;
      })
    );
  }

  // -----------------------------------------------------------------------
  // Resource / folder operations — flat object store with virtual folders.
  // -----------------------------------------------------------------------

  getResource(key: string, _options?: GetResourceOptions): LaikaTask.LaikaTask<ReadonlyArray<Resource>> {
    return LaikaTask.make<ReadonlyArray<Resource>>(() =>
      Effect.gen({ self: this }, function*() {
        const head = yield* Effect.result(liftResult(this.headAsset(key)));
        if (Result.isSuccess(head) && head.success) {
          const asset = this.buildAsset(key, {
            size: head.success.size,
            etag: head.success.etag,
            contentType: head.success.contentType,
            lastModified: head.success.lastModified,
            customMetadata: head.success.customMetadata,
          });
          return [asset] as ReadonlyArray<Resource>;
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
        const prefix = this.fullKey(folderKey);
        const searchPrefix = prefix === '' ? '' : `${prefix}/`;
        const entries: Resource[] = [];
        let continuationToken: string | undefined;
        do {
          const out: ListObjectsV2CommandOutput = yield* Effect.tryPromise({
            try: async () => this.client.send(
              new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: searchPrefix,
                Delimiter: '/',
                ContinuationToken: continuationToken,
              }),
            ),
            catch: error => mapS3Error(error, folderKey || '<root>'),
          });
          for (const object of out.Contents ?? []) {
            if (!object.Key) continue;
            if (object.Key.endsWith('/.keep') || object.Key === `${searchPrefix}.keep`) continue;
            entries.push({
              type: 'asset',
              key: this.relativeKey(object.Key),
              content: {
                size: object.Size ?? 0,
                etag: object.ETag,
              },
            } satisfies Asset);
          }
          for (const common of out.CommonPrefixes ?? []) {
            if (!common.Prefix) continue;
            entries.push({
              type: 'folder',
              key: this.relativeKey(common.Prefix.replace(/\/+$/, '')),
            } satisfies Folder);
          }
          continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
        } while (continuationToken);

        entries.sort((a, b) => naturalCompare(a.key, b.key));
        const sliced = applyPagination(entries, options.pagination);
        if (sliced.length > 0) yield* emit.dataMany(sliced);
        return { total: entries.length } satisfies LaikaDone;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const prefix = this.fullKey(key);
        const search = prefix === '' ? '' : `${prefix}/`;
        const out = yield* Effect.tryPromise({
          try: async () => this.client.send(
            new ListObjectsV2Command({ Bucket: this.bucket, Prefix: search, MaxKeys: 1 }),
          ),
          catch: error => mapS3Error(error, key || '<root>'),
        });
        const empty = (out.Contents?.length ?? 0) === 0 && (out.CommonPrefixes?.length ?? 0) === 0;
        if (empty) {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return { type: 'folder', key: trimSlashes(key) } satisfies Folder;
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // S3 has no real folder concept — drop a `.keep` so the prefix shows up
        // in listings.
        const keepKey = this.fullKey(pathCombine(folderCreate.key, '.keep'));
        yield* Effect.tryPromise({
          try: async () => this.client.send(
            new PutObjectCommand({ Bucket: this.bucket, Key: keepKey, Body: '' }),
          ),
          catch: error => mapS3Error(error, folderCreate.key),
        });
        return { type: 'folder', key: trimSlashes(folderCreate.key) } satisfies Folder;
      })
    );
  }

  deleteFolder(key: string, recursive?: boolean): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const prefix = this.fullKey(key);
        const search = prefix === '' ? '' : `${prefix}/`;
        // Count objects under the prefix. If non-empty and not recursive, refuse.
        const probe = yield* Effect.tryPromise({
          try: async () => this.client.send(
            new ListObjectsV2Command({ Bucket: this.bucket, Prefix: search }),
          ),
          catch: error => mapS3Error(error, key),
        });
        const items = probe.Contents ?? [];
        const hasReal = items.some(o => o.Key && !o.Key.endsWith('/.keep'));
        if (hasReal && !recursive) {
          return yield* Effect.fail(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
        }
        // Delete all objects under the prefix (and the `.keep`).
        for (const obj of items) {
          if (!obj.Key) continue;
          yield* Effect.tryPromise({
            try: async () => this.client.send(
              new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.Key as string }),
            ),
            catch: error => mapS3Error(error, key),
          });
        }
      })
    );
  }
}
