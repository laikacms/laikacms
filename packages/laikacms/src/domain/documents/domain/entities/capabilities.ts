import * as S from 'effect/Schema';
import {
  ChangesCapabilitySchema,
  LocksCapabilitySchema,
  PaginationCapabilitySchema,
  VersionTrackingCapabilitySchema,
} from 'laikacms/storage';

/**
 * Compatibility-date brand for the Documents domain. Distinct from the Storage brand
 * so a type check can't confuse a Storage compat date with a Documents compat date.
 */
export const DocumentsCompatibilityDate = S.String.pipe(
  S.brand('DocumentsRepositoryCompatibilityDate'),
);
export type DocumentsCompatibilityDate = S.Schema.Type<typeof DocumentsCompatibilityDate>;

/**
 * Capabilities advertised by a `DocumentsRepository`. Consumers use these to decide
 * whether to drive pagination themselves, when to expect a backend to honor a given
 * pagination style, etc.
 */
export const DocumentsCapabilitiesSchema = S.toStandardSchemaV1(S.Struct({
  compatibilityDate: DocumentsCompatibilityDate,
  pagination: PaginationCapabilitySchema,

  /**
   * Whether the repository attaches an opaque per-record `version` token to
   * the documents, unpublished records, and summaries it returns.
   */
  versionTracking: VersionTrackingCapabilitySchema,

  /** Change-signal surface (`getSyncToken` / `listChanges`). */
  changes: ChangesCapabilitySchema,

  /**
   * Advisory document locking (`acquireLock` / `refreshLock` / `releaseLock` /
   * `getLock` / `withDocumentLock`). Carries `scope` and `transactional` rather
   * than a bare boolean so an in-process implementation cannot claim cross-node
   * or transactional guarantees it does not have.
   */
  locks: LocksCapabilitySchema,
}));

export type DocumentsCapabilities = S.Schema.Type<typeof DocumentsCapabilitiesSchema>;
