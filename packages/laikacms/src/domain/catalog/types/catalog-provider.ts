import type { JSONSchema7 } from 'json-schema';
import type { LaikaTask } from 'laikacms/core';
import type { Catalog, DocumentCollectionSettings, MediaCollectionSettings } from '../entities/catalog.js';

export abstract class CatalogProvider {
  abstract getCatalog(): LaikaTask.LaikaTask<Catalog>;
  abstract putCatalog(settings: Catalog): LaikaTask.LaikaTask<void>;
  abstract getDocumentCollectionSettings(
    collection: string,
  ): LaikaTask.LaikaTask<DocumentCollectionSettings>;
  abstract putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): LaikaTask.LaikaTask<void>;
  abstract getMediaCollectionSettings(
    collection: string,
  ): LaikaTask.LaikaTask<MediaCollectionSettings>;
  abstract putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings,
  ): LaikaTask.LaikaTask<void>;
  abstract getCollectionSchema(
    collection: string,
  ): LaikaTask.LaikaTask<JSONSchema7>;
  abstract putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): LaikaTask.LaikaTask<void>;
}
