import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import type {
  CollectionSettings,
  ContentBaseSettings,
  DocumentCollectionSettings,
  MediaCollectionSettings,
  UnpublishedStatusConfig,
} from 'laikacms/contentbase-settings';
import { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type { LaikaError, LaikaResult } from 'laikacms/core';
import { InvalidData, LaikaTask, NotFoundError } from 'laikacms/core';
import type { StorageRepository } from 'laikacms/storage';

// ===== Helpers =====

function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

async function firstResult<T>(task: LaikaTask.LaikaTask<T>): Promise<LaikaResult<T>> {
  return Effect.runPromise(Effect.result(LaikaTask.runValue(task)));
}

const startCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

const readOnly = <T>(op: string): LaikaResult<T> =>
  Result.fail(
    new InvalidData(
      `${op} is not supported by DecapContentBaseSettingsProvider — `
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

export interface DecapContentBaseSettingsProviderOptions {
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
 * `ContentBaseSettingsProvider` that derives ContentBase settings from a Decap
 * CMS config file. Read-only: the Decap config is the source of truth, so
 * `put*` operations fail with `InvalidData` instead of silently diverging.
 *
 * Schemas are derived on the fly from each collection's `fields`. The mapping
 * covers the common widgets (string/text/markdown/boolean/number/date/datetime/
 * object/list/select/image/file/relation) and falls back to "anything goes" for
 * unknown widgets so downstream validators stay permissive.
 */
export class DecapContentBaseSettingsProvider extends ContentBaseSettingsProvider {
  private readonly storage: StorageRepository;
  private readonly configKey: string;

  constructor(options: DecapContentBaseSettingsProviderOptions) {
    super();
    this.storage = options.storage;
    this.configKey = options.configKey;

    firstResult(this.storage.getCapabilities()).then(Result.getOrThrow).then(capabilities => {
      if (!capabilities.fileExtensions.supported) {
        console.warn(
          `Underlying storage for DecapContentBaseSettingsProvider does not advertise `
            + `file-extension support. The Decap config must be served from a path the `
            + `storage can deserialize.`,
        );
      }
    }).catch(err => {
      console.warn('DecapContentBaseSettingsProvider: getCapabilities probe failed', err);
    });
  }

  private async readDecapConfig(): Promise<LaikaResult<DecapConfig>> {
    const obj = await firstResult(this.storage.getObject(this.configKey));
    if (Result.isFailure(obj)) return failAs<DecapConfig>(obj.failure);
    const content = obj.success.content as unknown;
    if (content === null || typeof content !== 'object') {
      return Result.fail(
        new InvalidData(`Decap config at '${this.configKey}' did not deserialize to an object`),
      );
    }
    return Result.succeed(content as DecapConfig);
  }

  private translateCollection(c: DecapCollection): DocumentCollectionSettings | null {
    if (!isFolderCollection(c)) return null;

    const editorialWorkflow = c.publish !== false;
    const unpublishedStatuses: Record<string, UnpublishedStatusConfig> | undefined = editorialWorkflow
      ? {
        draft: { directory: 'draft', name: 'Draft' },
        pending_review: { directory: 'pending_review', name: 'Pending Review' },
        pending_publish: { directory: 'pending_publish', name: 'Pending Publish' },
      }
      : undefined;

    return {
      type: 'document',
      key: c.name,
      name: c.label ?? startCase(c.name),
      directory: c.folder,
      recursive: !!c.nested,
      ...(unpublishedStatuses ? { unpublishedStatuses } : {}),
      revisionDirectory: `.contentbase/revisions/${c.name}`,
    };
  }

  private buildSettings(config: DecapConfig): ContentBaseSettings {
    const collections: Record<string, CollectionSettings> = {};
    for (const decapCollection of config.collections ?? []) {
      const translated = this.translateCollection(decapCollection);
      if (translated) collections[translated.key] = translated;
    }
    return { collections };
  }

  override async *getSettings(): AsyncGenerator<LaikaResult<ContentBaseSettings>> {
    const config = await this.readDecapConfig();
    if (Result.isFailure(config)) {
      yield failAs<ContentBaseSettings>(config.failure);
      return;
    }
    yield Result.succeed(this.buildSettings(config.success));
  }

  async *getDocumentCollectionSettings(
    collection: string,
  ): AsyncGenerator<LaikaResult<DocumentCollectionSettings>> {
    const settingsResult = await this.readDecapConfig();
    if (Result.isFailure(settingsResult)) {
      yield failAs<DocumentCollectionSettings>(settingsResult.failure);
      return;
    }
    const settings = this.buildSettings(settingsResult.success);
    const found = settings.collections?.[collection];
    if (!found) {
      yield Result.succeed(defaultDocumentCollectionSettings(collection));
      return;
    }
    if (found.type !== 'document') {
      yield Result.fail(
        new InvalidData(
          `Settings for document collection '${collection}' are of type '${found.type}' not 'document'.`,
        ),
      );
      return;
    }
    yield Result.succeed(found);
  }

  async *getMediaCollectionSettings(
    collection: string,
  ): AsyncGenerator<LaikaResult<MediaCollectionSettings>> {
    // Decap collections are documents; media is configured via top-level `media_folder`
    // and is handled by the assets repo's collection-prefix probe, not by a registered
    // media collection. Read the Decap config so we can plumb its `public_folder`
    // into the URL template — without it `getUrls()` falls back to returning the
    // raw asset key, which is a relative path that browsers can't load as an image
    // preview (and Decap's per-field media picker hides items it can't preview).
    const configResult = await this.readDecapConfig();
    const defaults = defaultMediaCollectionSettings(collection);
    if (Result.isFailure(configResult)) {
      yield Result.succeed(defaults);
      return;
    }

    const publicFolder = (configResult.success.public_folder ?? '').replace(/\/+$/, '');
    if (!publicFolder) {
      yield Result.succeed(defaults);
      return;
    }

    yield Result.succeed({
      ...defaults,
      // `{filename}` is the last segment of the asset's logical key (see
      // `renderUrlTemplate` in assets-contentbase). For an asset stored under
      // `content/uploads/logo.svg` with `public_folder: /uploads`, this resolves
      // to `/uploads/logo.svg` — which is exactly the URL the SPA / Vite serves
      // and what Decap already stores in entry data via `publicPath`.
      url: `${publicFolder}/{filename}`,
    });
  }

  async *getCollectionSchema(collection: string): AsyncGenerator<LaikaResult<JSONSchema7>> {
    const config = await this.readDecapConfig();
    if (Result.isFailure(config)) {
      yield failAs<JSONSchema7>(config.failure);
      return;
    }
    const decapCollection = (config.success.collections ?? []).find(c => c.name === collection);
    if (!decapCollection) {
      yield Result.fail(new NotFoundError(`No Decap collection '${collection}' in config`));
      return;
    }
    if (!isFolderCollection(decapCollection)) {
      yield Result.fail(
        new InvalidData(
          `Decap collection '${collection}' is a 'files' collection — `
            + `its schema isn't a single JSONSchema7.`,
        ),
      );
      return;
    }
    yield Result.succeed(decapFieldsToJsonSchema(decapCollection.fields));
  }

  // ===== Read-only writes =====

  async *putSettings(_settings: ContentBaseSettings): AsyncGenerator<LaikaResult<void>> {
    yield readOnly<void>('putSettings');
  }

  async *putDocumentCollectionSettings(
    _collection: string,
    _settings: DocumentCollectionSettings,
  ): AsyncGenerator<LaikaResult<void>> {
    yield readOnly<void>('putDocumentCollectionSettings');
  }

  async *putMediaCollectionSettings(
    _collection: string,
    _settings: MediaCollectionSettings,
  ): AsyncGenerator<LaikaResult<void>> {
    yield readOnly<void>('putMediaCollectionSettings');
  }

  async *putCollectionSchema(
    _collection: string,
    _schema: JSONSchema7,
  ): AsyncGenerator<LaikaResult<void>> {
    yield readOnly<void>('putCollectionSchema');
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
    case 'relation':
      return { type: 'string' };
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
  revisionDirectory: `.contentbase/revisions/${collection}`,
});

const defaultMediaCollectionSettings = (collection: string): MediaCollectionSettings => ({
  type: 'media',
  key: collection,
  name: startCase(collection),
  directory: collection,
  recursive: true,
});
