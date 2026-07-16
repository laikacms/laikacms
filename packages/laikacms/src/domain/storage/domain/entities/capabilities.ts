// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as S from 'effect/Schema';
import { StorageFormatSchema } from '../types/index.js';

export const CompatibilityDate = S.String.pipe(S.brand('StorageRepositoryCompatibilityDate'));
export type CompatibilityDate = S.Schema.Type<typeof CompatibilityDate>;

export const SerializationRegistry = S.Array(S.String);

export const UnsupportedCapability = S.Struct({
  supported: S.Literal(false),
  description: S.String,
});

export const FileExtensionsSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
  supportedExtensions: S.Record(
    S.String,
    S.Struct({
      format: StorageFormatSchema,
    }),
  ),
});

/**
 * Indicates which `Pagination` shapes a listing endpoint honors. A `true` value means
 * callers can rely on that shape; `false` means the implementation silently ignores it
 * (callers should fall through to their own bounds).
 *
 * Shared between Storage, Documents, and Assets so a single semantic is used everywhere.
 */
export const PaginationSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
  styles: S.Struct({
    /** `{ offset, limit? }` */
    offset: S.Boolean,
    /** `{ page, perPage? }` */
    page: S.Boolean,
    /** Cursor-based — `{ before, perPage? }` and `{ after, perPage? }` */
    cursor: S.Boolean,
  }),
});

export const PaginationCapabilitySchema = S.Union([UnsupportedCapability, PaginationSupportEnabled]);
export type PaginationCapability = S.Schema.Type<typeof PaginationCapabilitySchema>;

/**
 * Advertises whether the repository attaches an opaque per-record `version`
 * token to the entities it returns (documents, unpublished, summaries, assets).
 *
 * The token changes if and only if the record's content changed and is
 * comparable only by equality. A git blob or commit sha, a database row
 * version, and an R2 ETag are all valid implementations.
 *
 * Shared between Documents and Assets so a single semantic is used everywhere.
 */
export const VersionTrackingSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
});

export const VersionTrackingCapabilitySchema = S.Union([UnsupportedCapability, VersionTrackingSupportEnabled]);
export type VersionTrackingCapability = S.Schema.Type<typeof VersionTrackingCapabilitySchema>;

/**
 * Advertises the change-signal surface of a repository:
 *
 * - `syncToken`: `getSyncToken` returns an opaque per-scope token that changes
 *   whenever anything inside the scope (a folder, or the whole store) changes.
 * - `changeFeed`: `listChanges` enumerates what changed since a previously
 *   obtained sync token.
 *
 * A `true` flag means callers can rely on the method; `false` means the
 * method fails with `NotImplementedError`. Shared between Documents and
 * Assets so a single semantic is used everywhere.
 */
export const ChangesSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
  syncToken: S.Boolean,
  changeFeed: S.Boolean,
});

export const ChangesCapabilitySchema = S.Union([UnsupportedCapability, ChangesSupportEnabled]);
export type ChangesCapability = S.Schema.Type<typeof ChangesCapabilitySchema>;

export const CapabilitiesSchema = S.toStandardSchemaV1(S.Struct({
  compatibilityDate: CompatibilityDate,
  fileExtensions: S.Union([UnsupportedCapability, FileExtensionsSupportEnabled]),
  pagination: PaginationCapabilitySchema,
}));

export type Capabilities = S.Schema.Type<typeof CapabilitiesSchema>;
