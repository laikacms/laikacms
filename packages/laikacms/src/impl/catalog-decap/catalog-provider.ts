import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import type {
  Catalog,
  CollectionSettings,
  DocumentCollectionSettings,
  MediaCollectionSettings,
} from 'laikacms/catalog';
import { CatalogProvider, defaultUnpublishedStatuses } from 'laikacms/catalog';
import type { LaikaError } from 'laikacms/core';
import { InvalidData, LaikaTask, NotFoundError } from 'laikacms/core';
import type { StorageRepository } from 'laikacms/storage';

// ===== Helpers =====

/** Lift a LaikaTask into an Effect, forwarding metadata to the outer emit. */
const runForwarding = <A>(
  task: LaikaTask.LaikaTask<A>,
  emit: LaikaTask.LaikaTaskEmit,
): Effect.Effect<A, LaikaError> => LaikaTask.runValueForwarding(task, emit);

const startCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

const readOnly = <T>(op: string): LaikaTask.LaikaTask<T> =>
  LaikaTask.fail(
    new InvalidData(
      `${op} is not supported by DecapCatalogProvider — `
        + `the Decap config is the source of truth; edit it directly.`,
    ),
  );

// ===== Decap CMS config shape (subset we read) =====

type DecapValueType = 'int' | 'float';

interface DecapFieldBase {
  name: string;
  label?: string;
  widget?: string;
  required?: boolean;
  default?: unknown;
  hint?: string;
  comment?: string;
  pattern?: [string, string];
  i18n?: boolean | string;
}

interface DecapField extends DecapFieldBase {
  fields?: DecapField[];
  field?: DecapField;
  types?: DecapField[];
  options?: Array<string | number | { label: string, value: string | number }>;
  multiple?: boolean;
  min?: number;
  max?: number;
  value_type?: DecapValueType;
  format?: string;
  date_format?: string | boolean;
  time_format?: string | boolean;
}

interface DecapFolderCollection {
  name: string;
  label?: string;
  label_singular?: string;
  description?: string;
  folder: string;
  create?: boolean;
  delete?: boolean;
  publish?: boolean;
  format?: string;
  extension?: string;
  slug?: string;
  fields: DecapField[];
  media_folder?: string;
  public_folder?: string;
  identifier_field?: string;
  nested?: { depth?: number, summary?: string };
  summary?: string;
}

interface DecapFile {
  name: string;
  label?: string;
  file: string;
  fields: DecapField[];
  description?: string;
}

interface DecapFileCollection {
  name: string;
  label?: string;
  files: DecapFile[];
  description?: string;
}

type DecapCollection = DecapFolderCollection | DecapFileCollection;

interface DecapConfig {
  backend?: unknown;
  media_folder?: string;
  public_folder?: string;
  collections?: DecapCollection[];
  locale?: string;
  publish_mode?: 'simple' | 'editorial_workflow';
  i18n?: unknown;
}

const isFolderCollection = (c: DecapCollection): c is DecapFolderCollection =>
  typeof (c as DecapFolderCollection).folder === 'string';

// ===== Provider =====

export interface DecapCatalogProviderOptions {
  storage: StorageRepository;
  /**
   * Logical key (with or without extension) of the Decap config file inside the
   * storage repository. The storage's serializer registry must include a
   * deserializer for the file's actual extension (typically yaml / yml / json).
   *
   * Example: `'config'` resolves to `config.yaml`, `config.yml`, or `config.json`
   * depending on which file the storage probe finds first.
   */
  configKey: string;
}

/**
 * `CatalogProvider` that derives Catalog settings from a Decap
 * CMS config file. Read-only: the Decap config is the source of truth, so
 * `put*` operations fail with `InvalidData` instead of silently diverging.
 *
 * Schemas are derived on the fly from each collection's `fields`. The mapping
 * covers the common widgets (string/text/markdown/boolean/number/date/datetime/
 * object/list/select/image/file/relation) and falls back to "anything goes" for
 * unknown widgets so downstream validators stay permissive.
 */
export class DecapCatalogProvider extends CatalogProvider {
  private readonly storage: StorageRepository;
  private readonly configKey: string;

