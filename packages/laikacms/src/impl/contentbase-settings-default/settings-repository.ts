import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import type {
  CollectionSettings,
  ContentBaseSettings,
  DocumentCollectionSettings,
  MediaCollectionSettings,
} from 'laikacms/contentbase-settings';
import { ContentBaseSettingsProvider, createDefaultSettingsFile, parseSettings } from 'laikacms/contentbase-settings';
import type { LaikaError, LaikaResult } from 'laikacms/core';
import { InvalidData, LaikaTask, NotFoundError } from 'laikacms/core';
import type { StorageRepository } from 'laikacms/storage';

function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/** Run a LaikaTask and surface the resolved value as a LaikaResult. */
async function firstResult<T>(task: LaikaTask.LaikaTask<T>): Promise<LaikaResult<T>> {
  return Effect.runPromise(Effect.result(LaikaTask.runValue(task)));
}

const startCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

interface DefaultContentBaseSettingsProviderOptions {
  storage: StorageRepository;
}

export class DefaultContentBaseSettingsProvider extends ContentBaseSettingsProvider {
  private readonly storage: StorageRepository;

  constructor(options: DefaultContentBaseSettingsProviderOptions) {
    super();
    this.storage = options.storage;

    firstResult(this.storage.getCapabilities()).then(Result.getOrThrow).then(capabilities => {
      if (!capabilities.fileExtensions.supported) {
        console.warn(
          `Underlying storage repository for contentbase does not support file extensions. Contentbase requires a classic filesystem structure with folders and .json metadata files.`,
        );
      }
      if (
        capabilities.fileExtensions.supported
        && Object.keys(capabilities.fileExtensions.supportedExtensions).includes('json') === false
      ) {
        console.warn(
          `Underlying storage repository for contentbase does not support .json file extension. To keep Contentbase cross-compatible, the storage repository should support .json files for storing contentbase settings and metadata.`,
        );
      }
    });
  }

  /**
   * Look up a collection's configured settings. Returns `null` when the collection
   * isn't present in the settings file — the typed getters below synthesize a
   * type-appropriate default for that case.
   */
  private async getConfiguredCollectionSettings(
    collection: string,
  ): Promise<LaikaResult<CollectionSettings | null>> {
    const settings = await this.getSettings();
    if (Result.isFailure(settings)) return failAs<CollectionSettings | null>(settings.failure);
    const collections = settings.success.collections ?? {};
    return Result.succeed(collections[collection] ?? null);
  }

  async getCollectionSettings(collection: string): Promise<LaikaResult<CollectionSettings>> {
    const configured = await this.getConfiguredCollectionSettings(collection);
    if (Result.isFailure(configured)) return failAs<CollectionSettings>(configured.failure);
    return Result.succeed(configured.success ?? defaultDocumentCollectionSettings(collection));
  }

  async getDocumentCollectionSettings(collection: string): Promise<LaikaResult<DocumentCollectionSettings>> {
    const configured = await this.getConfiguredCollectionSettings(collection);
    if (Result.isFailure(configured)) return failAs<DocumentCollectionSettings>(configured.failure);
    if (configured.success === null) {
      return Result.succeed(defaultDocumentCollectionSettings(collection));
    }
    if (configured.success.type !== 'document') {
      return Result.fail(
        new InvalidData(
          `Settings for document collection '${collection}' are of type '${configured.success.type}' not of type 'document'.`,
        ),
      );
    }
    return Result.succeed(configured.success);
  }

  async getMediaCollectionSettings(collection: string): Promise<LaikaResult<MediaCollectionSettings>> {
    const configured = await this.getConfiguredCollectionSettings(collection);
    if (Result.isFailure(configured)) return failAs<MediaCollectionSettings>(configured.failure);
    if (configured.success === null) {
      return Result.succeed(defaultMediaCollectionSettings(collection));
    }
    if (configured.success.type !== 'media') {
      return Result.fail(
        new InvalidData(
          `Settings for media collection '${collection}' are of type '${configured.success.type}' not of type 'media'.`,
        ),
      );
    }
    return Result.succeed(configured.success);
  }

  async putCollectionSettings(collection: string, settings: CollectionSettings): Promise<LaikaResult<void>> {
    const currentSettingsResult = await this.getSettings();
    if (Result.isFailure(currentSettingsResult)) {
      return failAs<void>(currentSettingsResult.failure);
    }
    const currentSettings = currentSettingsResult.success;
    const updatedSettings = {
      ...currentSettings,
      collections: {
        ...(currentSettings.collections ?? {}),
        [collection]: settings,
      },
    };
    const result = await this.putSettings(updatedSettings);
    if (Result.isFailure(result)) {
      return failAs<void>(result.failure);
    }
    return Result.succeed(undefined);
  }

  async putMediaCollectionSettings(collection: string, settings: MediaCollectionSettings): Promise<LaikaResult<void>> {
    const result = this.putCollectionSettings(collection, settings);
    return result;
  }

  async putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): Promise<LaikaResult<void>> {
    const result = this.putCollectionSettings(collection, settings);
    return result;
  }

  async putSettings(settings: ContentBaseSettings): Promise<LaikaResult<void>> {
    const settingsResult = await firstResult(this.storage.createOrUpdateObject({
      key: SETTINGS_KEY,
      type: 'object',
      content: settings,
      metadata: { extension: 'json' },
    }));
    if (Result.isFailure(settingsResult)) return failAs<void>(settingsResult.failure);
    return Result.succeed(undefined);
  }

  async getCollectionSchema(collection: string): Promise<LaikaResult<JSONSchema7>> {
    const schema = await firstResult(this.storage.getObject(schemaKey(collection)));
    if (Result.isFailure(schema)) return failAs<JSONSchema7>(schema.failure);
    const jsonSchema = schema.success.content as JSONSchema7;
    return Result.succeed(jsonSchema);
  }

  async putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): Promise<LaikaResult<void>> {
    const result = await firstResult(this.storage.createOrUpdateObject(
      {
        key: schemaKey(collection),
        type: 'object',
        content: schema,
        metadata: { extension: 'json' },
      },
    ));
    if (Result.isFailure(result)) return failAs<void>(result.failure);
    return Result.succeed(undefined);
  }

  override getSettings = async (): Promise<LaikaResult<ContentBaseSettings>> => {
    const settingsFile = await firstResult(this.storage.getObject(SETTINGS_KEY));
    if (Result.isFailure(settingsFile)) {
      if (settingsFile.failure.code === NotFoundError.CODE) {
        const defaultSettings = createDefaultSettingsFile();
        const createResult = await firstResult(this.storage.createOrUpdateObject({
          key: SETTINGS_KEY,
          type: 'object',
          content: defaultSettings,
          metadata: { extension: 'json' },
        }));
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

const SETTINGS_KEY = '.contentbase/settings';
const schemaKey = (collection: string) => `.contentbase/schemas/${collection}`;

const defaultDocumentCollectionSettings = (collection: string): DocumentCollectionSettings => ({
  key: collection,
  type: 'document',
  name: startCase(collection),
  directory: collection,
  trashDirectory: `.contentbase/trash/${collection}`,
  draftDirectory: `.contentbase/drafts/${collection}`,
  archiveDirectory: `.contentbase/archive/${collection}`,
  revisionDirectory: `.contentbase/revisions/${collection}`,
  recursive: true,
});

const defaultMediaCollectionSettings = (collection: string): MediaCollectionSettings => ({
  key: collection,
  type: 'media',
  name: startCase(collection),
  directory: collection,
  recursive: true,
});
