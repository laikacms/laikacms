import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError, LaikaStream, LaikaTask } from 'laikacms/core';
import type { RemoveAtomsDone, StorageObject, StorageRepository } from 'laikacms/storage';

import { buildJsonApi, type StorageAuthorizeInput } from './server.js';

const storageObject = (key: string): StorageObject => ({
  type: 'object',
  key,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  content: { body: 'hi' },
  metadata: { extension: 'json' },
});

// A repo whose methods succeed but flag if they were invoked, so we can assert
// that a denied action never reaches the repository.
function spyRepo() {
  const getObject = vi.fn((key: string) => LaikaTask.succeed(storageObject(key)));
  const removeAtoms = vi.fn((keys: readonly string[]) =>
    LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen(function*() {
        for (const k of keys) yield* emit.data(k);
        return { removed: keys.length };
      })
    )
  );
  const repo = { getObject, removeAtoms } as unknown as StorageRepository;
  return { repo, getObject, removeAtoms };
}

describe('storage-api authorize hook', () => {
  it('allows the action and forwards it to the repo when the callback returns true', async () => {
    const { repo, getObject } = spyRepo();
    const authorize = vi.fn(() => true);
    const api = buildJsonApi({ repo, authorize });

    const res = await api.fetch(new Request('http://localhost/objects/notes%2Fhello'));

    expect(res.status).toBe(200);
    expect(getObject).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('passes the action, direct args, and the request to the callback', async () => {
    const { repo } = spyRepo();
    let received: StorageAuthorizeInput | undefined;
    const request = new Request('http://localhost/objects/notes%2Fhello');
    const api = buildJsonApi({
      repo,
      authorize: input => {
        received = input;
        return true;
      },
    });

    await api.fetch(request);

    expect(received?.action).toBe('getObject');
    expect(received && 'key' in received ? received.key : undefined).toBe('notes/hello');
    expect(received?.request).toBe(request);
  });

  it('denies with a 403 (and never touches the repo) when the callback returns false', async () => {
    const { repo, getObject } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    const res = await api.fetch(new Request('http://localhost/objects/secret'));

    expect(res.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('denies with the callback-supplied LaikaError status (e.g. 401)', async () => {
    const { repo, getObject } = spyRepo();
    const api = buildJsonApi({
      repo,
      authorize: () => new AuthenticationError('Missing bearer token'),
    });

    const res = await api.fetch(new Request('http://localhost/objects/secret'));

    expect(res.status).toBe(401);
    expect(getObject).not.toHaveBeenCalled();
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]?.detail).toBe('Missing bearer token');
  });

  it('supports async callbacks (e.g. a token lookup)', async () => {
    const { repo, getObject } = spyRepo();
    const api = buildJsonApi({
      repo,
      authorize: async () => {
        await Promise.resolve();
        return false;
      },
    });

    const res = await api.fetch(new Request('http://localhost/objects/secret'));

    expect(res.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('rejects the whole atomic batch before any write when one sub-op is denied', async () => {
    const { repo, removeAtoms } = spyRepo();
    // Deny only the createObject sub-op; the batch must fail as a whole.
    const authorize = vi.fn((input: StorageAuthorizeInput) => input.action !== 'createObject');
    const api = buildJsonApi({ repo, authorize });

    const res = await api.fetch(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          'atomic:operations': [
            { op: 'remove', ref: { type: 'object', id: 'a' } },
            { op: 'add', data: { type: 'object', id: 'b', attributes: { content: {} } } },
          ],
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(removeAtoms).not.toHaveBeenCalled();
  });
});
