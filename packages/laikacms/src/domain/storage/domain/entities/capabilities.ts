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
 * Describes one named filter a listing endpoint honors. Filters are
 * discovered by `name`; the set of names is open — new filters are added as
 * new descriptors without changing this schema or existing consumers.
 * Filter values are always strings (they travel as `filter[<name>]` query
 * parameters); each descriptor's `description` documents the value's
 * semantics.
 */
export const FilterDescriptorSchema = S.Struct({
  /** Wire name of the filter, e.g. `search`. */
  name: S.String,
  /** Human-readable semantics of the filter's value. */
  description: S.String,
});
export type FilterDescriptor = S.Schema.Type<typeof FilterDescriptorSchema>;

/**
 * Advertises which named filters a listing endpoint honors. Callers must only
 * pass filters whose `name` appears in `filters`; implementations fail with
 * `InvalidData` on undeclared names rather than silently ignoring them, so a
 * filtered listing is never quietly unfiltered.
 *
 * Shared between Storage, Documents, and Assets so a single semantic is used
 * everywhere.
 */
export const FilteringSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
  filters: S.Array(FilterDescriptorSchema),
});

export const FilteringCapabilitySchema = S.Union([UnsupportedCapability, FilteringSupportEnabled]);
export type FilteringCapability = S.Schema.Type<typeof FilteringCapabilitySchema>;

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

/**
 * Storage's change-signal surface. Mirrors {@link ChangesSupportEnabled} (the
 * shared Documents/Assets shape) and adds a `subscription` flag for the PUSH
 * channel:
 *
 * - `syncToken` / `changeFeed`: the pull feed (`getSyncToken` / `listChanges`).
 * - `subscription`: `subscribeChanges` delivers live change batches to a
 *   listener — a distinct surface from the pull feed, so a backend may support
 *   one without the other (the filesystem repository, for instance, offers a
 *   live watch but no historical sync token).
 *
 * A `true` flag means callers can rely on the method; `false` means it fails
 * (or, for `subscribeChanges`, throws) with `NotImplementedError`.
 */
export const StorageChangesSupportEnabled = S.Struct({
  supported: S.Literal(true),
  description: S.String,
  syncToken: S.Boolean,
  changeFeed: S.Boolean,
  subscription: S.Boolean,
});

export const StorageChangesCapabilitySchema = S.Union([
  UnsupportedCapability,
  StorageChangesSupportEnabled,
]);
export type StorageChangesCapability = S.Schema.Type<typeof StorageChangesCapabilitySchema>;

/**
 * Shared "no change signals" descriptor. A storage repository that implements
 * neither the pull feed nor the push subscription advertises
 * `changes: unsupportedChanges`.
 */
export const unsupportedChanges: StorageChangesCapability = {
  supported: false,
  description: 'This storage repository exposes no change signals; getSyncToken, listChanges, '
    + 'and subscribeChanges are not implemented.',
};

export const CapabilitiesSchema = S.toStandardSchemaV1(S.Struct({
  compatibilityDate: CompatibilityDate,
  fileExtensions: S.Union([UnsupportedCapability, FileExtensionsSupportEnabled]),
  pagination: PaginationCapabilitySchema,

  /**
   * Change-signal surface: the pull feed (`getSyncToken` / `listChanges`) and
   * the push subscription (`subscribeChanges`).
   */
  changes: StorageChangesCapabilitySchema,
}));

export type Capabilities = S.Schema.Type<typeof CapabilitiesSchema>;
