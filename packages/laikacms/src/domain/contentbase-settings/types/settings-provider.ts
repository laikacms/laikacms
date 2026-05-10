import type { LaikaError } from '@laikacms/core';
import type { Result } from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import type { ContentBaseSettings, DocumentCollectionSettings, MediaCollectionSettings } from '../entities/settings.js';

export abstract class ContentBaseSettingsProvider {
  abstract getSettings(): Promise<Result<ContentBaseSettings, LaikaError>>;
  abstract putSettings(settings: ContentBaseSettings): Promise<Result<void, LaikaError>>;
  abstract getDocumentCollectionSettings(
    collection: string,
  ): Promise<Result<DocumentCollectionSettings, LaikaError>>;
  abstract putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): Promise<Result<void, LaikaError>>;
  abstract getMediaCollectionSettings(
    collection: string,
  ): Promise<Result<MediaCollectionSettings, LaikaError>>;
  abstract putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings,
  ): Promise<Result<void, LaikaError>>;
  abstract getCollectionSchema(
    collection: string,
  ): Promise<Result<JSONSchema7, LaikaError>>;
  abstract putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): Promise<Result<void, LaikaError>>;
}
