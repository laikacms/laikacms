import { StorageRepository } from "@laikacms/storage";
import {
  LaikaError,
  LaikaResult,
  NotFoundError,
  InvalidData,
} from "@laikacms/core";
import {
  CollectionSettings,
  ContentBaseSettings,
  ContentBaseSettingsProvider,
  createDefaultSettingsFile,
  DocumentCollectionSettings,
  MediaCollectionSettings,
  parseSettings,
} from "@laikacms/contentbase-settings";
import type { JSONSchema7 } from 'json-schema'
import lodash from "lodash";
import * as Result from 'effect/Result';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/**
 * Helper to get the first result from an async generator
 */
async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  for await (const result of gen) {
    return result;
  }
  return Result.fail(new NotFoundError('No result from generator'));
}

export class DefaultContentBaseSettingsProvider extends ContentBaseSettingsProvider {
  constructor(private readonly storage: StorageRepository) {
    super();
  }

  async getCollectionSettings(collection: string): Promise<LaikaResult<CollectionSettings>> {
    const settings = await this.getSettings();
    if (Result.isFailure(settings)) return failAs<CollectionSettings>(settings.failure);
    const collectionSettings = settings.success.collections[collection];
    if (!collectionSettings) return Result.succeed({
      key: collection,
      type: 'document',
      name: lodash.startCase(collection),
      directory: collection,
      trashDirectory: `.contentbase/trash/${collection}`,
      draftDirectory: `.contentbase/drafts/${collection}`,
      archiveDirectory: `.contentbase/archive/${collection}`,
      revisionDirectory: `.contentbase/revisions/${collection}`,
      recursive: true,
    } as CollectionSettings);
    return Result.succeed(collectionSettings);
  }

  async getDocumentCollectionSettings(collection: string): Promise<LaikaResult<DocumentCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (Result.isFailure(collectionSettings)) return failAs<DocumentCollectionSettings>(collectionSettings.failure);
    console.log('Document collection settings:', collectionSettings);
    if (collectionSettings.success.type !== 'document') {
      return Result.fail(new InvalidData(`Settings for document collection '${collection}' are of type '${collectionSettings.success.type}' not of type 'document'.`));
    }
    return Result.succeed(collectionSettings.success as DocumentCollectionSettings);
  }

  async getMediaCollectionSettings(collection: string): Promise<LaikaResult<MediaCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (Result.isFailure(collectionSettings)) {
      return failAs<MediaCollectionSettings>(collectionSettings.failure);
    }
    if (collectionSettings.success.type !== 'media') {
      return Result.fail(new InvalidData(`Settings for media collection '${collection}' are of type '${collectionSettings.success.type}' not of type 'media'.`));
    }
    return Result.succeed(collectionSettings.success as MediaCollectionSettings);
  }

  async putCollectionSettings(collection: string, settings: CollectionSettings): Promise<LaikaResult<void>> {
    const currentSettingsResult = await this.getSettings();
    if (Result.isFailure(currentSettingsResult)) {
      return failAs<void>(currentSettingsResult.failure);
    }
    const currentSettings = currentSettingsResult.success;
    currentSettings.collections[collection] = settings;
    const result = await this.putSettings(currentSettings);
    if (Result.isFailure(result)) {
      return failAs<void>(result.failure);
    }
    return Result.succeed(undefined);
  }

  async putMediaCollectionSettings(collection: string, settings: MediaCollectionSettings): Promise<LaikaResult<void>> {
    const result = this.putCollectionSettings(collection, settings);
    return result;
  }

  async putDocumentCollectionSettings(collection: string, settings: DocumentCollectionSettings): Promise<LaikaResult<void>> {
    const result = this.putCollectionSettings(collection, settings);
    return result;
  }

  async putSettings(settings: ContentBaseSettings): Promise<LaikaResult<void>> {
    // Update settings file
    const settingsResult = await firstResult(this.storage.createOrUpdateObject({
      key: `.contentbase/settings.json`,
      type: "object",
      content: settings
    }));
    if (Result.isFailure(settingsResult)) return failAs<void>(settingsResult.failure);
    return Result.succeed(undefined);
  }

  async getCollectionSchema(collection: string): Promise<LaikaResult<JSONSchema7>> {
    const schema = await firstResult(this.storage.getObject(`.contentbase/schemas/${collection}.json`));
    if (Result.isFailure(schema)) return failAs<JSONSchema7>(schema.failure);
    const jsonSchema = schema.success.content as JSONSchema7;
    return Result.succeed(jsonSchema);
  }

  async putCollectionSchema(
    collection: string,
    schema: JSONSchema7
  ): Promise<LaikaResult<void>> {
    const result = await firstResult(this.storage.createOrUpdateObject(
      {
        key: `.contentbase/schemas/${collection}.json`,
        type: "object",
        content: schema,
      }
    ));
    if (Result.isFailure(result)) return failAs<void>(result.failure);
    return Result.succeed(undefined);
  }

  override getSettings = async (): Promise<LaikaResult<ContentBaseSettings>> => {
    console.log('get settings called');
    const settingsFile = await firstResult(this.storage.getObject(`.contentbase/settings.json`));
    if (Result.isFailure(settingsFile)) {
      console.log('getSettings: failed to get settings file.', settingsFile);
      if (settingsFile.failure.code === NotFoundError.CODE) {
        // Create default settings file
        console.log('getSettings: settings file not found, creating default.', settingsFile, { code: settingsFile.failure.code, code2: NotFoundError.CODE });
        const defaultSettings = createDefaultSettingsFile();
        const createResult = await firstResult(this.storage.createOrUpdateObject({
          key: `.contentbase/settings.json`,
          type: "object",
          content: defaultSettings,
        }));
        console.log('getSettings: created default settings file.', createResult);
        if (Result.isFailure(createResult)) return failAs<ContentBaseSettings>(createResult.failure);
        return Result.succeed(defaultSettings);
      }
      return failAs<ContentBaseSettings>(settingsFile.failure);
    }

    const parsedSettings = parseSettings(settingsFile.success.content);
    if (Result.isFailure(parsedSettings)) return failAs<ContentBaseSettings>(parsedSettings.failure);
    return Result.succeed(parsedSettings.success);
  };
}
