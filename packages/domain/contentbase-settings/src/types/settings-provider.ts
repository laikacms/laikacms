import { Result } from "@laikacms/core";
import { ContentBaseSettings, DocumentCollectionSettings, MediaCollectionSettings } from "../entities/settings.js";
import { JSONSchema7 } from "json-schema";

export abstract class ContentBaseSettingsProvider {
  abstract getSettings(): Promise<Result<ContentBaseSettings>>;
  abstract putSettings(settings: ContentBaseSettings): Promise<Result<void>>;
  abstract getDocumentCollectionSettings(
    collection: string
  ): Promise<Result<DocumentCollectionSettings>>;
  abstract putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings
  ): Promise<Result<void>>;
  abstract getMediaCollectionSettings(
    collection: string
  ): Promise<Result<MediaCollectionSettings>>;
  abstract putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings
  ): Promise<Result<void>>;
  abstract getCollectionSchema(
    collection: string
  ): Promise<Result<JSONSchema7>>;
  abstract putCollectionSchema(
    collection: string,
    schema: JSONSchema7
  ): Promise<Result<void>>;
}