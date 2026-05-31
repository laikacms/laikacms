/* eslint-disable */
// @ts-nocheck
// This file is executed by the PocketBase JS VM, not Node.js.
// `migrate`, `Collection`, `Dao` are PocketBase globals.

/**
 * PocketBase migration: create the laika_storage collection.
 *
 * Run via `./pocketbase migrate up` after dropping this file next to your
 * PocketBase executable, or apply manually in the PocketBase Admin UI.
 *
 * Collection fields:
 *   type      — "file" | "folder"
 *   parent    — parent folder path (empty string for root)
 *   name      — entry name (filename or folder name)
 *   path      — full path (parent/name), unique
 *   extension — file extension without dot (e.g. "md"), null for folders
 *   content   — serialised file content (markdown, JSON, YAML), null for folders
 */
migrate(
  db => {
    const collection = new Collection({
      name: 'laika_storage',
      type: 'base',
      schema: [
        { name: 'type', type: 'text', required: true, options: { max: 10 } },
        { name: 'parent', type: 'text', required: false, options: { max: 2000 } },
        { name: 'name', type: 'text', required: true, options: { max: 500 } },
        { name: 'path', type: 'text', required: true, options: { max: 2000 } },
        { name: 'extension', type: 'text', required: false, options: { max: 20 } },
        { name: 'content', type: 'text', required: false, options: {} },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_laika_storage_path` ON `laika_storage` (`path`)',
        'CREATE INDEX `idx_laika_storage_parent` ON `laika_storage` (`parent`)',
        'CREATE INDEX `idx_laika_storage_type_parent` ON `laika_storage` (`type`, `parent`)',
      ],
    });
    return Dao(db).saveCollection(collection);
  },
  db => Dao(db).deleteCollection(Dao(db).findCollectionByNameOrId('laika_storage')),
);