  constructor(options: DecapCatalogProviderOptions) {
    super();
    this.storage = options.storage;
    this.configKey = options.configKey;

    LaikaTask.runPromise(this.storage.getCapabilities()).then(capabilities => {
      if (!capabilities.fileExtensions.supported) {
        console.warn(
          `Underlying storage for DecapCatalogProvider does not advertise `
            + `file-extension support. The Decap config must be served from a path the `
            + `storage can deserialize.`,
        );
      }
    }).catch(err => {
      console.warn('DecapCatalogProvider: getCapabilities probe failed', err);
    });
  }

  private readDecapConfig(emit: LaikaTask.LaikaTaskEmit): Effect.Effect<DecapConfig, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const objResult = yield* Effect.result(runForwarding(this.storage.getObject(this.configKey), emit));
      if (Result.isFailure(objResult)) {
        const err = objResult.failure;
        return yield* Effect.fail(
          err.code === NotFoundError.CODE
            ? new NotFoundError(
              `Decap config object not found at storage key '${this.configKey}'. `
                + `Seed it once before any content operation: `
                + `await runTask(storage.createOrUpdateObject({ key: '${this.configKey}', `
                + `content: { collections: [...], media_folder: '...', public_folder: '...' } }))`,
            )
            : err,
        );
      }
      const obj = objResult.success;
      const content = obj.content as unknown;
      if (content === null || typeof content !== 'object') {
        return yield* Effect.fail(
          new InvalidData(`Decap config at '${this.configKey}' did not deserialize to an object`),
        );
      }
      return content as DecapConfig;
    });
  }

  private translateCollection(
    c: DecapCollection,
    editorialWorkflow: boolean,
  ): DocumentCollectionSettings | null {
    if (!isFolderCollection(c)) return null;

    return {
      type: 'document',
      key: c.name,
      name: c.label ?? startCase(c.name),
      directory: c.folder,
      recursive: !!c.nested,
      ...(editorialWorkflow ? { unpublishedStatuses: defaultUnpublishedStatuses } : {}),
      revisionDirectory: `.laika/revisions/${c.name}`,
    };
  }

  private buildSettings(config: DecapConfig): Catalog {
    const editorialWorkflow = config.publish_mode === 'editorial_workflow';
    const collections: Record<string, CollectionSettings> = {};
    for (const decapCollection of config.collections ?? []) {
      const translated = this.translateCollection(decapCollection, editorialWorkflow);
      if (translated) collections[translated.key] = translated;
    }
    return { collections };
  }

  getCatalog(): LaikaTask.LaikaTask<Catalog> {
    return LaikaTask.make<Catalog>(emit =>
      Effect.gen({ self: this }, function*() {
        const config = yield* this.readDecapConfig(emit);
        return this.buildSettings(config);
      })
    );
  }

  getDocumentCollectionSettings(
    collection: string,
  ): LaikaTask.LaikaTask<DocumentCollectionSettings> {
    return LaikaTask.make<DocumentCollectionSettings>(emit =>
      Effect.gen({ self: this }, function*() {
        const settings = yield* runForwarding(this.getCatalog(), emit);
        const found = settings.collections?.[collection];
        if (!found) return defaultDocumentCollectionSettings(collection);
        if (found.type !== 'document') {
          return yield* Effect.fail(
            new InvalidData(
              `Settings for document collection '${collection}' are of type '${found.type}' not 'document'.`,
            ),
          );
        }
        return found;
      })
    );
  }

  getMediaCollectionSettings(
    collection: string,
  ): LaikaTask.LaikaTask<MediaCollectionSettings> {
    return LaikaTask.make<MediaCollectionSettings>(emit =>
      Effect.gen({ self: this }, function*() {
        // Decap collections are documents; media is configured via top-level `media_folder`
        // and is handled by the assets repo's collection-prefix probe, not by a registered
        // media collection. Read the Decap config so we can plumb its `public_folder`
        // into the URL template — without it `getUrls()` falls back to returning the
        // raw asset key, which is a relative path that browsers can't load as an image
        // preview (and Decap's per-field media picker hides items it can't preview).
        const configResult = yield* Effect.result(this.readDecapConfig(emit));
        const defaults = defaultMediaCollectionSettings(collection);
        if (Result.isFailure(configResult)) return defaults;

        const publicFolder = (configResult.success.public_folder ?? '').replace(/\/+$/, '');
        if (!publicFolder) return defaults;

        return {
          ...defaults,
          // `{filename}` is the last segment of the asset's logical key (see
          // `renderUrlTemplate` in assets-catalog). For an asset stored under
          // `content/uploads/logo.svg` with `public_folder: /uploads`, this resolves
          // to `/uploads/logo.svg` — which is exactly the URL the SPA / Vite serves
          // and what Decap already stores in entry data via `publicPath`.
          url: `${publicFolder}/{filename}`,
        };
      })
    );
  }

  getCollectionSchema(collection: string): LaikaTask.LaikaTask<JSONSchema7> {
    return LaikaTask.make<JSONSchema7>(emit =>
      Effect.gen({ self: this }, function*() {
        const config = yield* this.readDecapConfig(emit);
        const decapCollection = (config.collections ?? []).find(c => c.name === collection);
        if (!decapCollection) {
          return yield* Effect.fail(new NotFoundError(`No Decap collection '${collection}' in config`));
        }
        if (!isFolderCollection(decapCollection)) {
          return yield* Effect.fail(
            new InvalidData(
              `Decap collection '${collection}' is a 'files' collection — `
                + `its schema isn't a single JSONSchema7.`,
            ),
          );
        }
        return decapFieldsToJsonSchema(decapCollection.fields);
      })
    );
  }

  // ===== Read-only writes =====

  putCatalog(_settings: Catalog): LaikaTask.LaikaTask<void> {
    return readOnly<void>('putCatalog');
  }

  putDocumentCollectionSettings(
    _collection: string,
    _settings: DocumentCollectionSettings,
  ): LaikaTask.LaikaTask<void> {
    return readOnly<void>('putDocumentCollectionSettings');
  }

  putMediaCollectionSettings(
    _collection: string,
    _settings: MediaCollectionSettings,
  ): LaikaTask.LaikaTask<void> {
    return readOnly<void>('putMediaCollectionSettings');
  }

  putCollectionSchema(
    _collection: string,
    _schema: JSONSchema7,
  ): LaikaTask.LaikaTask<void> {
    return readOnly<void>('putCollectionSchema');
  }
}

