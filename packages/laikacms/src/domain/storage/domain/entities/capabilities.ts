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

export const CapabilitiesSchema = S.toStandardSchemaV1(S.Struct({
  compatibilityDate: CompatibilityDate,
  fileExtensions: S.Union([UnsupportedCapability, FileExtensionsSupportEnabled]),
  pagination: PaginationCapabilitySchema,
}));

export type Capabilities = S.Schema.Type<typeof CapabilitiesSchema>;
