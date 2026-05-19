import * as S from 'effect/Schema';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  FolderSummary,
  StorageObject,
  StorageObjectCreate,
  StorageObjectSummary,
  StorageObjectUpdate,
} from 'laikacms/storage';

// Re-export common JSON:API utilities
export {
  type AtomicOperation,
  AtomicOperationSchema,
  type AtomicOperationsRequest,
  AtomicOperationsRequestSchema,
  type AtomicOperationsResponse,
  AtomicOperationsResponseSchema,
  buildPaginationLinks,
  type JsonApiCollectionResponse,
  JsonApiCollectionResponseSchema,
  JsonApiDeleteMultipleSchema,
  JsonApiDeleteSchema,
  type JsonApiError,
  JsonApiErrorSchema,
  type JsonApiLinks,
  JsonApiLinksSchema,
  type JsonApiResource,
  parsePaginationQuery,
} from 'laikacms/json-api';

// JSON:API resource types
//
// Storage objects carry a `metadata` field at the domain level (extension,
// revisionId, plus backend-specific keys). Per JSON:API spec we route that
// to the resource's top-level `meta` member rather than burying it inside
// `attributes`. The To/From converters below handle the lift/drop so the
// domain `metadata` field stays available on `StorageObject` while the wire
// format uses `meta`.
export interface JsonApiStorageObject {
  type: 'object';
  id: string;
  attributes: Omit<StorageObject, 'key' | 'metadata'>;
  meta?: NonNullable<StorageObject['metadata']>;
}

export interface JsonApiStorageObjectCreate {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectCreate, 'key' | 'metadata'>;
  meta?: NonNullable<StorageObjectCreate['metadata']>;
}

export interface JsonApiStorageObjectUpdate {
  type: 'object';
  id: string;
  attributes: Omit<StorageObjectUpdate, 'key' | 'metadata'>;
  meta?: NonNullable<StorageObjectUpdate['metadata']>;
}

export interface JsonApiFolder {
  type: 'folder';
  id: string;
  attributes: Omit<Folder, 'key'>;
}

export interface JsonApiFolderCreate {
  type: 'folder';
  id: string;
  attributes: Omit<FolderCreate, 'key'>;
}

export interface JsonApiStorageObjectSummary {
  type: 'object-summary';
  id: string;
  attributes: Omit<StorageObjectSummary, 'key'>;
}

export interface JsonApiFolderSummary {
  type: 'folder-summary';
  id: string;
  attributes: Omit<FolderSummary, 'key'>;
}

// To JSON:API converters
export function storageObjectToJsonApi(obj: StorageObject): JsonApiStorageObject {
  const { key, metadata, ...attributes } = obj;
  return { type: 'object', id: key, attributes, ...(metadata ? { meta: metadata } : {}) };
}

export function storageObjectCreateToJsonApi(obj: StorageObjectCreate): JsonApiStorageObjectCreate {
  const { key, metadata, ...attributes } = obj;
  return { type: 'object', id: key, attributes, ...(metadata ? { meta: metadata } : {}) };
}

export function storageObjectUpdateToJsonApi(obj: StorageObjectUpdate): JsonApiStorageObjectUpdate {
  const { key, metadata, ...attributes } = obj;
  return { type: 'object', id: key, attributes, ...(metadata ? { meta: metadata } : {}) };
}

