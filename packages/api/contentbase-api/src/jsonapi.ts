import {
  collectionSettingsZ,
  mediaCollectionSettingsZ,
  documentCollectionSettingsZ
} from '@laikacms/contentbase-settings'
import {
  toJsonApi,
  fromJsonApi,
} from '@laikacms/json-api';
import z from 'zod';

// Re-export common JSON:API utilities
export {
  toJsonApi,
  fromJsonApi,
  jsonApiDeleteZ,
  jsonApiDeleteMultipleZ,
  jsonApiErrorZ,
  type JsonApiError,
} from '@laikacms/json-api';

// Collection schemas with key field for JSON:API
// These extend the base collection settings with a key identifier

// From JSON:API to domain
const documentCollectionInsertFromJsonApiZ = fromJsonApi(documentCollectionSettingsZ, 'document-collection', 'key');
const documentCollectionUpdateFromJsonApiZ = fromJsonApi(documentCollectionSettingsZ, 'document-collection', 'key');
const documentCollectionFromJsonApiZ = fromJsonApi(documentCollectionSettingsZ, 'document-collection', 'key');

const mediaCollectionInsertFromJsonApiZ = fromJsonApi(mediaCollectionSettingsZ, 'media-collection', 'key');
const mediaCollectionUpdateFromJsonApiZ = fromJsonApi(mediaCollectionSettingsZ, 'media-collection', 'key');
const mediaCollectionFromJsonApiZ = fromJsonApi(mediaCollectionSettingsZ, 'media-collection', 'key');

// Union types
export const collectionInsertZ = z.union([
  documentCollectionInsertFromJsonApiZ,
  mediaCollectionInsertFromJsonApiZ,
]);
export const collectionUpdateZ = z.union([
  documentCollectionUpdateFromJsonApiZ,
  mediaCollectionUpdateFromJsonApiZ,
]);
export const collectionZ = z.union([
  documentCollectionFromJsonApiZ,
  mediaCollectionFromJsonApiZ,
]);

// To JSON:API from domain
export const documentCollectionInsertToJsonApiZ = toJsonApi(documentCollectionSettingsZ, 'document-collection', 'key');
export const documentCollectionUpdateToJsonApiZ = toJsonApi(documentCollectionSettingsZ, 'document-collection', 'key');
export const documentCollectionToJsonApiZ = toJsonApi(documentCollectionSettingsZ, 'document-collection', 'key');

export const mediaCollectionInsertToJsonApiZ = toJsonApi(mediaCollectionSettingsZ, 'media-collection', 'key');
export const mediaCollectionUpdateToJsonApiZ = toJsonApi(mediaCollectionSettingsZ, 'media-collection', 'key');
export const mediaCollectionToJsonApiZ = toJsonApi(mediaCollectionSettingsZ, 'media-collection', 'key');

// Union types
export const collectionInsertFromJsonApiZ = z.union([
  documentCollectionInsertFromJsonApiZ,
  mediaCollectionInsertFromJsonApiZ,
]);
export const collectionUpdateFromJsonApiZ = z.union([
  documentCollectionUpdateFromJsonApiZ,
  mediaCollectionUpdateFromJsonApiZ,
]);
export const collectionToJsonApiZ = z.union([
  documentCollectionToJsonApiZ,
  mediaCollectionToJsonApiZ,
]);

// Type exports
export type CollectionInsertJsonApi = z.infer<typeof collectionInsertFromJsonApiZ>;
export type CollectionUpdateJsonApi = z.infer<typeof collectionUpdateFromJsonApiZ>;
export type CollectionJsonApi = z.infer<typeof collectionToJsonApiZ>;
