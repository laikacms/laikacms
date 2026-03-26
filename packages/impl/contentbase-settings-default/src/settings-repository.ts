import { StorageRepository } from "@laikacms/storage";
import {
  Result,
  success,
  failure,
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

export class DefaultContentBaseSettingsProvider extends ContentBaseSettingsProvider {
  constructor(private readonly storage: StorageRepository) {
    super();
  }

  async getCollectionSettings(collection: string): Promise<Result<CollectionSettings>> {
    const settings = await this.getSettings();
    if (!settings.success) return settings;
    const collectionSettings = settings.data.collections[collection];
    if (!collectionSettings) return success({
      key: collection,
      type: 'document',
      name: lodash.startCase(collection),
      directory: collection,
      trashDirectory: `.contentbase/trash/${collection}`,
      draftDirectory: `.contentbase/drafts/${collection}`,
      archiveDirectory: `.contentbase/archive/${collection}`,
      revisionDirectory: `.contentbase/revisions/${collection}`,
      recursive: true,
    })
    return success(collectionSettings);
  }

  async getDocumentCollectionSettings(collection: string): Promise<Result<DocumentCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (!collectionSettings.success) return collectionSettings;
    console.log('Document collection settings:', collectionSettings);
    if (collectionSettings.data.type !== 'document') {
      return failure(InvalidData.CODE, [`Settings for document collection '${collection}' are of type '${collectionSettings.data.type}' not of type 'document'.`]);
    }
    return success(collectionSettings.data, collectionSettings.messages);
  }

  async getMediaCollectionSettings(collection: string): Promise<Result<MediaCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (!collectionSettings.success) return collectionSettings;
    if (collectionSettings.data.type !== 'media') {
      return failure(InvalidData.CODE, [`Settings for media collection '${collection}' are of type '${collectionSettings.data.type}' not of type 'media'.`]);
    }
    return success(collectionSettings.data, collectionSettings.messages);
  }

  async putCollectionSettings(collection: string, settings: CollectionSettings): Promise<Result<void>> {
    const currentSettingsResult = await this.getSettings();
    if (!currentSettingsResult.success) return currentSettingsResult;
    const currentSettings = currentSettingsResult.data;
    currentSettings.collections[collection] = settings;
    const result = await this.putSettings(currentSettings);
    if (!result.success) return failure(result.code, result.messages);
    return success(undefined, result.messages);
  }

  async putMediaCollectionSettings(collection: string, settings: MediaCollectionSettings): Promise<Result<void>> {
    const result = this.putCollectionSettings(collection, settings);
    return result;
  }

  async putDocumentCollectionSettings(collection: string, settings: DocumentCollectionSettings): Promise<Result<void>> {
    const result = this.putCollectionSettings(collection, settings);
    return result;
  }

  async putSettings(settings: ContentBaseSettings): Promise<Result<void>> {
    // Update settings file
    const settingsResult = await this.storage.createOrUpdateObject({
      key: `.contentbase/settings.json`,
      type: "object",
      content: settings
    });
    if (!settingsResult.success) return failure(settingsResult.code, settingsResult.messages);
    return success(undefined, settingsResult.messages);
  }

  async getCollectionSchema(collection: string): Promise<Result<JSONSchema7>> {
    const schema = await this.storage.getObject(`.contentbase/schemas/${collection}.json`);
    if (!schema.success) return schema;
    const jsonSchema = schema.data.content as JSONSchema7;
    return success(jsonSchema);
  }

  async putCollectionSchema(
    collection: string,
    schema: JSONSchema7
  ): Promise<Result<void>> {
    await this.storage.createOrUpdateObject(
      {
        key: `.contentbase/schemas/${collection}.json`,
        type: "object",
        content: schema,
      }
    );
    return success(undefined);
  }

  override getSettings = async (): Promise<Result<ContentBaseSettings>> => {
    console.log('get settings called');
    const settingsFile = await this.storage.getObject(`.contentbase/settings.json`);
    if (!settingsFile.success) {
      console.log('getSettings: failed to get settings file.', settingsFile);
      if (settingsFile.code === NotFoundError.CODE) {
        // Create default settings file
        console.log('getSettings: settings file not found, creating default.', settingsFile, { code: settingsFile.code, code2:  NotFoundError.CODE });
        const defaultSettings = createDefaultSettingsFile();
        const createResult = await this.storage.createOrUpdateObject({
          key: `.contentbase/settings.json`,
          type: "object",
          content: defaultSettings,
        });
        console.log('getSettings: created default settings file.', createResult);
        if (!createResult.success) return createResult;
        return success(defaultSettings);
      }
      return settingsFile;
    }

    const parsedSettings = parseSettings(settingsFile.data.content);
    if (!parsedSettings.success) return parsedSettings;
    return success(parsedSettings.data);
  };
}