// ===== Decap fields → JSON Schema =====

function decapFieldsToJsonSchema(fields: DecapField[]): JSONSchema7 {
  const properties: Record<string, JSONSchema7> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = decapFieldToJsonSchema(f);
    if (f.required !== false) required.push(f.name);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
  };
}

function decapFieldToJsonSchema(field: DecapField): JSONSchema7 {
  const widget = field.widget ?? 'string';
  switch (widget) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'code':
    case 'color':
    case 'hidden':
      return { type: 'string' };
    case 'boolean':
      return { type: 'boolean' };
    case 'number':
      return field.value_type === 'int'
        ? { type: 'integer' }
        : { type: 'number' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'object':
      return decapFieldsToJsonSchema(field.fields ?? []);
    case 'list': {
      let items: JSONSchema7;
      if (field.fields) items = decapFieldsToJsonSchema(field.fields);
      else if (field.field) items = decapFieldToJsonSchema(field.field);
      else items = { type: 'string' };
      const schema: JSONSchema7 = { type: 'array', items };
      if (typeof field.min === 'number') schema.minItems = field.min;
      if (typeof field.max === 'number') schema.maxItems = field.max;
      return schema;
    }
    case 'select': {
      const opts = field.options ?? [];
      const values = opts.map(o => typeof o === 'string' || typeof o === 'number' ? o : o.value);
      const allString = values.every(v => typeof v === 'string');
      const itemSchema: JSONSchema7 = allString
        ? { type: 'string', enum: values as string[] }
        : { type: ['string', 'number'], enum: values };
      return field.multiple ? { type: 'array', items: itemSchema } : itemSchema;
    }
    case 'image':
    case 'file':
    case 'relation': {
      const base: JSONSchema7 = { type: 'string' };
      return field.multiple ? { type: 'array', items: base } : base;
    }
    default:
      return {};
  }
}

const defaultDocumentCollectionSettings = (collection: string): DocumentCollectionSettings => ({
  type: 'document',
  key: collection,
  name: startCase(collection),
  directory: collection,
  recursive: true,
  revisionDirectory: `.laika/revisions/${collection}`,
});

const defaultMediaCollectionSettings = (collection: string): MediaCollectionSettings => ({
  type: 'media',
  key: collection,
  name: startCase(collection),
  directory: collection,
  recursive: true,
});
