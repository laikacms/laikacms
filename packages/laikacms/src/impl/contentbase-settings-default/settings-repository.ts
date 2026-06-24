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

/** Lift a LaikaTask into an Effect, forwarding metadata to the outer emit. */
const runForwarding = <A>(
  task: LaikaTask.LaikaTask<A>,
  emit: LaikaTask.LaikaTaskEmit,
): Effect.Effect<A, LaikaError> => LaikaTask.runValueForwarding(task, emit);

/** Lift a LaikaTask into an Effect, discarding metadata. */
const run = <A>(task: LaikaTask.LaikaTask<A>): Effect.Effect<A, LaikaError> =>
  LaikaTask.runValue(task);

const startCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

interface DefaultContentBaseSettingsProviderOptions {
  storage: StorageRepository;
}

export class DefaultContentBaseSettingsProvider extends ContentBaseSettingsProvider {
  private readonly storage: StorageRepository;

  constructor(options: DefaultContentBaseSettingsProviderOptions) {
    super();
    this.storage = options.storage;

    Effect.runPromise(Effect.result(run(this.storage.getCapabilities()))).then(r => {
      if (Result.isFailure(r)) return;
      const capabilities = r.success;
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
  private getConfiguredCollectionSettings(
    collection: string,
    emit: LaikaTask.LaikaTaskEmit,
  ): Effect.Effect<CollectionSettings | null, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const settings = yield* runForwarding(this.getSettings(), emit);
      const collections = settings.collections ?? {};
      return collections[collection] ?? null;
    });
  }

  getSettings(): LaikaTask.LaikaTask<ContentBaseSettings> {
    return LaikaTask.make<ContentBaseSettings>(emit =>
      Effect.gen({ self: this }, function*() {
        const settingsFile = yield* Effect.result(
          runForwarding(this.storage.getObject(SETTINGS_KEY), emit),
        );
        if (Result.isFailure(settingsFile)) {
          if (settingsFile.failure.code === NotFoundError.CODE) {
            const defaultSettings = createDefaultSettingsFile();
            yield* runForwarding(
              this.storage.createOrUpdateObject({
                key: SETTINGS_KEY,
                type: 'object',
                content: defaultSettings,
                metadata: { extension: 'json' },
              }),
              emit,
            );
            return defaultSettings;
          }
          return yield* Effect.fail(settingsFile.failure);
        }
        const parsedSettings = parseSettings(settingsFile.success.content);
        if (Result.isFailure(parsedSettings)) return yield* Effect.fail(parsedSettings.failure);
        return parsedSettings.success;
      })
    );
  }

  putSettings(settings: ContentBaseSettings): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        yield* runForwarding(
          this.storage.createOrUpdateObject({
            key: SETTINGS_KEY,
            type: 'object',
            content: settings,
            metadata: { extension: 'json' },
          }),
          emit,
        );
      })
    );
  }

  getDocumentCollectionSettings(collection: string): LaikaTask.LaikaTask<DocumentCollectionSettings> {
    return LaikaTask.make<DocumentCollectionSettings>(emit =>
      Effect.gen({ self: this }, function*() {
        const configured = yield* this.getConfiguredCollectionSettings(collection, emit);
        if (configured === null) {
          return defaultDocumentCollectionSettings(collection);
        }
        if (configured.type !== 'document') {
          return yield* Effect.fail(
            new InvalidData(
              `Settings for document collection '${collection}' are of type '${configured.type}' not of type 'document'.`,
            ),
          );
        }
        return configured;
      })
    );
  }

  putDocumentCollectionSettings(
    collection: string,
    settings: DocumentCollectionSettings,
  ): LaikaTask.LaikaTask<void> {
    return this.putCollectionSettings(collection, settings);
  }

  getMediaCollectionSettings(collection: string): LaikaTask.LaikaTask<MediaCollectionSettings> {
    return LaikaTask.make<MediaCollectionSettings>(emit =>
      Effect.gen({ self: this }, function*() {
        const configured = yield* this.getConfiguredCollectionSettings(collection, emit);
        if (configured === null) {
          return defaultMediaCollectionSettings(collection);
        }
        if (configured.type !== 'media') {
          return yield* Effect.fail(
            new InvalidData(
              `Settings for media collection '${collection}' are of type '${configured.type}' not of type 'media'.`,
            ),
          );
        }
        return configured;
      })
    );
  }

  putMediaCollectionSettings(
    collection: string,
    settings: MediaCollectionSettings,
  ): LaikaTask.LaikaTask<void> {
    return this.putCollectionSettings(collection, settings);
  }

  private putCollectionSettings(
    collection: string,
    settings: CollectionSettings,
  ): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        const currentSettings = yield* runForwarding(this.getSettings(), emit);
        const updatedSettings: ContentBaseSettings = {
          ...currentSettings,
          collections: {
            ...(currentSettings.collections ?? {}),
            [collection]: settings,
          },
        };
        yield* runForwarding(this.putSettings(updatedSettings), emit);
      })
    );
  }

  getCollectionSchema(collection: string): LaikaTask.LaikaTask<JSONSchema7> {
    return LaikaTask.make<JSONSchema7>(emit =>
      Effect.gen({ self: this }, function*() {
        const schema = yield* runForwarding(this.storage.getObject(schemaKey(collection)), emit);
        return schema.content as JSONSchema7;
      })
    );
  }

  putCollectionSchema(
    collection: string,
    schema: JSONSchema7,
  ): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        yield* runForwarding(
          this.storage.createOrUpdateObject({
            key: schemaKey(collection),
            type: 'object',
            content: schema,
            metadata: { extension: 'json' },
          }),
          emit,
        );
      })
    );
  }
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
