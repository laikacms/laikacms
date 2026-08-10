import * as DateTime from 'effect/DateTime';
import * as S from 'effect/Schema';
import {
  type Document,
  type DocumentCreate,
  type DocumentSummary,
  type DocumentUpdate,
  type Revision,
  type RevisionCreate,
  type RevisionSummary,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedSummary,
  type UnpublishedUpdate,
} from 'laikacms/documents';
import { fromJsonApi, toJsonApi } from 'laikacms/json-api';
import {
  type Folder,
  type FolderCreate,
  type FolderSummary,
  type Lock,
  type OwnedLock,
  type StorageObject,
  type StorageObjectCreate,
  type StorageObjectSummary,
  type StorageObjectUpdate,
} from 'laikacms/storage';

// Re-export common JSON:API utilities
export { fromJsonApi, type JsonApiCollectionResponse, type JsonApiError, toJsonApi } from 'laikacms/json-api';

// ===== JSON:API RESOURCE TYPES =====

// Storage Object JSON:API types
export interface StorageObjectJsonApi {
  type: 'object';
  id: string;
  attributes: Omit<StorageObject, 'key' | 'type'>;
}

export interface StorageObjectCreateJsonApi {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectCreate, 'key' | 'type'>;
}

export interface StorageObjectUpdateJsonApi {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectUpdate, 'key' | 'type'>;
}

export interface StorageObjectSummaryJsonApi {
  type: 'object-summary';
  id: string;
  attributes: Omit<StorageObjectSummary, 'key' | 'type'>;
}

// Document JSON:API types
export interface DocumentJsonApi {
  type: 'published';
  id: string;
  attributes: Omit<Document, 'key' | 'type'>;
}

export interface DocumentCreateJsonApi {
  type: 'published';
  id: string;
  attributes: Omit<DocumentCreate, 'key' | 'type'>;
}

export interface DocumentUpdateJsonApi {
  type: 'published';
  id: string;
  attributes: Omit<DocumentUpdate, 'key' | 'type'>;
}

export interface DocumentSummaryJsonApi {
  type: 'published-summary';
  id: string;
  attributes: Omit<DocumentSummary, 'key' | 'type'>;
}

// Unpublished JSON:API types
export interface UnpublishedJsonApi {
  type: 'unpublished';
  id: string;
  attributes: Omit<Unpublished, 'key' | 'type'>;
}

export interface UnpublishedCreateJsonApi {
  type: 'unpublished';
  id: string;
  attributes: Omit<UnpublishedCreate, 'key' | 'type'>;
}

export interface UnpublishedUpdateJsonApi {
  type: 'unpublished';
  id: string;
  attributes: Omit<UnpublishedUpdate, 'key' | 'type'>;
}

export interface UnpublishedSummaryJsonApi {
  type: 'unpublished-summary';
  id: string;
  attributes: Omit<UnpublishedSummary, 'key' | 'type'>;
}

// Folder JSON:API types
export interface FolderJsonApi {
  type: 'folder';
  id: string;
  attributes: Omit<Folder, 'key' | 'type'>;
}

export interface FolderCreateJsonApi {
  type: 'folder';
  id: string;
  attributes: Omit<FolderCreate, 'key' | 'type'>;
}

export interface FolderSummaryJsonApi {
  type: 'folder-summary';
  id: string;
  attributes: Omit<FolderSummary, 'key' | 'type'>;
}

// Revision JSON:API types
// id is composite "key/revision" to satisfy JSON:API §7.2.1 uniqueness — see LCMS-286
export interface RevisionJsonApi {
  type: 'revision';
  id: string;
  attributes: Omit<Revision, 'type'>;
}

export interface RevisionCreateJsonApi {
  type: 'revision';
  id: string;
  attributes: Omit<RevisionCreate, 'key' | 'type'>;
}

export interface RevisionSummaryJsonApi {
  type: 'revision-summary';
  id: string;
  attributes: Omit<RevisionSummary, 'type'>;
}

// ===== TRANSFORMER FUNCTIONS =====

// Storage Object transformers
export const storageObjectToJsonApi = (obj: StorageObject): StorageObjectJsonApi => toJsonApi(obj, 'object', 'key');

export const storageObjectFromJsonApi = (jsonApi: StorageObjectJsonApi): StorageObject =>
  fromJsonApi(jsonApi, 'object', 'key');

export const storageObjectCreateToJsonApi = (obj: StorageObjectCreate): StorageObjectCreateJsonApi =>
  toJsonApi(obj, 'object', 'key');

export const storageObjectUpdateToJsonApi = (obj: StorageObjectUpdate): StorageObjectUpdateJsonApi =>
  toJsonApi(obj, 'object', 'key');

export const storageObjectUpdateFromJsonApi = (jsonApi: StorageObjectUpdateJsonApi): StorageObjectUpdate =>
  fromJsonApi(jsonApi, 'object', 'key');

