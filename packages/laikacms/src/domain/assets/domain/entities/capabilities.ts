import * as S from 'effect/Schema';
import { PaginationCapabilitySchema } from 'laikacms/storage';

/**
 * Compatibility-date brand for the Assets domain. Distinct from the Storage and
 * Documents brands so types can't be cross-confused.
 */
export const AssetsCompatibilityDate = S.String.pipe(
  S.brand('AssetsRepositoryCompatibilityDate'),
);
export type AssetsCompatibilityDate = S.Schema.Type<typeof AssetsCompatibilityDate>;

/**
 * Capabilities advertised by an `AssetsRepository`. Pagination affects `listResources`.
 */
export const AssetsCapabilitiesSchema = S.toStandardSchemaV1(S.Struct({
  compatibilityDate: AssetsCompatibilityDate,
  pagination: PaginationCapabilitySchema,
}));

export type AssetsCapabilities = S.Schema.Type<typeof AssetsCapabilitiesSchema>;
