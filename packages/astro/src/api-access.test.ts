import { describe, expect, it } from 'vitest';

import { type ApiAccess, authorizersFor } from './api-access.js';

const request = new Request('https://example.com/');

const documents = (access: ApiAccess, action: string, extra: Record<string, unknown> = {}) =>
  authorizersFor(access).documents({ action, request, ...extra } as never);
const storage = (access: ApiAccess, action: string) => authorizersFor(access).storage({ action, request } as never);
const assets = (access: ApiAccess, action: string) => authorizersFor(access).assets({ action, request } as never);

const listing = { options: { type: 'published', depth: 1, pagination: { perPage: 10 } } };

describe("the default 'published' access", () => {
  it('allows reading published documents — what a built site already ships', () => {
    expect(documents('published', 'getDocument', { key: 'posts/a' })).toBe(true);
    expect(documents('published', 'listRecordSummaries', listing)).toBe(true);
    expect(documents('published', 'listRecords', listing)).toBe(true);
    expect(documents('published', 'getCapabilities')).toBe(true);
    expect(documents('published', 'readOpenApi', { format: 'json' })).toBe(true);
  });

  it('refuses drafts, which a built site does not ship', () => {
    expect(documents('published', 'getUnpublished', { key: 'posts/wip' })).toBe(false);
  });

  it('refuses to list drafts even when the request asks for them by filter', () => {
    // The action name alone does not settle this: `filter[type]=unpublished`
    // reaches the same action. Denying only the action would leak every draft.
    expect(documents('published', 'listRecords', { options: { type: 'unpublished', depth: 1 } }))
      .toBe(false);
    expect(
      documents('published', 'listRecordSummaries', { options: { type: 'unpublished', depth: 1 } }),
    ).toBe(false);
  });

  it('refuses a listing that asks for every type at once', () => {
    // `filter[type]=all` leaves `type` unset, which would otherwise slip past a
    // check that only looked for the string 'unpublished'.
    expect(documents('published', 'listRecords', { options: { depth: 1 } })).toBe(false);
  });

  it('refuses revisions and locks', () => {
    expect(documents('published', 'getRevision', { key: 'a', revisionId: 'r' })).toBe(false);
    expect(documents('published', 'listRevisions', { key: 'a' })).toBe(false);
    expect(documents('published', 'getLock', { key: 'a' })).toBe(false);
  });

  it('refuses every write', () => {
    for (
      const action of [
        'createDocument',
        'updateDocument',
        'deleteDocument',
        'publish',
        'unpublish',
        'createUnpublished',
        'updateUnpublished',
        'deleteUnpublished',
        'createRevision',
        'acquireLock',
        'releaseLock',
        'refreshLock',
      ]
    ) {
      expect(documents('published', action), action).toBe(false);
    }
  });

  it('allows storage reads and refuses storage writes', () => {
    expect(storage('published', 'getObject')).toBe(true);
    expect(storage('published', 'listAtomSummaries')).toBe(true);
    expect(storage('published', 'createObject')).toBe(false);
    expect(storage('published', 'updateObject')).toBe(false);
    expect(storage('published', 'removeObject')).toBe(false);
    expect(storage('published', 'createFolder')).toBe(false);
  });

  it('allows asset reads and refuses asset writes', () => {
    expect(assets('published', 'getResource')).toBe(true);
    expect(assets('published', 'listResources')).toBe(true);
    expect(assets('published', 'createAsset')).toBe(false);
    expect(assets('published', 'updateAsset')).toBe(false);
    expect(assets('published', 'deleteResource')).toBe(false);
  });
});

describe("'read' access", () => {
  it('adds drafts and revisions to what may be read', () => {
    expect(documents('read', 'getUnpublished', { key: 'posts/wip' })).toBe(true);
    expect(documents('read', 'getRevision', { key: 'a', revisionId: 'r' })).toBe(true);
    expect(documents('read', 'listRecords', { options: { type: 'unpublished', depth: 1 } }))
      .toBe(true);
  });

  it('still refuses every write', () => {
    expect(documents('read', 'createDocument')).toBe(false);
    expect(documents('read', 'deleteDocument', { key: 'a' })).toBe(false);
    expect(storage('read', 'updateObject')).toBe(false);
    expect(assets('read', 'createAsset')).toBe(false);
  });
});

describe("'all' access", () => {
  it('permits everything, including writes', () => {
    expect(documents('all', 'deleteDocument', { key: 'a' })).toBe(true);
    expect(storage('all', 'removeObject')).toBe(true);
    expect(assets('all', 'createAsset')).toBe(true);
  });
});

describe('the policy shape', () => {
  it('is an allowlist, so an action added upstream is denied until reviewed', () => {
    // A denylist would silently make a newly-added action public the moment
    // laikacms is upgraded.
    expect(documents('published', 'someFutureAction')).toBe(false);
    expect(storage('published', 'someFutureAction')).toBe(false);
    expect(assets('published', 'someFutureAction')).toBe(false);
  });
});