export const storageObjectSummaryToJsonApi = (obj: StorageObjectSummary): StorageObjectSummaryJsonApi =>
  toJsonApi(obj, 'object-summary', 'key');

export const storageObjectSummaryFromJsonApi = (jsonApi: StorageObjectSummaryJsonApi): StorageObjectSummary =>
  fromJsonApi(jsonApi, 'object-summary', 'key');

// Document transformers
export const documentToJsonApi = (doc: Document): DocumentJsonApi => toJsonApi(doc, 'published', 'key');

export const documentFromJsonApi = (jsonApi: DocumentJsonApi): Document => fromJsonApi(jsonApi, 'published', 'key');

export const documentCreateToJsonApi = (doc: DocumentCreate): DocumentCreateJsonApi =>
  toJsonApi(doc, 'published', 'key');

export const documentCreateFromJsonApi = (jsonApi: DocumentCreateJsonApi): DocumentCreate => {
  const doc = fromJsonApi(jsonApi, 'published', 'key');
  return { ...doc, language: doc.language ?? 'und' };
};

export const documentUpdateToJsonApi = (doc: DocumentUpdate): DocumentUpdateJsonApi =>
  toJsonApi(doc, 'published', 'key');

export const documentUpdateFromJsonApi = (jsonApi: DocumentUpdateJsonApi): DocumentUpdate =>
  fromJsonApi(jsonApi, 'published', 'key');

export const documentSummaryToJsonApi = (doc: DocumentSummary): DocumentSummaryJsonApi =>
  toJsonApi(doc, 'published-summary', 'key');

export const documentSummaryFromJsonApi = (jsonApi: DocumentSummaryJsonApi): DocumentSummary =>
  fromJsonApi(jsonApi, 'published-summary', 'key');

// Unpublished transformers
export const unpublishedToJsonApi = (doc: Unpublished): UnpublishedJsonApi => toJsonApi(doc, 'unpublished', 'key');

export const unpublishedFromJsonApi = (jsonApi: UnpublishedJsonApi): Unpublished =>
  fromJsonApi(jsonApi, 'unpublished', 'key');

export const unpublishedCreateToJsonApi = (doc: UnpublishedCreate): UnpublishedCreateJsonApi =>
  toJsonApi(doc, 'unpublished', 'key');

export const unpublishedCreateFromJsonApi = (jsonApi: UnpublishedCreateJsonApi): UnpublishedCreate => {
  const doc = fromJsonApi(jsonApi, 'unpublished', 'key');
  return { ...doc, language: doc.language ?? 'und' };
};

export const unpublishedUpdateToJsonApi = (doc: UnpublishedUpdate): UnpublishedUpdateJsonApi =>
  toJsonApi(doc, 'unpublished', 'key');

export const unpublishedUpdateFromJsonApi = (jsonApi: UnpublishedUpdateJsonApi): UnpublishedUpdate =>
  fromJsonApi(jsonApi, 'unpublished', 'key');

export const unpublishedSummaryToJsonApi = (doc: UnpublishedSummary): UnpublishedSummaryJsonApi =>
  toJsonApi(doc, 'unpublished-summary', 'key');

export const unpublishedSummaryFromJsonApi = (jsonApi: UnpublishedSummaryJsonApi): UnpublishedSummary =>
  fromJsonApi(jsonApi, 'unpublished-summary', 'key');

// Folder transformers
export const folderToJsonApi = (folder: Folder): FolderJsonApi => toJsonApi(folder, 'folder', 'key');

export const folderFromJsonApi = (jsonApi: FolderJsonApi): Folder => fromJsonApi(jsonApi, 'folder', 'key');

export const folderCreateToJsonApi = (folder: FolderCreate): FolderCreateJsonApi => toJsonApi(folder, 'folder', 'key');

export const folderCreateFromJsonApi = (jsonApi: FolderCreateJsonApi): FolderCreate =>
  fromJsonApi(jsonApi, 'folder', 'key');

export const folderSummaryToJsonApi = (folder: FolderSummary): FolderSummaryJsonApi =>
  toJsonApi(folder, 'folder-summary', 'key');

export const folderSummaryFromJsonApi = (jsonApi: FolderSummaryJsonApi): FolderSummary =>
  fromJsonApi(jsonApi, 'folder-summary', 'key');

// Revision transformers
// id uses composite "key/revision" to satisfy JSON:API §7.2.1 (LCMS-286).
// key is kept in attributes so the proxy can reconstruct the domain entity without parsing the id.
export const revisionToJsonApi = (rev: Revision): RevisionJsonApi => {
  const { type: _type, ...attributes } = rev;
  return { type: 'revision', id: `${rev.key}/${rev.revision}`, attributes };
};

export const revisionFromJsonApi = (jsonApi: RevisionJsonApi): Revision => ({
  type: 'revision',
  ...jsonApi.attributes,
});

export const revisionCreateToJsonApi = (rev: RevisionCreate): RevisionCreateJsonApi =>
  toJsonApi(rev, 'revision', 'key');

