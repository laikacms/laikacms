import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError, LaikaTask, NotFoundError } from 'laikacms/core';
import type { DocumentsRepository } from 'laikacms/documents';

import { buildJsonApi, type DocumentsAuthorizeInput } from './server.js';

// A repo whose read/delete surface is spied. `getDocument` resolves to a
// NotFound so we can prove the repo was *reached* (i.e. the action was allowed)
// without needing a fully-shaped Document fixture.
function spyRepo() {
  const getDocument = vi.fn((_key: string) => LaikaTask.make(() => Effect.fail(new NotFoundError('not found'))));
  const deleteDocument = vi.fn((_key: string) => LaikaTask.succeed(undefined));
  const createUnpublished = vi.fn(() => LaikaTask.succeed(undefined));
  const repo = { getDocument, deleteDocument, createUnpublished } as unknown as DocumentsRepository;
  return { repo, getDocument, deleteDocument, createUnpublished };
}

describe('documents-api authorize hook', () => {
  it('allows the action and forwards it to the repo when the callback returns true', async () => {
    const { repo, getDocument } = spyRepo();
    const authorize = vi.fn(() => true);
    const api = buildJsonApi({ repo, authorize });

    await api.fetch(new Request('http://localhost/published/posts%2Fhello'));

    expect(getDocument).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('passes the action, direct args, and the request to the callback', async () => {
    const { repo } = spyRepo();
    let received: DocumentsAuthorizeInput | undefined;
    const request = new Request('http://localhost/published/posts%2Fhello');
    const api = buildJsonApi({
      repo,
      authorize: input => {
        received = input;
        return true;
      },
    });

    await api.fetch(request);

    expect(received?.action).toBe('getDocument');
    expect(received && 'key' in received ? received.key : undefined).toBe('posts/hello');
    expect(received?.request).toBe(request);
  });

  it('denies with a 403 (and never touches the repo) when the callback returns false', async () => {
    const { repo, getDocument } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    const res = await api.fetch(new Request('http://localhost/published/secret'));

    expect(res.status).toBe(403);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('denies with the callback-supplied LaikaError status (e.g. 401)', async () => {
    const { repo, getDocument } = spyRepo();
    const api = buildJsonApi({
      repo,
      authorize: () => new AuthenticationError('Missing bearer token'),
    });

    const res = await api.fetch(new Request('http://localhost/published/secret'));

    expect(res.status).toBe(401);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('rejects the whole atomic batch before any write when one sub-op is denied', async () => {
    const { repo, deleteDocument, createUnpublished } = spyRepo();
    // Deny createUnpublished; the batch must fail before any write runs.
    const authorize = vi.fn((input: DocumentsAuthorizeInput) => input.action !== 'createUnpublished');
    const api = buildJsonApi({ repo, authorize });

    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          operations: [
            { op: 'remove', ref: { type: 'document', id: 'a' } },
            { op: 'add', data: { type: 'unpublished', id: 'b', attributes: { title: 'x' } } },
          ],
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(createUnpublished).not.toHaveBeenCalled();
  });
});
