import { Result } from "effect/Result";
import { ContentBaseSettings, DocumentCollectionSettings, MediaCollectionSettings } from "../entities/settings.js";
import { JSONSchema7 } from "json-schema";
import { LaikaError } from "@laikacms/core";

export abstract class ContentBaseSettingsProvider {
  abstract getSettings(): Promise<Result<ContentBaseSettings, LaikaError>>;
  abstract putSettings(settings: ContentBaseSettings): Promise<Result<void, LaikaError>>;
  abstract getDocumentCollectionSettings(
    collection: string
  ): Promise<Result<DocumentCollectionSettings, LaikaError>>;
  abstract putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings
  ): Promise<Result<void, LaikaError>>;
  abstract getMediaCollectionSettings(
    collection: string
  ): Promise<Result<MediaCollectionSettings, LaikaError>>;
  abstract putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings
  ): Promise<Result<void, LaikaError>>;
  abstract getCollectionSchema(
    collection: string
  ): Promise<Result<JSONSchema7, LaikaError>>;
  abstract putCollectionSchema(
    collection: string,
    schema: JSONSchema7
  ): Promise<Result<void, LaikaError>>;
}