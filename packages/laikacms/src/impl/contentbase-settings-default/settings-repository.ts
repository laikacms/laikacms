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
async function firstResult<T>(task: LaikaTask.LaikaTask<T> | AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  if (task && typeof (task as AsyncGenerator<LaikaResult<T>>)[Symbol.asyncIterator] === 'function') {
    const gen = task as AsyncGenerator<LaikaResult<T>>;
    for await (const result of gen) return result;
    return Result.fail(new NotFoundError('No result') as LaikaError) as LaikaResult<T>;
  }
  return Effect.runPromise(Effect.result(LaikaTask.runValue(task as LaikaTask.LaikaTask<T>)));
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

  private async getCollectionSettings(collection: string): Promise<LaikaResult<CollectionSettings>> {
    const settings = await firstResult(this.getSettings());
    if (Result.isFailure(settings)) return failAs<CollectionSettings>(settings.failure);
    const collections = settings.success.collections ?? {};
    const collectionSettings = collections[collection];
    if (!collectionSettings) {
      return Result.succeed({
        key: collection,
        type: 'document',
        name: startCase(collection),
        directory: collection,
        trashDirectory: `.contentbase/trash/${collection}`,
        draftDirectory: `.contentbase/drafts/${collection}`,
        archiveDirectory: `.contentbase/archive/${collection}`,
        revisionDirectory: `.contentbase/revisions/${collection}`,
        recursive: true,
      } as CollectionSettings);
    }
    return Result.succeed(collectionSettings);
  }

  async *getDocumentCollectionSettings(collection: string): AsyncGenerator<LaikaResult<DocumentCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (Result.isFailure(collectionSettings)) {
      yield failAs<DocumentCollectionSettings>(collectionSettings.failure);
      return;
    }
    if (collectionSettings.success.type !== 'document') {
      yield Result.fail(
        new InvalidData(
          `Settings for document collection '${collection}' are of type '${collectionSettings.success.type}' not of type 'document'.`,
        ),
      );
      return;
    }
    yield Result.succeed(collectionSettings.success as DocumentCollectionSettings);
  }

  async *getMediaCollectionSettings(collection: string): AsyncGenerator<LaikaResult<MediaCollectionSettings>> {
    const collectionSettings = await this.getCollectionSettings(collection);
    if (Result.isFailure(collectionSettings)) {
      yield failAs<MediaCollectionSettings>(collectionSettings.failure);
      return;
    }
    if (collectionSettings.success.type !== 'media') {
      yield Result.fail(
        new InvalidData(
          `Settings for media collection '${collection}' are of type '${collectionSettings.success.type}' not of type 'media'.`,
        ),
      );
      return;
    }
    yield Result.succeed(collectionSettings.success as MediaCollectionSettings);
  }

  private async putCollectionSettings(collection: string, settings: CollectionSettings): Promise<LaikaResult<void>> {
    const currentSettingsResult = await firstResult(this.getSettings());
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
    const result = await firstResult(this.putSettings(updatedSettings));
    if (Result.isFailure(result)) {
      return failAs<void>(result.failure);
    }
    return Result.succeed(undefined);
  }

  async *putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings,
  ): AsyncGenerator<LaikaResult<void>> {
    yield await this.putCollectionSettings(collection, settings);
  }

  async *putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): AsyncGenerator<LaikaResult<void>> {
    yield await this.putCollectionSettings(collection, settings);
  }

  async *putSettings(settings: ContentBaseSettings): AsyncGenerator<LaikaResult<void>> {
    const settingsResult = await firstResult(this.storage.createOrUpdateObject({
      key: SETTINGS_KEY,
      type: 'object',
      content: settings,
      metadata: { extension: 'json' },
    }));
    if (Result.isFailure(settingsResult)) {
      yield failAs<void>(settingsResult.failure);
      return;
    }
    yield Result.succeed(undefined);
  }

  async *getCollectionSchema(collection: string): AsyncGenerator<LaikaResult<JSONSchema7>> {
    const schema = await firstResult(this.storage.getObject(schemaKey(collection)));
    if (Result.isFailure(schema)) {
      yield failAs<JSONSchema7>(schema.failure);
      return;
    }
    const jsonSchema = schema.success.content as JSONSchema7;
    yield Result.succeed(jsonSchema);
  }

  async *putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): AsyncGenerator<LaikaResult<void>> {
    const result = await firstResult(this.storage.createOrUpdateObject(
      {
        key: schemaKey(collection),
        type: 'object',
        content: schema,
        metadata: { extension: 'json' },
      },
    ));
    if (Result.isFailure(result)) {
      yield failAs<void>(result.failure);
      return;
    }
    yield Result.succeed(undefined);
  }

  override async *getSettings(): AsyncGenerator<LaikaResult<ContentBaseSettings>> {
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
        if (Result.isFailure(createResult)) {
          yield failAs<ContentBaseSettings>(createResult.failure);
          return;
        }
        yield Result.succeed(defaultSettings);
        return;
      }
      yield failAs<ContentBaseSettings>(settingsFile.failure);
      return;
    }

    const parsedSettings = parseSettings(settingsFile.success.content);
    if (Result.isFailure(parsedSettings)) {
      yield failAs<ContentBaseSettings>(parsedSettings.failure);
      return;
    }
    yield Result.succeed(parsedSettings.success);
  }
}

const SETTINGS_KEY = '.contentbase/settings';
const schemaKey = (collection: string) => `.contentbase/schemas/${collection}`;
