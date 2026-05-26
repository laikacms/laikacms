/**
 * Obsidian Assets Implementation for Laika CMS
 *
 * Implements the `AssetsRepository` interface over the files of an Obsidian
 * vault: every non-markdown file (image, PDF, audio, ...) is exposed as an
 * `Asset` keyed by its vault-relative path.
 *
 * Geared towards *retrieving* attachments that already live next to your
 * notes. Writing assets into a vault bloats whatever syncs it, so for
 * write-heavy workloads prefer an object-storage backend such as `assets-r2`.
 */

export { ObsidianAssetsRepository, type ObsidianAssetsRepositoryOptions } from './assets-repository.js';
