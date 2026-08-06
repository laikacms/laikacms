import type { AssetsRepository } from 'laikacms/assets';
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DefaultContentBaseSettingsProvider } from 'laikacms/contentbase-settings-default';
import { LaikaStream, LaikaTask } from 'laikacms/core';
import type { DocumentsRepository } from 'laikacms/documents';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { jsonSerializer } from 'laikacms/serializers/json';
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { rawSerializer } from 'laikacms/serializers/raw';
import { yamlSerializer } from 'laikacms/serializers/yaml';
import type { StorageRepository, StorageSerializerRegistry } from 'laikacms/storage';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

import type { LaikaId, Namespace } from './protocol.js';

/**
 * The default serializer registry for the filesystem storage repository. The
 * registry is keyed by *file extension*, so every spelling a content author is
 * likely to reach for gets its own entry: `.json` (also used by ContentBase for
 * its collection settings and per-object metadata), `.yaml`/`.yml`,
 * `.md`/`.mdx`/`.markdown` (frontmatter + `body`), and raw passthrough.
 */
export function defaultSerializers(): StorageSerializerRegistry {
  return {
    json: jsonSerializer,
    markdown: markdownSerializer,
    md: markdownSerializer,
    mdx: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    raw: rawSerializer,
  };
}

export interface FsStorageOptions {
  /** Absolute path the filesystem repository reads and writes. */
  dir: string;
  /** File extension applied to new objects created without one. Defaults to `'json'`. */
  defaultExtension?: string;
  /** Serializer registry keyed by format. Defaults to {@link defaultSerializers}. */
  serializers?: StorageSerializerRegistry;
}

/** Construct a {@link FileSystemStorageRepository} — the default backend for the loader. */
export function createFsStorage(options: FsStorageOptions): StorageRepository {
  return new FileSystemStorageRepository(
    options.dir,
    options.serializers ?? defaultSerializers(),
    options.defaultExtension ?? 'json',
  );
}

/**
 * The repositories the plugin works through: `storage`/`documents` back the
 * `laika:` loader, and `assets` backs local mode's media API.
 */
export interface LaikaRepositories {
  storage: StorageRepository;
  documents: DocumentsRepository;
  assets: AssetsRepository;
}

/** Derive documents and assets repositories from a storage repository via ContentBase. */
export function createRepositories(storage: StorageRepository): LaikaRepositories {
  const settings = new DefaultContentBaseSettingsProvider({ storage });
  return {
    storage,
    documents: new ContentBaseDocumentsRepository(storage, settings),
    assets: new ContentBaseAssetsRepository(storage, settings),
  };
}

/** The content payload plus repository metadata for one item. */
export interface ReadResult {
  content: Record<string, unknown>;
  meta: Record<string, unknown>;
}

/** Read one content item by its {@link LaikaId}, dispatching on the namespace. */
export async function readItem(repos: LaikaRepositories, id: LaikaId): Promise<ReadResult> {
  if (id.namespace === 'store') {
    const object = await LaikaTask.runPromise(repos.storage.getObject(id.key));
    return {
      content: object.content ?? {},
      meta: { key: object.key, type: object.type, ...(object.metadata ?? {}) },
    };
  }
  const document = await LaikaTask.runPromise(repos.documents.getDocument(id.key));
  return {
    content: document.content ?? {},
    meta: {
      key: document.key,
      language: document.language,
      status: document.status,
      ...(document.version !== undefined ? { version: document.version } : {}),
    },
  };
}

/**
 * List the keys under `folder` for a namespace, up to `depth` levels deep.
 * Used to expand `import.meta.glob('laika:…')` patterns against the repository.
 */
export async function listKeys(
  repos: LaikaRepositories,
  namespace: Namespace,
  folder?: string,
  depth?: number,
): Promise<string[]> {
  // No folder given → enumerate every key in the namespace (typegen's full
  // regenerate). A folder (even `''`, a glob rooted at the top) scopes it.
  if (folder === undefined) return listAllKeys(repos, namespace);
  const pagination = { perPage: 10_000 };
  const listDepth = depth ?? 1;
  if (namespace === 'store') {
    const { data } = await LaikaStream.runPromiseCollect(
      repos.storage.listAtomSummaries(folder, { depth: listDepth, pagination }),
    );
    return data.filter(atom => atom.type === 'object-summary').map(atom => atom.key);
  }
  const { data } = await LaikaStream.runPromiseCollect(
    repos.documents.listRecordSummaries({
      ...(folder ? { folder } : {}),
      depth: listDepth,
      pagination,
      type: 'published',
    }),
  );
  return data.filter(record => record.type === 'published-summary').map(record => record.key);
}

/**
 * Enumerate every content key in a namespace — used by typegen's full
 * regenerate to pre-warm types before any module is imported. Storage lists
 * objects recursively; documents surface each collection as a folder at the
 * root, so we walk one level into every collection to reach its published docs.
 */
async function listAllKeys(repos: LaikaRepositories, namespace: Namespace): Promise<string[]> {
  const pagination = { perPage: 10_000 };
  const DEEP = 64;
  if (namespace === 'store') {
    const { data } = await LaikaStream.runPromiseCollect(
      repos.storage.listAtomSummaries('', { depth: DEEP, pagination }),
    );
    return data.filter(atom => atom.type === 'object-summary').map(atom => atom.key);
  }
  const seen = new Set<string>();
  const folders: string[] = [];
  const { data: root } = await LaikaStream.runPromiseCollect(
    repos.documents.listRecordSummaries({ depth: 1, pagination }),
  );
  for (const record of root) {
    if (record.type === 'published-summary') seen.add(record.key);
    else if (record.type === 'folder-summary') folders.push(record.key);
  }
  for (const folder of folders) {
    const { data } = await LaikaStream.runPromiseCollect(
      repos.documents.listRecordSummaries({ folder, depth: DEEP, pagination, type: 'published' }),
    );
    for (const record of data) {
      if (record.type === 'published-summary') seen.add(record.key);
    }
  }
  return [...seen];
}
