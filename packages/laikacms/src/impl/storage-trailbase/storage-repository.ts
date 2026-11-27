import * as Effect from 'effect/Effect';

import {
  EntryAlreadyExistsError,
  ForbiddenError,
  InvalidData,
  type LaikaError,
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
} from 'laikacms/storage';
import { Capabilities, CompatibilityDate, pathCombine, StorageRepository, unsupportedChanges } from 'laikacms/storage';

const RECORD_API_BASE = '/api/records/v1';

export interface TrailBaseStorageRow {
  id?: string;
  key: string;
  depth: number;
  type: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface TrailBaseListResponse<T> {
  records: T[];
  cursor?: string;
  total_count?: number;
}

interface TrailBaseCreateResponse {
  ids: string[];
}

export interface TrailBaseStorageRepositoryOptions {
  /** Base URL of the TrailBase instance, e.g. `http://localhost:4000`. */
  baseUrl: string;
  /** Auth token passed as `Authorization: Bearer <token>`. */
  authToken?: string | undefined;
  /** Table name. Defaults to `laika_storage`. */
  storageTable?: string | undefined;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  /** Override `fetch`; defaults to `globalThis.fetch`. Useful for tests. */
  fetch?: typeof globalThis.fetch | undefined;
}

const parseContent = (raw: string): Effect.Effect<StorageObjectContent, LaikaError> =>
  Effect.try({
    try: () => JSON.parse(raw) as StorageObjectContent,
    catch: e =>
      new InvalidData(
        `[storage-trailbase] Invalid JSON content: ${e instanceof Error ? e.message : String(e)}`,
      ),
  });

function calculateDepth(key: string): number {
  return key.split('/').filter(Boolean).length;
}

export class TrailBaseStorageRepository extends StorageRepository {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly storageTable: string;
  private readonly logger: TrailBaseStorageRepositoryOptions['logger'];
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: TrailBaseStorageRepositoryOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authToken = options.authToken;
    this.storageTable = options.storageTable ?? 'laika_storage';
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private debug(op: string, key?: string): void {
    if (!this.logger) return;
    this.logger.debug(`[storage-trailbase] ${op}${key !== undefined ? ` ${key}` : ''}`);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  private tableUrl(): string {
    return `${this.baseUrl}${RECORD_API_BASE}/${encodeURIComponent(this.storageTable)}`;
  }

  private async apiFetch(url: string, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers as Record<string, string> | undefined) },
    });
  }

  private async listRows(params: URLSearchParams): Promise<TrailBaseListResponse<TrailBaseStorageRow>> {
    const url = `${this.tableUrl()}?${params.toString()}`;
    this.debug('listRows', url);
    const res = await this.apiFetch(url);
    if (!res.ok) {
      throw new Error(`[storage-trailbase] listRows failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<TrailBaseListResponse<TrailBaseStorageRow>>;
  }

  private async findRow(key: string): Promise<TrailBaseStorageRow | null> {
    const params = new URLSearchParams();
    params.set('filter[key][$eq]', key);
    params.set('limit', '1');
    const { records } = await this.listRows(params);
    return records[0] ?? null;
  }

  private async createRowHttp(body: Record<string, unknown>): Promise<TrailBaseCreateResponse> {
    const res = await this.apiFetch(this.tableUrl(), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[storage-trailbase] createRow failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<TrailBaseCreateResponse>;
  }

  private async patchRow(id: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.apiFetch(`${this.tableUrl()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[storage-trailbase] patchRow ${id} failed: ${res.status} ${text}`);
    }
  }

  private async deleteRow(id: string): Promise<void> {
    const res = await this.apiFetch(`${this.tableUrl()}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`[storage-trailbase] deleteRow ${id} failed: ${res.status} ${text}`);
    }
  }

  private rowToObject(row: TrailBaseStorageRow): Effect.Effect<StorageObject, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const content = yield* parseContent(row.content);
      return {
        type: 'object' as const,
        key: row.key,
        content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-11-27'),
      fileExtensions: {
        supported: false,
        description: 'SQL storage does not have inherent file extensions.',
      },
      pagination: {
        supported: true,
        description: 'Backed by TrailBase offset/limit pagination.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
    });
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getObject', key);
        const row = yield* Effect.tryPromise({
          try: () => this.findRow(key),
          catch: e =>
            new InvalidData(`[storage-trailbase] getObject error: ${e instanceof Error ? e.message : String(e)}`),
        });
        if (!row || row.type === 'keep-file') {
          return yield* Effect.fail(new NotFoundError(`Object not found: ${key}`));
        }
        return yield* this.rowToObject(row);
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('getFolder', key);
        // A folder exists if any object has this folder as a prefix
        const params = new URLSearchParams();
        params.set('filter[key][$like]', `${key}/%`);
        params.set('limit', '1');
        const { records } = yield* Effect.tryPromise({
          try: () => this.listRows(params),
          catch: e =>
            new InvalidData(`[storage-trailbase] getFolder error: ${e instanceof Error ? e.message : String(e)}`),
        });
        if (records.length === 0) {
          return yield* Effect.fail(new NotFoundError(`Folder not found: ${key}`));
        }
        return { type: 'folder' as const, key };
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createObject', create.key);
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required'));
        }
        const existing = yield* Effect.tryPromise({
          try: () => this.findRow(create.key),
          catch: e =>
            new InvalidData(
              `[storage-trailbase] createObject check error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (existing) {
          return yield* Effect.fail(new EntryAlreadyExistsError(`Object already exists: ${create.key}`));
        }
        const now = new Date().toISOString();
        yield* Effect.tryPromise({
          try: () =>
            this.createRowHttp({
              key: create.key,
              depth: calculateDepth(create.key),
              type: create.type ?? 'object',
              content: JSON.stringify(create.content),
              created_at: now,
              updated_at: now,
            }),
          catch: e =>
            new InvalidData(`[storage-trailbase] createObject error: ${e instanceof Error ? e.message : String(e)}`),
        });
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required'));
        }
        const existing = yield* Effect.tryPromise({
          try: () => this.findRow(create.key),
          catch: e =>
            new InvalidData(
              `[storage-trailbase] createOrUpdateObject check error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        if (existing) {
          return yield* LaikaTask.runValue(this.updateObject({ key: create.key, content: create.content }));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('updateObject', update.key);
        const row = yield* Effect.tryPromise({
          try: () => this.findRow(update.key),
          catch: e =>
            new InvalidData(`[storage-trailbase] updateObject error: ${e instanceof Error ? e.message : String(e)}`),
        });
        if (!row?.id) return yield* Effect.fail(new NotFoundError(`Object not found: ${update.key}`));
        yield* Effect.tryPromise({
          try: () =>
            this.patchRow(row.id!, {
              content: JSON.stringify(update.content),
              updated_at: new Date().toISOString(),
            }),
          catch: e =>
            new InvalidData(
              `[storage-trailbase] updateObject patch error: ${e instanceof Error ? e.message : String(e)}`,
            ),
        });
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        this.debug('createFolder', folderCreate.key);
        const keepKey = pathCombine(folderCreate.key, '.keep');
        const now = new Date().toISOString();
        yield* Effect.tryPromise({
          try: () =>
            this.createRowHttp({
              key: keepKey,
              depth: calculateDepth(keepKey),
              type: 'keep-file',
              content: 'null',
              created_at: now,
              updated_at: now,
            }),
          catch: e =>
            new InvalidData(`[storage-trailbase] createFolder error: ${e instanceof Error ? e.message : String(e)}`),
        });
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const collected = yield* LaikaStream.runCollect(this.listAtoms(folderKey, options));
        for (const w of collected.recoverableErrors) yield* emit.recoverableError(w);
        for (const atom of collected.data) {
          yield* emit.data({ type: 'object-summary' as const, key: atom.key });
        }
        return collected.done;
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        this.debug('listAtoms', folderKey);
        const prefix = folderKey ? `${folderKey}/` : '';
        const baseDepth = folderKey ? calculateDepth(folderKey) : 0;
        const maxDepth = baseDepth + options.depth;

        const params = new URLSearchParams();
        if (prefix) {
          params.set('filter[key][$like]', `${prefix}%`);
        }
        params.set('filter[depth][$lte]', String(maxDepth));

        let limit: number | undefined;
        let offset: number;
        if ('page' in options.pagination) {
          const perPage = options.pagination.perPage ?? 20;
          limit = perPage;
          offset = (options.pagination.page - 1) * perPage;
        } else {
          limit = 'limit' in options.pagination ? options.pagination.limit : undefined;
          offset = 'offset' in options.pagination ? (options.pagination.offset ?? 0) : 0;
        }
        if (limit !== undefined) params.set('limit', String(limit));
        params.set('offset', String(offset));
        params.set('count', 'true');

        const { records, total_count } = yield* Effect.tryPromise({
          try: () => this.listRows(params),
          catch: e =>
            new InvalidData(`[storage-trailbase] listAtoms error: ${e instanceof Error ? e.message : String(e)}`),
        });

        let emitted = 0;
        for (const row of records) {
          if (row.type === 'keep-file') continue;
          const parsed = yield* Effect.result(this.rowToObject(row));
          if (parsed._tag === 'Failure') {
            yield* emit.recoverableError(parsed.failure);
          } else {
            yield* emit.data(parsed.success);
            emitted++;
          }
        }
        return { total: total_count ?? emitted };
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(emit =>
      Effect.gen({ self: this }, function*() {
        const asObject = yield* Effect.result(LaikaTask.runValueForwarding(this.getObject(key), emit));
        if (asObject._tag === 'Success') return asObject.success;
        return yield* LaikaTask.runValueForwarding(this.getFolder(key), emit);
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;

        for (const key of keys) {
          this.debug('removeAtoms', key);
          // Block removal of folder keys (keys that have children)
          const childParams = new URLSearchParams();
          childParams.set('filter[key][$like]', `${key}/%`);
          childParams.set('limit', '1');
          const { records: children } = yield* Effect.tryPromise({
            try: () => this.listRows(childParams),
            catch: e =>
              new InvalidData(
                `[storage-trailbase] removeAtoms check error: ${e instanceof Error ? e.message : String(e)}`,
              ),
          });
          if (children.length > 0) {
            yield* emit.recoverableError(
              new ForbiddenError(`Cannot remove folder key via removeAtoms: '${key}'`),
            );
            skipped++;
            continue;
          }

          const row = yield* Effect.tryPromise({
            try: () => this.findRow(key),
            catch: e =>
              new InvalidData(
                `[storage-trailbase] removeAtoms find error: ${e instanceof Error ? e.message : String(e)}`,
              ),
          });
          if (!row?.id) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped++;
            continue;
          }
          yield* Effect.tryPromise({
            try: () => this.deleteRow(row.id!),
            catch: e =>
              new InvalidData(
                `[storage-trailbase] removeAtoms delete error: ${e instanceof Error ? e.message : String(e)}`,
              ),
          });
          yield* emit.data(key);
          removed++;
        }
        return { total: removed, removed, skipped };
      })
    );
  }
}