export function folderToJsonApi(folder: Folder): JsonApiFolder {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function folderCreateToJsonApi(folder: FolderCreate): JsonApiFolderCreate {
  const { key, ...attributes } = folder;
  return { type: 'folder', id: key, attributes };
}

export function storageObjectSummaryToJsonApi(obj: StorageObjectSummary): JsonApiStorageObjectSummary {
  const { key, ...attributes } = obj;
  return { type: 'object-summary', id: key, attributes };
}

export function folderSummaryToJsonApi(folder: FolderSummary): JsonApiFolderSummary {
  const { key, ...attributes } = folder;
  return { type: 'folder-summary', id: key, attributes };
}

// From JSON:API converters
export function storageObjectFromJsonApi(jsonApi: JsonApiStorageObject): StorageObject {
  return {
    key: jsonApi.id,
    ...jsonApi.attributes,
    ...(jsonApi.meta ? { metadata: jsonApi.meta } : {}),
  } as StorageObject;
}

export function storageObjectCreateFromJsonApi(jsonApi: JsonApiStorageObjectCreate): StorageObjectCreate {
  return {
    key: jsonApi.id,
    ...jsonApi.attributes,
    ...(jsonApi.meta ? { metadata: jsonApi.meta } : {}),
  } as StorageObjectCreate;
}

export function storageObjectUpdateFromJsonApi(jsonApi: JsonApiStorageObjectUpdate): StorageObjectUpdate {
  return {
    key: jsonApi.id,
    ...jsonApi.attributes,
    ...(jsonApi.meta ? { metadata: jsonApi.meta } : {}),
  } as StorageObjectUpdate;
}

export function folderFromJsonApi(jsonApi: JsonApiFolder): Folder {
  return { key: jsonApi.id, ...jsonApi.attributes } as Folder;
}

export function folderCreateFromJsonApi(jsonApi: JsonApiFolderCreate): FolderCreate {
  return { key: jsonApi.id, ...jsonApi.attributes } as FolderCreate;
}

export function storageObjectSummaryFromJsonApi(jsonApi: JsonApiStorageObjectSummary): StorageObjectSummary {
  return { key: jsonApi.id, ...jsonApi.attributes } as StorageObjectSummary;
}

export function folderSummaryFromJsonApi(jsonApi: JsonApiFolderSummary): FolderSummary {
  return { key: jsonApi.id, ...jsonApi.attributes } as FolderSummary;
}

// Union types for atoms
export type JsonApiAtom = JsonApiStorageObject | JsonApiFolder;
export type JsonApiAtomCreate = JsonApiStorageObjectCreate | JsonApiFolderCreate;
export type JsonApiAtomSummary = JsonApiStorageObjectSummary | JsonApiFolderSummary;

export function atomToJsonApi(atom: StorageObject | Folder): JsonApiAtom {
  if (atom.type === 'object') {
    return storageObjectToJsonApi(atom);
  }
  return folderToJsonApi(atom);
}

export function atomSummaryToJsonApi(atom: StorageObjectSummary | FolderSummary): JsonApiAtomSummary {
  if (atom.type === 'object-summary') {
    return storageObjectSummaryToJsonApi(atom);
  }
  return folderSummaryToJsonApi(atom);
}

export function atomFromJsonApi(jsonApi: JsonApiAtom): Atom {
  if (jsonApi.type === 'object') {
    return storageObjectFromJsonApi(jsonApi);
  }
  return folderFromJsonApi(jsonApi);
}

/**
 * Decorate a converted resource with `links.self` per JSON:API spec. The
 * type→URL mapping lives here because converters themselves are pathless.
 *
 * Summaries inherit the URL of their full counterpart
 * (`object-summary` → `/objects/{key}`) so a list client can follow into
 * detail without code-level knowledge of route names.
 */
export function withSelfLink<R extends { type: string, id: string, links?: Record<string, string> }>(
  resource: R,
  basePath: string,
): R {
  const path = selfPathFor(resource.type, resource.id);
  if (!path) return resource;
  return {
    ...resource,
    links: { ...(resource.links ?? {}), self: `${basePath}${path}` },
  };
}

const selfPathFor = (type: string, id: string): string | undefined => {
  const encoded = encodeURIComponent(id);
  switch (type) {
    case 'object':
    case 'object-summary':
      return `/objects/${encoded}`;
    case 'folder':
    case 'folder-summary':
      return `/folders/${encoded}`;
    case 'storage-capabilities':
      return `/capabilities`;
    default:
      return undefined;
  }
};

export function atomSummaryFromJsonApi(jsonApi: JsonApiAtomSummary): AtomSummary {
  if (jsonApi.type === 'object-summary') {
    return storageObjectSummaryFromJsonApi(jsonApi);
  }
  return folderSummaryFromJsonApi(jsonApi);
}

// Effect Schema definitions for JSON:API resources
export const JsonApiStorageObjectSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
  meta: S.optional(S.Record(S.String, S.Unknown)),
}));

export const JsonApiStorageObjectCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
  meta: S.optional(S.Record(S.String, S.Unknown)),
}));

export const JsonApiStorageObjectUpdateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
  meta: S.optional(S.Record(S.String, S.Unknown)),
}));

export const JsonApiFolderSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
}));

export const JsonApiFolderCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
}));

export const JsonApiStorageObjectSummarySchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object-summary'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
}));

export const JsonApiFolderSummarySchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder-summary'),
  id: S.String,
  attributes: S.Record(S.String, S.Unknown),
}));

export const JsonApiAtomSchema = S.Union([JsonApiStorageObjectSchema, JsonApiFolderSchema]);
export const JsonApiAtomSummarySchema = S.Union([JsonApiStorageObjectSummarySchema, JsonApiFolderSummarySchema]);

// Decoders for validation
export const decodeJsonApiStorageObject = S.decodeUnknownSync(JsonApiStorageObjectSchema);
export const decodeJsonApiStorageObjectCreate = S.decodeUnknownSync(JsonApiStorageObjectCreateSchema);
export const decodeJsonApiStorageObjectUpdate = S.decodeUnknownSync(JsonApiStorageObjectUpdateSchema);
export const decodeJsonApiFolder = S.decodeUnknownSync(JsonApiFolderSchema);
export const decodeJsonApiFolderCreate = S.decodeUnknownSync(JsonApiFolderCreateSchema);
export const decodeJsonApiAtom = S.decodeUnknownSync(JsonApiAtomSchema);
export const decodeJsonApiAtomSummary = S.decodeUnknownSync(JsonApiAtomSummarySchema);
