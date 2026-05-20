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

import {
  andFilter,
  buildDn,
  eqFilter,
  type LdapBulkOp,
  type LdapDataSource,
  type LdapEntry,
  orFilter,
  readAttribute,
} from './ldap-datasource.js';

export interface LdapStorageRepositoryOptions {
  readonly dataSource: LdapDataSource;
  /**
   * Base DN under which all Laika entries live. Example:
   * `ou=cms,dc=example,dc=com`. The repository never modifies the
   * base entry itself.
   */
  readonly baseDn: string;
  /** objectClass for files. Default `laikaFile`. */
  readonly fileObjectClass?: string;
  /** objectClass for folders. Default `laikaFolder` (auxiliary on `organizationalUnit`). */
  readonly folderObjectClass?: string;
  /** Attribute name used to store file content. Default `laikaContent`. */
  readonly contentAttribute?: string;
  /** Attribute name used to store the parent path. Default `laikaParent`. */
  readonly parentAttribute?: string;
  /** Attribute name used to store the file extension. Default `laikaExtension`. */
  readonly extensionAttribute?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_FILE_OBJECT_CLASS = 'laikaFile';
const DEFAULT_FOLDER_OBJECT_CLASS = 'laikaFolder';
const DEFAULT_CONTENT_ATTRIBUTE = 'laikaContent';
const DEFAULT_PARENT_ATTRIBUTE = 'laikaParent';
const DEFAULT_EXTENSION_ATTRIBUTE = 'laikaExtension';

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitPath = (key: string): { parent: string; name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/**
 * A {@link StorageRepository} backed by an LDAP directory. Each Laika
 * atom maps to one LDAP entry; the hierarchy is encoded directly into
 * the Distinguished Name (DN).
 *
 * DN structure for a key `notes/hello`:
 *
 *     cn=hello.md,ou=notes,ou=cms,dc=example,dc=com
 *     └ leaf RDN              └ ancestor OUs    └ baseDn
 *
 * Folders are `organizationalUnit`s (the canonical container objectClass
 * in LDAP), augmented with the auxiliary `laikaFolder` class so the
 * repository can recognise them. Files are entries with `objectClass:
 * laikaFile` and three custom attributes — `laikaParent`,
 * `laikaExtension`, `laikaContent`.
 *
 * Five traits distinguish this backend:
 *
 *  - **DN-based addressing.** Right-to-left RDN ordering — first
 *    backend in the suite with this idiom.
 *  - **`objectClass` schema model.** Entries carry their type as a
 *    multi-valued attribute.
 *  - **LDAP filter DSL.** Extension-free key resolution issues an
 *    OR'd filter — `(&(objectClass=laikaFile)(|(cn=k.md)(cn=k.json)…))`
 *    — resolving any registered extension in **one** search call.
 *  - **`one`-scope subtree searches** for listings.
 *  - **`bulkOps` as the atomic-multi-write primitive.** `removeAtoms(N)`
 *    ships as one bulkOps call with N `del` actions. **The 13th
 *    structurally distinct atomic-multi-write mechanism in the suite.**
 */
export class LdapStorageRepository extends StorageRepository {
  private readonly dataSource: LdapDataSource;
  private readonly baseDn: string;
  private readonly fileObjectClass: string;
  private readonly folderObjectClass: string;
  private readonly contentAttribute: string;
  private readonly parentAttribute: string;
  private readonly extensionAttribute: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: LdapStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      baseDn,
      fileObjectClass = DEFAULT_FILE_OBJECT_CLASS,
      folderObjectClass = DEFAULT_FOLDER_OBJECT_CLASS,
      contentAttribute = DEFAULT_CONTENT_ATTRIBUTE,
      parentAttribute = DEFAULT_PARENT_ATTRIBUTE,
      extensionAttribute = DEFAULT_EXTENSION_ATTRIBUTE,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    if (!baseDn) throw new BadRequestError('LdapStorageRepository requires `baseDn`');
    this.dataSource = dataSource;
    this.baseDn = baseDn;
    this.fileObjectClass = fileObjectClass;
    this.folderObjectClass = folderObjectClass;
    this.contentAttribute = contentAttribute;
    this.parentAttribute = parentAttribute;
    this.extensionAttribute = extensionAttribute;
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

  // ───────────────────────── DN plumbing ─────────────────────────

  /** Build the DN of a folder at `key`. */
  private folderDn(key: string): string {
    const segments = stripSlashes(key).split('/').filter(s => s !== '');
    const rdns: Array<readonly [string, string]> = segments.map(s => ['ou', s]);
    return buildDn(this.baseDn, rdns);
  }

  /** Build the DN of a file at `key` with a given extension. */
  private fileDn(key: string, extension: string): string {
    const stripped = stripSlashes(this.stripExtension(key));
    const segments = stripped.split('/').filter(s => s !== '');
    const fileName = segments[segments.length - 1] ?? '';
    const ancestorOus = segments.slice(0, -1);
    const rdns: Array<readonly [string, string]> = [
      ...ancestorOus.map(s => ['ou', s] as const),
      ['cn', `${fileName}.${extension}`],
    ];
    return buildDn(this.baseDn, rdns);
  }

  /** Build the DN of the parent OU (or `baseDn` for root-level keys). */
  private parentDn(key: string): string {
    const { parent } = splitPath(stripSlashes(this.stripExtension(key)));
    return parent === '' ? this.baseDn : this.folderDn(parent);
  }

  // ───────────────────────── content helpers ─────────────────────────

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

  // ───────────────────────── extension-free resolution ─────────────────────────

  /**
   * Resolve an extension-free key to its `(entry, extension)` pair via
   * a **single** LDAP search using an OR'd filter on `cn`:
   *
   *     (&(objectClass=laikaFile)(|(cn=hello.md)(cn=hello.json)(cn=hello.txt)))
   *
   * Scope `one` against the parent OU — looks at immediate children only.
   */
  private async resolveFile(key: string): Promise<{ entry: LdapEntry; extension: string } | null> {
    const stripped = stripSlashes(this.stripExtension(key));
    const { name } = splitPath(stripped);
    const parentDn = this.parentDn(stripped);

    const nameFilter = orFilter(
      ...this.availableExtensions.map(ext => eqFilter('cn', `${name}.${ext}`)),
    );
    const filter = andFilter(eqFilter('objectClass', this.fileObjectClass), nameFilter);

    const result = await this.dataSource.search({
      base: parentDn,
      scope: 'one',
      filter,
      sizeLimit: 1,
    });
    if (Result.isFailure(result)) return null;
    const entry = result.success[0];
    if (!entry) return null;
    const cn = readAttribute(entry, 'cn');
    if (!cn) return null;
    const extension = cn.includes('.') ? cn.slice(cn.lastIndexOf('.') + 1) : '';
    if (!this.availableExtensions.includes(extension)) return null;
    return { entry, extension };
  }

  /** Check whether a folder OU exists at `key`. */
  private async hasFolder(key: string): Promise<boolean> {
    const k = stripSlashes(key);
    if (k === '') {
      // Root — base DN existence probe.
      const r = await this.dataSource.search({
        base: this.baseDn,
        scope: 'base',
        filter: '(objectClass=*)',
        sizeLimit: 1,
      });
      return Result.isSuccess(r) && r.success.length > 0;
    }
    const dn = this.folderDn(k);
    const r = await this.dataSource.search({
      base: dn,
      scope: 'base',
      filter: '(objectClass=*)',
      sizeLimit: 1,
    });
    return Result.isSuccess(r) && r.success.length > 0;
  }

  // ───────────────────────── ancestor-folder bootstrap ─────────────────────────

  /**
   * Ensure every ancestor OU on the path to `key` exists. LDAP requires
   * the parent entry to exist before adding a child; we walk the segments
   * and `add` any missing OUs idempotently.
   */
  private async ensureAncestorOus(key: string): Promise<LaikaResult<void>> {
    const segments = stripSlashes(this.stripExtension(key)).split('/').filter(s => s !== '');
    // The leaf is the file itself — don't create an OU for it.
    const ancestorSegments = segments.slice(0, -1);
    for (let i = 0; i < ancestorSegments.length; i += 1) {
      const partial = ancestorSegments.slice(0, i + 1).join('/');
      const dn = this.folderDn(partial);
      const segment = ancestorSegments[i]!;
      const probe = await this.dataSource.search({
        base: dn,
        scope: 'base',
        filter: '(objectClass=*)',
        sizeLimit: 1,
      });
      if (Result.isSuccess(probe) && probe.success.length > 0) continue;
      const add = await this.dataSource.add(dn, {
        objectClass: ['top', 'organizationalUnit', this.folderObjectClass],
        ou: segment,
        [this.parentAttribute]: ancestorSegments.slice(0, i).join('/'),
      });
      if (Result.isFailure(add)) {
        // EntryAlreadyExists is fine — race or pre-existing OU.
        if (!(add.failure instanceof EntryAlreadyExistsError)) return add;
      }
    }
    return Result.succeed(undefined);
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`LDAP entry not found: ${key}`));
        }
        const content = readAttribute(resolved.entry, this.contentAttribute) ?? '';
        const parent = readAttribute(resolved.entry, this.parentAttribute) ?? '';
        const deserialized = yield* Effect.promise(() => this.deserialize(resolved.extension, content));
        const callerKey = parent === '' ? this.stripExtension(splitPath(stripSlashes(key)).name) : key;
        return {
          type: 'object',
          key: stripSlashes(callerKey),
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          content: deserialized,
          // DN is the canonical identity — surface as revisionId so callers
          // can detect renames (different DN ⇒ different entry).
          metadata: { extension: resolved.extension, revisionId: resolved.entry.dn },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* Effect.promise(() => this.hasFolder(key));
        if (!exists) {
          return yield* Effect.fail(new NotFoundError(`LDAP folder not found: ${key || '<root>'}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key: stripSlashes(key), createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.resolveFile(key));
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
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        // LDAP needs parent OUs to exist — bootstrap them first.
        yield* liftResult(this.ensureAncestorOus(create.key));

        const { parent, name } = splitPath(this.stripExtension(create.key));
        const dn = this.fileDn(create.key, extension);
        yield* liftResult(this.dataSource.add(dn, {
          objectClass: ['top', this.fileObjectClass],
          cn: `${name}.${extension}`,
          [this.parentAttribute]: parent,
          [this.extensionAttribute]: extension,
          [this.contentAttribute]: serialized,
        }));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`LDAP entry not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() =>
            this.serialize(existing.extension, update.content!)
          );
          // LDAP `modify` with `replace` mutates the attribute in place.
          yield* liftResult(this.dataSource.modify(existing.entry.dn, [
            {
              operation: 'replace',
              modification: { type: this.contentAttribute, values: [serialized] },
            },
          ]));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        if (existing) {
          // Path through update.
          return yield* LaikaTask.runValue(this.updateObject({
            key: create.key,
            content: create.content,
          } as StorageObjectUpdate));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        yield* liftResult(this.ensureAncestorOus(`${k}/.`)); // ensure all ancestors AND `k` itself
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

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

        // ── Round-trip 1: resolve every key → DN via parallel filter
        //    searches.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string; dn: string | null }> = [];
          for (const k of cleanKeys) {
            const r = await this.resolveFile(k);
            out.push({ key: k, dn: r?.entry.dn ?? null });
          }
          return out;
        });

        const found = resolved.filter(r => r.dn !== null) as Array<{ key: string; dn: string }>;
        const missing = resolved.filter(r => r.dn === null);

        // ── Round-trip 2: ONE bulkOps call with N `del` actions.
        // The 13th structurally distinct atomic-multi-write mechanism.
        let removed = 0;
        if (found.length > 0) {
          const ops: LdapBulkOp[] = found.map(f => ({ kind: 'del', dn: f.dn }));
          const bulkResult = yield* liftResult(this.dataSource.bulkOps(ops));
          for (let i = 0; i < found.length; i += 1) {
            const r = bulkResult[i];
            const f = found[i]!;
            if (r && r.status === 'OK') {
              yield* emit.data(f.key);
              removed += 1;
            } else {
              yield* emit.recoverableError(
                new NotFoundError(`LDAP bulk-delete failed for ${f.key}: ${r?.message ?? 'unknown'}`),
              );
            }
          }
        }
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`LDAP entry not found: ${m.key}`));
        }
        return { removed, skipped: skipped0 + missing.length + (found.length - removed) };
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

  /**
   * One `scope='one'` LDAP search against the parent OU. Returns immediate
   * children only — files and OUs at this exact level. No need to
   * filter client-side or paginate prefix scans.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const k = stripSlashes(folderKey);
      const base = k === '' ? this.baseDn : this.folderDn(k);

      const entries = yield* liftResult(this.dataSource.search({
        base,
        scope: 'one',
        // `(objectClass=*)` — match everything; we discriminate by class
        // when projecting to summaries.
        filter: '(objectClass=*)',
      }));

      const summaries: AtomSummary[] = [];
      const callerPrefix = k === '' ? '' : `${k}/`;

      for (const entry of entries) {
        const classes = entry.attributes['objectClass'];
        const classList = Array.isArray(classes) ? classes : classes ? [classes] : [];
        if (classList.includes(this.fileObjectClass)) {
          const cn = readAttribute(entry, 'cn') ?? '';
          let name = cn;
          for (const ext of this.availableExtensions) {
            if (name.endsWith(`.${ext}`)) { name = name.slice(0, -(ext.length + 1)); break; }
          }
          summaries.push({ type: 'object-summary', key: callerPrefix + name });
        } else if (classList.includes('organizationalUnit') || classList.includes(this.folderObjectClass)) {
          const ou = readAttribute(entry, 'ou') ?? '';
          summaries.push({ type: 'folder-summary', key: callerPrefix + ou });
        }
      }

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
        description: 'Each object is one LDAP entry; the extension is encoded into the cn RDN and stored separately in laikaExtension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over LDAP search results; native server-side paging via the LDAP Paged Results control (RFC 2696) not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
