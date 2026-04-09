import {
  type CollectionSettings,
  type DocumentCollectionSettings,
  type MediaCollectionSettings,
} from '@laikacms/contentbase-settings';
import { fromJsonApi, toJsonApi } from '@laikacms/json-api';
import * as S from 'effect/Schema';

// Re-export common JSON:API utilities
export {
  fromJsonApi,
  JsonApiDeleteMultipleSchema,
  JsonApiDeleteSchema,
  type JsonApiError,
  JsonApiErrorSchema,
  toJsonApi,
} from '@laikacms/json-api';

// ===== JSON:API RESOURCE TYPES =====

export interface DocumentCollectionJsonApi {
  type: 'document-collection';
  id: string;
  attributes: Omit<DocumentCollectionSettings, 'key'>;
}

export interface MediaCollectionJsonApi {
  type: 'media-collection';
  id: string;
  attributes: Omit<MediaCollectionSettings, 'key'>;
}

export type CollectionJsonApi = DocumentCollectionJsonApi | MediaCollectionJsonApi;

// ===== TRANSFORMER FUNCTIONS =====

// Document Collection transformers
export const documentCollectionToJsonApi = (collection: DocumentCollectionSettings): DocumentCollectionJsonApi =>
  toJsonApi(collection, 'document-collection', 'key');

export const documentCollectionFromJsonApi = (jsonApi: DocumentCollectionJsonApi): DocumentCollectionSettings =>
  fromJsonApi(jsonApi, 'document-collection', 'key');

// Media Collection transformers
export const mediaCollectionToJsonApi = (collection: MediaCollectionSettings): MediaCollectionJsonApi =>
  toJsonApi(collection, 'media-collection', 'key');

export const mediaCollectionFromJsonApi = (jsonApi: MediaCollectionJsonApi): MediaCollectionSettings =>
  fromJsonApi(jsonApi, 'media-collection', 'key');

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
    type: S.Literal('document'),
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
    draftDirectory: S.optional(S.String),
    archiveDirectory: S.optional(S.String),
    trashDirectory: S.optional(S.String),
  }),
}));

export const MediaCollectionJsonApiSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('media-collection'),
  id: S.String,
  attributes: S.Struct({
    type: S.Literal('media'),
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
