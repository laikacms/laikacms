import { describe, expect, it, vi } from 'vitest';

import type { ContentBaseSettings, ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import { AuthenticationError, LaikaTask } from 'laikacms/core';

import { buildJsonApi, type ContentbaseAuthorizeInput } from './server.js';

const settings: ContentBaseSettings = {
  collections: {
    posts: { type: 'document', key: 'posts', name: 'Posts' },
  },
};

function spyRepo() {
  const getSettings = vi.fn(() => LaikaTask.succeed(settings));
  const getDocumentCollectionSettings = vi.fn((_key: string) => LaikaTask.succeed(settings.collections!.posts));
  const putSettings = vi.fn(() => LaikaTask.succeed(undefined));
  const repo = {
    getSettings,
    getDocumentCollectionSettings,
    putSettings,
  } as unknown as ContentBaseSettingsProvider;
  return { repo, getSettings, putSettings };
}

describe('contentbase-api authorize hook', () => {
  it('allows the action and forwards it to the repo when the callback returns true', async () => {
    const { repo, getSettings } = spyRepo();
    const authorize = vi.fn(() => true);
    const api = buildJsonApi({ repo, authorize });

    const res = await api.fetch(new Request('http://localhost/collections'));

    expect(res.status).toBe(200);
    expect(getSettings).toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('passes the action, direct args, and the request to the callback', async () => {
    const { repo } = spyRepo();
    let received: ContentbaseAuthorizeInput | undefined;
    const request = new Request('http://localhost/collections/posts');
    const api = buildJsonApi({
      repo,
      authorize: input => {
        received = input;
        return true;
      },
    });

    await api.fetch(request);

    expect(received?.action).toBe('getCollection');
    expect(received && 'key' in received ? received.key : undefined).toBe('posts');
    // Hono exposes the underlying Request as c.req.raw.
    expect(received?.request).toBeInstanceOf(Request);
    expect(received?.request.url).toBe(request.url);
  });

  it('denies with a 403 (and never touches the repo) when the callback returns false', async () => {
    const { repo, getSettings } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    const res = await api.fetch(new Request('http://localhost/collections/posts'));

    expect(res.status).toBe(403);
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('denies with the callback-supplied LaikaError status (e.g. 401)', async () => {
    const { repo, getSettings } = spyRepo();
    const api = buildJsonApi({
      repo,
      authorize: () => new AuthenticationError('Missing bearer token'),
    });

    const res = await api.fetch(new Request('http://localhost/collections/posts'));

    expect(res.status).toBe(401);
    expect(getSettings).not.toHaveBeenCalled();
    const body = await res.json() as { errors: Array<{ detail: string }> };
    expect(body.errors[0]?.detail).toBe('Missing bearer token');
  });

  it('denies a delete before any write when the callback returns false', async () => {
    const { repo, getSettings, putSettings } = spyRepo();
    const api = buildJsonApi({ repo, authorize: () => false });

    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );

    expect(res.status).toBe(403);
    expect(getSettings).not.toHaveBeenCalled();
    expect(putSettings).not.toHaveBeenCalled();
  });
});
