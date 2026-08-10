import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import type {
  Catalog,
  CollectionSettings,
  DocumentCollectionSettings,
  MediaCollectionSettings,
} from 'laikacms/catalog';
import { CatalogProvider, createDefaultCatalog, defaultUnpublishedStatuses, parseCatalog } from 'laikacms/catalog';
import type { LaikaError } from 'laikacms/core';
import { InvalidData, LaikaTask, NotFoundError } from 'laikacms/core';
import type { StorageRepository } from 'laikacms/storage';

/** Lift a LaikaTask into an Effect, forwarding metadata to the outer emit. */
const runForwarding = <A>(
  task: LaikaTask.LaikaTask<A>,
  emit: LaikaTask.LaikaTaskEmit,
): Effect.Effect<A, LaikaError> => LaikaTask.runValueForwarding(task, emit);

/** Lift a LaikaTask into an Effect, discarding metadata. */
const run = <A>(task: LaikaTask.LaikaTask<A>): Effect.Effect<A, LaikaError> => LaikaTask.runValue(task);

const startCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

interface ConventionCatalogProviderOptions {
  storage: StorageRepository;
}

export class ConventionCatalogProvider extends CatalogProvider {
  private readonly storage: StorageRepository;

  constructor(options: ConventionCatalogProviderOptions) {
    super();
    this.storage = options.storage;

    Effect.runPromise(Effect.result(run(this.storage.getCapabilities()))).then(r => {
      if (Result.isFailure(r)) return;
      const capabilities = r.success;
      if (!capabilities.fileExtensions.supported) {
        console.warn(
          `Underlying storage repository for catalog does not support file extensions. Catalog requires a classic filesystem structure with folders and .json metadata files.`,
        );
      }
      if (
        capabilities.fileExtensions.supported
        && Object.keys(capabilities.fileExtensions.supportedExtensions).includes('json') === false
      ) {
        console.warn(
          `Underlying storage repository for catalog does not support .json file extension. To keep Catalog cross-compatible, the storage repository should support .json files for storing catalog settings and metadata.`,
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
      const settings = yield* runForwarding(this.getCatalog(), emit);
      const collections = settings.collections ?? {};
      return collections[collection] ?? null;
    });
  }

  getCatalog(): LaikaTask.LaikaTask<Catalog> {
    return LaikaTask.make<Catalog>(emit =>
      Effect.gen({ self: this }, function*() {
        const settingsFile = yield* Effect.result(
          runForwarding(this.storage.getObject(CATALOG_KEY), emit),
        );
        if (Result.isFailure(settingsFile)) {
          if (settingsFile.failure.code === NotFoundError.CODE) {
            // No settings file yet: return the in-memory default without
            // persisting it. Writing only happens through the put* methods.
            return createDefaultCatalog();
          }
          return yield* Effect.fail(settingsFile.failure);
        }
        const parsedSettings = parseCatalog(settingsFile.success.content);
        if (Result.isFailure(parsedSettings)) return yield* Effect.fail(parsedSettings.failure);
        return parsedSettings.success;
      })
    );
  }

  putCatalog(settings: Catalog): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        yield* runForwarding(
          this.storage.createOrUpdateObject({
            key: CATALOG_KEY,
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
        const currentSettings = yield* runForwarding(this.getCatalog(), emit);
        const updatedSettings: Catalog = {
          ...currentSettings,
          collections: {
            ...(currentSettings.collections ?? {}),
            [collection]: settings,
          },
        };
        yield* runForwarding(this.putCatalog(updatedSettings), emit);
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

const CATALOG_KEY = '.laika/catalog';
const schemaKey = (collection: string) => `.laika/schemas/${collection}`;

const defaultDocumentCollectionSettings = (collection: string): DocumentCollectionSettings => ({
  key: collection,
  type: 'document',
  name: startCase(collection),
  directory: collection,
  unpublishedStatuses: defaultUnpublishedStatuses,
  revisionDirectory: `.laika/revisions/${collection}`,
  recursive: true,
});

const defaultMediaCollectionSettings = (collection: string): MediaCollectionSettings => ({
  key: collection,
  type: 'media',
  name: startCase(collection),
  directory: collection,
  recursive: true,
});
