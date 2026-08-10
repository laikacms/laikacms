import type { JSONSchema7 } from 'json-schema';
import {
  type Catalog,
  CatalogProvider,
  defaultUnpublishedStatuses,
  type DocumentCollectionSettings,
  type MediaCollectionSettings,
} from 'laikacms/catalog';
import { LaikaTask, NotFoundError } from 'laikacms/core';

import type { DocumentsContractCase } from '../../domain/documents/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';

import { CatalogDocumentsRepository } from './documents-repository.js';

/**
 * A test settings provider that hard-codes the `posts` collection with the
 * standard `defaultUnpublishedStatuses` map. `ConventionCatalogProvider`
 * intentionally synthesizes settings without `unpublishedStatuses` so the
 * unpublished workflow doesn't survive a round-trip there — the contract uses
 * an explicit provider to exercise that workflow.
 */
export class TestSettingsProvider extends CatalogProvider {
  private readonly doc: DocumentCollectionSettings = {
    type: 'document',
    key: 'posts',
    name: 'Posts',
    directory: 'posts',
    unpublishedStatuses: { ...defaultUnpublishedStatuses },
    revisionDirectory: '.laika/posts/revisions',
  };

  private readonly media: MediaCollectionSettings = {
    type: 'media',
    key: 'uploads',
    name: 'Uploads',
    directory: 'uploads',
  };

  getCatalog() {
    return LaikaTask.succeed<Catalog>({
      collections: { posts: this.doc, uploads: this.media },
    } as Catalog);
  }
  putCatalog() {
    return LaikaTask.succeed(undefined as void);
  }
  getDocumentCollectionSettings() {
    return LaikaTask.succeed(this.doc);
  }
  putDocumentCollectionSettings() {
    return LaikaTask.succeed(undefined as void);
  }
  getMediaCollectionSettings() {
    return LaikaTask.succeed(this.media);
  }
  putMediaCollectionSettings() {
    return LaikaTask.succeed(undefined as void);
  }
  getCollectionSchema() {
    return LaikaTask.fail(new NotFoundError('no schema'));
  }
  putCollectionSchema(_collection: string, _schema: JSONSchema7) {
    return LaikaTask.succeed(undefined as void);
  }
}

export const catalogDocumentsContractCase: DocumentsContractCase = {
  name: 'CatalogDocumentsRepository (over in-memory storage)',
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    return new CatalogDocumentsRepository(storage, settings);
  },
};
