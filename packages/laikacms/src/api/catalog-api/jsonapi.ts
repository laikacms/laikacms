import * as S from 'effect/Schema';
import {
  type CollectionSettings,
  type DocumentCollectionSettings,
  type MediaCollectionSettings,
} from 'laikacms/catalog';
import { toJsonApi } from 'laikacms/json-api';

// Re-export common JSON:API utilities
export {
  fromJsonApi,
  JsonApiDeleteMultipleSchema,
  JsonApiDeleteSchema,
  type JsonApiError,
  JsonApiErrorSchema,
  toJsonApi,
} from 'laikacms/json-api';

// ===== JSON:API RESOURCE TYPES =====

export interface DocumentCollectionJsonApi {
  type: 'document-collection';
  id: string;
  attributes: Omit<DocumentCollectionSettings, 'key' | 'type'>;
}

export interface MediaCollectionJsonApi {
  type: 'media-collection';
  id: string;
  attributes: Omit<MediaCollectionSettings, 'key' | 'type'>;
}

export type CollectionJsonApi = DocumentCollectionJsonApi | MediaCollectionJsonApi;

// ===== TRANSFORMER FUNCTIONS =====

// Document Collection transformers
export const documentCollectionToJsonApi = (collection: DocumentCollectionSettings): DocumentCollectionJsonApi =>
  toJsonApi(collection, 'document-collection', 'key');

// The resource type ('document-collection') differs from the domain type ('document'), so we
// cannot rely on fromJsonApi's envelope injection and must hardcode the domain type here.
export const documentCollectionFromJsonApi = (
  jsonApi: DocumentCollectionJsonApi,
): DocumentCollectionSettings => {
  const { draftDirectory, archiveDirectory, trashDirectory, unpublishedStatuses, ...rest } = jsonApi.attributes as
    & typeof jsonApi.attributes
    & {
      draftDirectory?: string,
      archiveDirectory?: string,
      trashDirectory?: string,
    };
  // Build shorthand entries; explicit unpublishedStatuses keys win over shorthands.
  const shorthand: Record<string, { directory: string, name: string }> = {};
  if (draftDirectory) shorthand.draft = { directory: draftDirectory, name: 'Draft' };
  if (archiveDirectory) shorthand.archived = { directory: archiveDirectory, name: 'Archived' };
  if (trashDirectory) shorthand.trash = { directory: trashDirectory, name: 'Trash' };
  const merged = (Object.keys(shorthand).length > 0 || unpublishedStatuses)
    ? { ...shorthand, ...unpublishedStatuses }
    : undefined;
  return {
    type: 'document',
    key: jsonApi.id,
    ...rest,
    ...(merged ? { unpublishedStatuses: merged } : {}),
  } as DocumentCollectionSettings;
};

// Media Collection transformers
export const mediaCollectionToJsonApi = (collection: MediaCollectionSettings): MediaCollectionJsonApi =>
  toJsonApi(collection, 'media-collection', 'key');

// The resource type ('media-collection') differs from the domain type ('media').
export const mediaCollectionFromJsonApi = (
  jsonApi: MediaCollectionJsonApi,
): MediaCollectionSettings => ({ type: 'media', key: jsonApi.id, ...jsonApi.attributes } as MediaCollectionSettings);

// Generic Collection transformers
export const collectionToJsonApi = (collection: CollectionSettings): CollectionJsonApi => {
  if (collection.type === 'document') {
    return documentCollectionToJsonApi(collection);
  } else {
    return mediaCollectionToJsonApi(collection);
  }
};

export const collectionFromJsonApi = (jsonApi: CollectionJsonApi): CollectionSettings => {
  if (jsonApi.type === 'document-collection') {
    return documentCollectionFromJsonApi(jsonApi as DocumentCollectionJsonApi);
  } else {
    return mediaCollectionFromJsonApi(jsonApi as MediaCollectionJsonApi);
  }
};

// ===== JSON:API SCHEMAS FOR VALIDATION =====

export const DocumentCollectionJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('document-collection'),
  id: S.String,
  attributes: S.Struct({
    name: S.optional(S.String),
    directory: S.optional(S.String),
    recursive: S.optional(S.Boolean),
    format: S.optional(S.String),
    documentTitleKey: S.optional(S.String),
    documentDescriptionKey: S.optional(S.String),
    documentStatusKey: S.optional(S.String),
    unpublishedStatuses: S.optional(S.Record(
      S.String,
      S.Struct({
        directory: S.String,
        name: S.String,
      }),
    )),
    revisionDirectory: S.optional(S.String),
    // Shorthand convenience fields — merged into unpublishedStatuses during decoding.
    // Explicit unpublishedStatuses keys win over shorthands on the same status key.
    draftDirectory: S.optional(S.String),
    archiveDirectory: S.optional(S.String),
    trashDirectory: S.optional(S.String),
  }),
}));

export const MediaCollectionJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('media-collection'),
  id: S.String,
  attributes: S.Struct({
    name: S.optional(S.String),
    directory: S.optional(S.String),
    recursive: S.optional(S.Boolean),
    accept: S.optional(S.Array(S.String)),
    url: S.optional(S.String),
    pathFormat: S.optional(S.String),
  }),
}));

export const CollectionJsonApiSchema = S.Union([
  DocumentCollectionJsonApiSchema,
  MediaCollectionJsonApiSchema,
]);

// ===== DECODERS =====

export const decodeDocumentCollectionJsonApi = S.decodeUnknownSync(DocumentCollectionJsonApiSchema);
export const decodeMediaCollectionJsonApi = S.decodeUnknownSync(MediaCollectionJsonApiSchema);
export const decodeCollectionJsonApi = S.decodeUnknownSync(CollectionJsonApiSchema);

// Type exports
export type CollectionInsertJsonApi = CollectionJsonApi;
export type CollectionUpdateJsonApi = CollectionJsonApi;
