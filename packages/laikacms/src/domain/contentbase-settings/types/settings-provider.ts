import type { JSONSchema7 } from 'json-schema';
import type { LaikaTask } from 'laikacms/core';
import type { ContentBaseSettings, DocumentCollectionSettings, MediaCollectionSettings } from '../entities/settings.js';

export abstract class ContentBaseSettingsProvider {
  abstract getSettings(): LaikaTask.LaikaTask<ContentBaseSettings>;
  abstract putSettings(settings: ContentBaseSettings): LaikaTask.LaikaTask<void>;
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
