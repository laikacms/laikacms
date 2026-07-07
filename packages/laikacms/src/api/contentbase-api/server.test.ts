import { describe, expect, it, vi } from 'vitest';

import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type {
  ContentBaseSettings,
  DocumentCollectionSettings,
  MediaCollectionSettings,
} from 'laikacms/contentbase-settings';
import { LaikaTask, NotFoundError } from 'laikacms/core';

import { buildJsonApi } from './server.js';

// Minimal stub repo — routes that hit no repo methods (e.g. 404) need nothing.
const stubRepo = {} as ContentBaseSettingsProvider;

const docCollection: DocumentCollectionSettings = {
  type: 'document',
  key: 'posts',
  name: 'Posts',
};

const mediaCollection: MediaCollectionSettings = {
  type: 'media',
  key: 'images',
  name: 'Images',
};

const settingsWithBoth: ContentBaseSettings = {
  collections: {
    posts: docCollection,
    images: mediaCollection,
  },
};

// ---------------------------------------------------------------------------
// Cache-Control
// ---------------------------------------------------------------------------

describe('contentbase-api Cache-Control', () => {
  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on GET /collections', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed({ collections: {} }),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// GET /collections — list
// ---------------------------------------------------------------------------

describe('GET /collections', () => {
  it('returns 200 with a data array', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ type: string, id: string }> };
    expect(body.data).toHaveLength(2);
    const ids = body.data.map(d => d.id);
    expect(ids).toContain('posts');
    expect(ids).toContain('images');
  });

  it('returns 200 with empty data array when no collections', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed({ collections: {} }),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it('returns JSON:API error shape when repo fails', async () => {
    const repo = {
      getSettings: () => LaikaTask.fail(new NotFoundError('settings not found')),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string, title: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// GET /collections/:key — read one
// ---------------------------------------------------------------------------

describe('GET /collections/:key', () => {
  it('returns 200 with document-collection type for a document collection', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
      getDocumentCollectionSettings: (_key: string) => LaikaTask.succeed(docCollection),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections/posts'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('document-collection');
    expect(body.data.id).toBe('posts');
  });

  it('returns 200 with media-collection type for a media collection', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
      getMediaCollectionSettings: (_key: string) => LaikaTask.succeed(mediaCollection),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections/images'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('media-collection');
    expect(body.data.id).toBe('images');
  });

  it('returns 404 JSON:API error when collection key does not exist', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed({ collections: {} }),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(new Request('http://localhost/collections/missing'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, title: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.detail).toContain('missing');
  });
});

// ---------------------------------------------------------------------------
// POST /collections — create
// ---------------------------------------------------------------------------

describe('POST /collections', () => {
  it('returns 201 when creating a document collection', async () => {
    const repo = {
      putDocumentCollectionSettings: (_key: string, _settings: DocumentCollectionSettings) =>
        LaikaTask.succeed(undefined),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'articles',
            attributes: { type: 'document', name: 'Articles' },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('document-collection');
    expect(body.data.id).toBe('articles');
  });

  it('returns 201 when creating a media collection', async () => {
    const repo = {
      putMediaCollectionSettings: (_key: string, _settings: MediaCollectionSettings) => LaikaTask.succeed(undefined),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'videos',
            attributes: { type: 'media', name: 'Videos' },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('media-collection');
    expect(body.data.id).toBe('videos');
  });

  it('returns 400 JSON:API error on invalid request body', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'unknown-type', id: 'x', attributes: {} } }),
      }),
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// PATCH /collections/:key — update
// ---------------------------------------------------------------------------

describe('PATCH /collections/:key', () => {
  it('returns 200 when updating a document collection', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
      putDocumentCollectionSettings: (_key: string, _settings: DocumentCollectionSettings) =>
        LaikaTask.succeed(undefined),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'posts',
            attributes: { type: 'document', name: 'Blog Posts' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('document-collection');
    expect(body.data.id).toBe('posts');
  });

  it('returns 200 when updating a media collection', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
      putMediaCollectionSettings: (_key: string, _settings: MediaCollectionSettings) => LaikaTask.succeed(undefined),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'images',
            attributes: { type: 'media', name: 'Updated Images' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('media-collection');
    expect(body.data.id).toBe('images');
  });

  it('returns 404 JSON:API error when PATCH targets a non-existent collection key', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed({ collections: {} }),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/ghost', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'ghost',
            attributes: { type: 'document', name: 'Ghost' },
          },
        }),
      }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.detail).toContain('ghost');
  });

  it('returns 400 JSON:API error on invalid request body', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
  });

  it('returns 409 Conflict when body data.id differs from URL :key (document)', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
    } as unknown as ContentBaseSettingsProvider;
    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'articles',
            attributes: { type: 'document', name: 'Articles' },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('409');
    expect(body.errors[0]!.detail).toContain('articles');
    expect(body.errors[0]!.detail).toContain('posts');
  });

  it('returns 409 Conflict when body data.id differs from URL :key (media)', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
    } as unknown as ContentBaseSettingsProvider;
    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'videos',
            attributes: { type: 'media', name: 'Videos' },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('409');
    expect(body.errors[0]!.detail).toContain('videos');
    expect(body.errors[0]!.detail).toContain('images');
  });
});

// ---------------------------------------------------------------------------
// DELETE /collections/:key — delete
// ---------------------------------------------------------------------------

describe('DELETE /collections/:key', () => {
  it('returns 204 with no body on successful delete', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed(settingsWithBoth),
      putSettings: (_settings: ContentBaseSettings) => LaikaTask.succeed(undefined),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('returns 404 JSON:API error when deleting a non-existent collection', async () => {
    const repo = {
      getSettings: () => LaikaTask.succeed({ collections: {} }),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo });
    const res = await api.fetch(
      new Request('http://localhost/collections/ghost', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.detail).toContain('ghost');
  });
});

// ---------------------------------------------------------------------------
// onError callback
// ---------------------------------------------------------------------------

describe('contentbase-api onError', () => {
  it('calls onError when getSettings fails on GET /collections', async () => {
    const onError = vi.fn();
    const repo = {
      getSettings: () => LaikaTask.fail(new NotFoundError('settings unavailable')),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo, onError });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(400);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(NotFoundError);
  });

  it('calls onError when getSettings fails on GET /collections/:key', async () => {
    const onError = vi.fn();
    const repo = {
      getSettings: () => LaikaTask.fail(new NotFoundError('settings unavailable')),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo, onError });
    const res = await api.fetch(new Request('http://localhost/collections/posts'));
    expect(res.status).toBe(400);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('calls onError when collection is not found (404) on GET /collections/:key', async () => {
    const onError = vi.fn();
    const repo = {
      getSettings: () => LaikaTask.succeed({ collections: {} }),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo, onError });
    const res = await api.fetch(new Request('http://localhost/collections/missing'));
    expect(res.status).toBe(404);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(NotFoundError);
  });

  it('calls onError when putDocumentCollectionSettings fails on POST /collections', async () => {
    const onError = vi.fn();
    const repo = {
      putDocumentCollectionSettings: () => LaikaTask.fail(new NotFoundError('write failed')),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo, onError });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'new-col',
            attributes: { type: 'document', name: 'New Col' },
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('calls onError when getSettings fails on DELETE /collections/:key', async () => {
    const onError = vi.fn();
    const repo = {
      getSettings: () => LaikaTask.fail(new NotFoundError('settings unavailable')),
    } as unknown as ContentBaseSettingsProvider;

    const api = buildJsonApi({ repo, onError });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
    expect(onError).toHaveBeenCalledOnce();
  });
});
