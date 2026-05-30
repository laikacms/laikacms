import type { JSONSchema7 } from 'json-schema';
import type { LaikaResult } from 'laikacms/core';
import type { ContentBaseSettings, DocumentCollectionSettings, MediaCollectionSettings } from '../entities/settings.js';

export abstract class ContentBaseSettingsProvider {
  abstract getSettings(): AsyncGenerator<LaikaResult<ContentBaseSettings>>;
  abstract putSettings(settings: ContentBaseSettings): AsyncGenerator<LaikaResult<void>>;
  abstract getDocumentCollectionSettings(
    collection: string,
  ): AsyncGenerator<LaikaResult<DocumentCollectionSettings>>;
  abstract putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): AsyncGenerator<LaikaResult<void>>;
  abstract getMediaCollectionSettings(
    collection: string,
  ): AsyncGenerator<LaikaResult<MediaCollectionSettings>>;
  abstract putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings,
  ): AsyncGenerator<LaikaResult<void>>;
  abstract getCollectionSchema(
    collection: string,
  ): AsyncGenerator<LaikaResult<JSONSchema7>>;
  abstract putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): AsyncGenerator<LaikaResult<void>>;
}
