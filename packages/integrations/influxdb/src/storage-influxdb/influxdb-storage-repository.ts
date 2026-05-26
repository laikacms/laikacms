import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  RemoveAtomsDone,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageSerializerRegistry,
} from 'laikacms/storage';
import {
  applyPagination,
  type Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  naturalCompare,
  StorageRepository,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import type { InfluxDbDataSource } from './influxdb-datasource.js';

export interface InfluxDbStorageRepositoryOptions {
  readonly dataSource: InfluxDbDataSource;
  /** Influx measurement to write into. Default `laika_storage`. */
  readonly measurement?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_MEASUREMENT = 'laika_storage';

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const TYPE_FILE = 'file';
const TYPE_FOLDER = 'folder';

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitPath = (key: string): { parent: string, name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

const validateIdentifier = (name: string): void => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new BadRequestError(`Invalid Flux/measurement identifier: ${name}`);
  }
};

/** Escape a Flux string-literal value — `"` and `\` get backslash-escaped. */
const escapeFluxString = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * A {@link StorageRepository} backed by InfluxDB v2. Every Laika atom is
 * one point in a time-series measurement. The "latest" version per
 * `(kind, parent, name)` tag-set is what reads return — older points
 * remain in storage until a delete or retention-policy expiry.
 *
 * Data model:
 *
 *     measurement = laika_storage
 *     tags        = kind ∈ {"file","folder"}, parent, name, extension, path
 *     fields      = content
 *     timestamp   = write time (ns)
 *
 * Tags are indexed in InfluxDB's TSI (time-series index); fields are
 * not. We tag `path` for the delete predicate (which only supports
 * equality on tags), and `content` is the bulky field that doesn't
 * need indexing.
 *
 * Six wire-format traits distinguish this backend:
 *
 *  - **Line protocol writes.** `INSERT-equivalent` is a newline-delimited
 *    text body — `laika_storage,kind=file,parent=notes,…` followed by
 *    `content="hi"` and a nanosecond timestamp.
 *
 *  - **Flux pipeline DSL for reads.** Every read is a Flux source string
 *    with `|>` pipe operators:
 *      ```
 *      from(bucket: "cms")
 *        |> range(start: 0)
 *        |> filter(fn: (r) => r._measurement == "laika_storage" and r.kind == "file" and r.name == "hello")
 *        |> last()
 *        |> pivot(rowKey: [...], columnKey: ["_field"], valueColumn: "_value")
 *      ```
 *
 *  - **Annotated CSV responses.** Parsed via `parseAnnotatedCsv`.
 *
 *  - **Tags vs fields.** Tags are indexed strings; fields are arbitrary.
 *
 *  - **`|> last()` latest-value semantics.** Reads always include this
 *    pipe to dedupe across the time series.
 *
 *  - **Nanosecond timestamps** in all writes.
 *
 * `removeAtoms(N)` does N parallel `/api/v2/delete` calls — Influx's
 * predicate language doesn't reliably support OR across versions. Not a
 * new atomic-multi-write mechanism. Honest framing (same as Solid Pod,
 * ClickHouse, Trello).
 */
export class InfluxDbStorageRepository extends StorageRepository {
  private readonly dataSource: InfluxDbDataSource;
  private readonly measurement: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: InfluxDbStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      measurement = DEFAULT_MEASUREMENT,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateIdentifier(measurement);
    this.dataSource = dataSource;
    this.measurement = measurement;
    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((re): re is minimatch.MMRegExp => re !== false);
  }

  // ───────────────────────── helpers ─────────────────────────

  private stripExtension(key: string): string {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  private async serialize(extension: string, content: StorageObjectContent): Promise<string> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    return serializer.serializeDocumentFileContents(content, {});
  }

  private async deserialize(extension: string, raw: string): Promise<StorageObjectContent> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    return serializer.deserializeDocumentFileContents(raw, {});
  }

  private filePath(key: string, extension: string): string {
    const stripped = stripSlashes(this.stripExtension(key));
    return `${stripped}.${extension}`;
  }

  /**
   * Resolve an extension-free key to its row via a Flux query with
   * `|> last()` semantics:
   *
   *     from(bucket) |> range(start: 0)
   *                  |> filter(fn: (r) => r._measurement == M and r.kind == "file" and r.parent == P and r.name == N)
   *                  |> last() |> pivot(...)
   */
  private async findFileRow(key: string): Promise<Record<string, string> | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const flux = this.fluxFilterLatest({
      kind: TYPE_FILE,
      parent,
      name,
    });
    const r = await this.dataSource.query(flux);
    if (Result.isFailure(r)) return null;
    return r.success[0] ?? null;
  }

  /**
   * Build a Flux query that returns the latest point per `(kind, parent,
   * name)` tag-set matching the supplied tag predicates. The pivot at
   * the end collapses Influx's row-per-field-value default into one
   * row per record with field columns.
   */
  private fluxFilterLatest(tagPredicates: Record<string, string>): string {
    const filters = Object.entries(tagPredicates)
      .map(([k, v]) => `r.${k} == "${escapeFluxString(v)}"`)
      .join(' and ');
    const filterExpr = `r._measurement == "${escapeFluxString(this.measurement)}"`
      + (filters ? ` and ${filters}` : '');
    return `from(bucket: "${escapeFluxString(this.dataSource.bucket)}")
  |> range(start: 0)
  |> filter(fn: (r) => ${filterExpr})
  |> last()
  |> pivot(rowKey: ["_time", "kind", "parent", "name", "extension", "path"], columnKey: ["_field"], valueColumn: "_value")`;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const row = yield* Effect.promise(() => this.findFileRow(key));
        if (!row) {
          return yield* Effect.fail(new NotFoundError(`InfluxDB row not found: ${key}`));
        }
        const extension = row['extension'] ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, row['content'] ?? ''));
        const t = row['_time'] ?? new Date(0).toISOString();
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: t,
          updatedAt: t,
          content,
          // The `_time` IS the version — nanosecond-precision monotonic
          // timestamp per write. First backend where revisionId is a
          // sub-millisecond timestamp.
          metadata: { extension, revisionId: t },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          const probe = yield* liftResult(this.dataSource.query(
            this.fluxFilterLatest({}),
          ));
          if (probe.length === 0) {
            return yield* Effect.fail(new NotFoundError('InfluxDB root folder is empty'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const explicit = yield* liftResult(this.dataSource.query(
          this.fluxFilterLatest({ kind: TYPE_FOLDER, path: k }),
        ));
        if (explicit.length > 0) {
          const t = explicit[0]!['_time'] ?? new Date(0).toISOString();
          return { type: 'folder', key: k, createdAt: t, updatedAt: t } satisfies Folder;
        }
        const childProbe = yield* liftResult(this.dataSource.query(
          this.fluxFilterLatest({ parent: k }),
        ));
        if (childProbe.length > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`InfluxDB folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.findFileRow(key));
        if (file) return yield* LaikaTask.runValue(this.getObject(key));
        const folder = yield* Effect.result(LaikaTask.runValue(this.getFolder(key)));
        if (Result.isSuccess(folder)) return folder.success;
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new BadRequestError('Object content is required for creation'));
        }
        const existing = yield* Effect.promise(() => this.findFileRow(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${
                existing['extension'] ?? this.defaultFileExtension
              }`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = this.filePath(create.key, extension);
        yield* liftResult(this.dataSource.write([{
          measurement: this.measurement,
          tags: { kind: TYPE_FILE, parent, name, extension, path: fullPath },
          fields: { content: serialized },
        }]));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRow(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`InfluxDB row not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing['extension'] ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          // Re-write the point with a new timestamp. The `|> last()`
          // pipe on reads sees the new version.
          yield* liftResult(this.dataSource.write([{
            measurement: this.measurement,
            tags: {
              kind: TYPE_FILE,
              parent: existing['parent'] ?? '',
              name: existing['name'] ?? '',
              extension,
              path: existing['path'] ?? this.filePath(update.key, extension),
            },
            fields: { content: serialized },
          }]));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileRow(create.key));
        const extension = existing?.['extension'] ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = existing?.['path'] ?? this.filePath(create.key, extension);
        yield* liftResult(this.dataSource.write([{
          measurement: this.measurement,
          tags: { kind: TYPE_FILE, parent, name, extension, path: fullPath },
          fields: { content: serialized },
        }]));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        const { parent, name } = splitPath(k);
        yield* liftResult(this.dataSource.write([{
          measurement: this.measurement,
          tags: { kind: TYPE_FOLDER, parent, name, extension: '', path: k },
          fields: { content: '' },
        }]));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  /**
   * N parallel `/api/v2/delete` calls — Influx v2's predicate language
   * doesn't reliably support OR across versions. **Not a new
   * atomic-multi-write mechanism**; honest framing.
   */
  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const cleanKeys = keys.map(s => stripSlashes(s)).filter(s => s !== '');
        const skipped0 = keys.length - cleanKeys.length;
        if (cleanKeys.length === 0) {
          for (let i = 0; i < skipped0; i++) {
            yield* emit.recoverableError(new BadRequestError('Refusing to delete empty key'));
          }
          return { removed: 0, skipped: skipped0 };
        }

        const results = yield* Effect.promise(async () => {
          return await Promise.all(cleanKeys.map(async k => {
            const row = await this.findFileRow(k);
            if (!row) return { key: k, outcome: 'missing' as const };
            const predicate = `_measurement="${escapeFluxString(this.measurement)}" AND path="${
              escapeFluxString(row['path'] ?? '')
            }"`;
            const del = await this.dataSource.delete({ predicate });
            return Result.isSuccess(del)
              ? { key: k, outcome: 'removed' as const }
              : { key: k, outcome: 'failed' as const, error: del.failure };
          }));
        });

        let removed = 0;
        let skipped = skipped0;
        for (const r of results) {
          if (r.outcome === 'removed') {
            yield* emit.data(r.key);
            removed += 1;
          } else if (r.outcome === 'missing') {
            yield* emit.recoverableError(new NotFoundError(`InfluxDB row not found: ${r.key}`));
            skipped += 1;
          } else {
            yield* emit.recoverableError(r.error);
            skipped += 1;
          }
        }
        return { removed, skipped };
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
        for (const summary of summaries) {
          if (summary.type === 'object-summary') {
            const result = yield* Effect.result(LaikaTask.runValue(this.getObject(summary.key)));
            if (Result.isFailure(result)) yield* emit.recoverableError(result.failure);
            else yield* emit.data(result.success);
          } else {
            const result = yield* Effect.result(LaikaTask.runValue(this.getFolder(summary.key)));
            if (Result.isFailure(result)) yield* emit.recoverableError(result.failure);
            else yield* emit.data(result.success);
          }
        }
        return { total: summaries.length };
      })
    );
  }

  /** One Flux query with `filter(r.parent == "$parent")` + `|> last()` + pivot. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const parent = stripSlashes(folderKey);
      const rows = yield* liftResult(this.dataSource.query(
        this.fluxFilterLatest({ parent }),
      ));
      const callerPrefix = parent === '' ? '' : `${parent}/`;
      const summaries: AtomSummary[] = rows.map(row => {
        const name = row['name'] ?? '';
        const isFile = row['kind'] === TYPE_FILE;
        return isFile
          ? { type: 'object-summary', key: callerPrefix + name }
          : { type: 'folder-summary', key: callerPrefix + name };
      });
      const filtered = summaries.filter(s => this.excludeFilter.every(p => !p.test(s.key)));
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Each object is one point in an InfluxDB measurement; the extension is stored as a tag.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over CSV result rows; native LIMIT/OFFSET via Flux not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
