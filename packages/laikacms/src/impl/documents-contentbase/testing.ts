import * as Result from 'effect/Result';
import type { JSONSchema7 } from 'json-schema';
import {
  type ContentBaseSettings,
  ContentBaseSettingsProvider,
  defaultUnpublishedStatuses,
  type DocumentCollectionSettings,
  type MediaCollectionSettings,
} from 'laikacms/contentbase-settings';
import { NotFoundError } from 'laikacms/core';

import { type DocumentsContractCase, documentsContractRegistry } from '../../domain/documents/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';

import { ContentBaseDocumentsRepository } from './documents-repository.js';

/**
 * A test settings provider that hard-codes the `posts` collection with the
 * standard `defaultUnpublishedStatuses` map. `DefaultContentBaseSettingsProvider`
 * intentionally synthesizes settings without `unpublishedStatuses` so the
 * unpublished workflow doesn't survive a round-trip there — the contract uses
 * an explicit provider to exercise that workflow.
 */
export class TestSettingsProvider extends ContentBaseSettingsProvider {
  private readonly doc: DocumentCollectionSettings = {
    type: 'document',
    key: 'posts',
    name: 'Posts',
    directory: 'posts',
    unpublishedStatuses: { ...defaultUnpublishedStatuses },
    revisionDirectory: '.contentbase/posts/revisions',
  };

  private readonly media: MediaCollectionSettings = {
    type: 'media',
    key: 'uploads',
    name: 'Uploads',
    directory: 'uploads',
  };

  async getSettings() {
    return Result.succeed<ContentBaseSettings>({
      collections: { posts: this.doc, uploads: this.media },
    } as ContentBaseSettings);
  }
  async putSettings() {
    return Result.succeed(undefined as void);
  }
  async getDocumentCollectionSettings() {
    return Result.succeed(this.doc);
  }
  async putDocumentCollectionSettings() {
    return Result.succeed(undefined as void);
  }
  async getMediaCollectionSettings() {
    return Result.succeed(this.media);
  }
  async putMediaCollectionSettings() {
    return Result.succeed(undefined as void);
  }
  async getCollectionSchema() {
    return Result.fail(new NotFoundError('no schema'));
  }
  async putCollectionSchema(_collection: string, _schema: JSONSchema7) {
    return Result.succeed(undefined as void);
  }
}

export const contentBaseDocumentsContractCase: DocumentsContractCase = {
  name: 'ContentBaseDocumentsRepository (over in-memory storage)',
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    return new ContentBaseDocumentsRepository(storage, settings);
  },
};

documentsContractRegistry.push(contentBaseDocumentsContractCase);
