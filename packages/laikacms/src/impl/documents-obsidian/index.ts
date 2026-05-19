/**
 * Obsidian Documents Implementation for Laika CMS
 *
 * Implements the `DocumentsRepository` interface over an Obsidian vault. Each
 * markdown note is a document keyed by its vault-relative path; the published /
 * unpublished state is read from frontmatter (the `publish` property, matching
 * Obsidian Publish) rather than from separate directories.
 *
 * Pair it with a `StorageRepository` pointed at the vault root — typically a
 * `FileSystemStorageRepository` configured with the markdown serializer.
 */

export {
  ObsidianDocumentsRepository,
  type ObsidianDocumentsRepositoryOptions,
} from './documents-repository.js';