export const revisionCreateFromJsonApi = (jsonApi: RevisionCreateJsonApi): RevisionCreate => {
  const rev = fromJsonApi(jsonApi, 'revision', 'key');
  return { ...rev, language: rev.language ?? 'und' };
};

export const revisionSummaryToJsonApi = (rev: RevisionSummary): RevisionSummaryJsonApi => {
  const { type: _type, ...attributes } = rev;
  return { type: 'revision-summary', id: `${rev.key}/${rev.revision}`, attributes };
};

export const revisionSummaryFromJsonApi = (jsonApi: RevisionSummaryJsonApi): RevisionSummary => ({
  type: 'revision-summary',
  ...jsonApi.attributes,
});

// ===== JSON:API SCHEMAS FOR VALIDATION =====

// Document JSON:API Schemas
export const DocumentJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('published'),
  id: S.String,
  attributes: S.Struct({
    status: S.Literal('published'),
    content: S.Record(S.String, S.Unknown),
    createdAt: S.optional(S.String),
    updatedAt: S.optional(S.String),
  }),
}));

export const DocumentSummaryJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Union([S.Literal('published'), S.Literal('published-summary')]),
  id: S.String,
  attributes: S.Struct({
    status: S.Literal('published'),
    createdAt: S.optional(S.String),
    updatedAt: S.optional(S.String),
  }),
}));

// Unpublished JSON:API Schemas
export const UnpublishedJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('unpublished'),
  id: S.String,
  attributes: S.Struct({
    status: S.String,
    content: S.Record(S.String, S.Unknown),
    createdAt: S.optional(S.String),
    updatedAt: S.optional(S.String),
  }),
}));

export const UnpublishedSummaryJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Union([S.Literal('unpublished'), S.Literal('unpublished-summary')]),
  id: S.String,
  attributes: S.Struct({
    status: S.String,
    createdAt: S.optional(S.String),
    updatedAt: S.optional(S.String),
  }),
}));

// Revision JSON:API Schemas
export const RevisionJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('revision'),
  id: S.String,
  attributes: S.Struct({
    revision: S.String,
    content: S.Record(S.String, S.Unknown),
    createdAt: S.String,
    updatedAt: S.optional(S.String),
  }),
}));

export const RevisionSummaryJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Union([S.Literal('revision'), S.Literal('revision-summary')]),
  id: S.String,
  attributes: S.Struct({
    revision: S.String,
    createdAt: S.String,
    updatedAt: S.optional(S.String),
  }),
}));

// ===== DECODERS =====

export const decodeDocumentJsonApi = S.decodeUnknownSync(DocumentJsonApiSchema);
export const decodeDocumentSummaryJsonApi = S.decodeUnknownSync(DocumentSummaryJsonApiSchema);
export const decodeUnpublishedJsonApi = S.decodeUnknownSync(UnpublishedJsonApiSchema);
export const decodeUnpublishedSummaryJsonApi = S.decodeUnknownSync(UnpublishedSummaryJsonApiSchema);
export const decodeRevisionJsonApi = S.decodeUnknownSync(RevisionJsonApiSchema);
export const decodeRevisionSummaryJsonApi = S.decodeUnknownSync(RevisionSummaryJsonApiSchema);

// ===== LOCKS (ADR-007) =====

/**
 * Serialise the **public** projection of a lock. Timestamps go on the wire as
 * ISO strings; the bearer token is not part of this shape at all, so a reader
 * polling `GET /locks/{key}` cannot end up holding one.
 */
export function lockToJsonApiAttributes(lock: Lock): {
  key: string,
  owner: { id: string, name: string },
  acquiredAt: string,
  expiresAt: string,
} {
  return {
    key: lock.key,
    owner: { id: lock.owner.id, name: lock.owner.name },
    acquiredAt: DateTime.formatIso(lock.acquiredAt),
    expiresAt: DateTime.formatIso(lock.expiresAt),
  };
}

/**
 * Serialise a lock for the caller that just acquired or refreshed it. This is
 * the only response shape that carries the token.
 */
export function ownedLockToJsonApi(lock: OwnedLock, basePath: string): {
  type: 'lock',
  id: string,
  attributes: ReturnType<typeof lockToJsonApiAttributes> & { token: string },
  links: { self: string },
} {
  return {
    type: 'lock',
    id: lock.key,
    attributes: { ...lockToJsonApiAttributes(lock), token: lock.token },
    links: { self: `${basePath}/locks/${encodeURIComponent(lock.key)}` },
  };
}

export const LockJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('lock'),
  id: S.String,
  attributes: S.Struct({
    key: S.String,
    owner: S.Struct({ id: S.String, name: S.String }),
    acquiredAt: S.String,
    expiresAt: S.String,
    token: S.optional(S.String),
  }),
}));

export const decodeLockJsonApi = S.decodeUnknownSync(LockJsonApiSchema);
