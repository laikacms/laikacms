import type { JSONSchema7 } from 'json-schema';
import { beforeEach, describe, expect, it } from 'vitest';

// The exact zod Astro ships, so validation is tested against what
// `astro:content` would hand a real project.
import * as zod from 'astro/zod';
import type { CatalogProvider } from 'laikacms/catalog';
import { runTask } from 'laikacms/compat';
import { LaikaTask } from 'laikacms/core';
import { ForbiddenError, LaikaError, NotFoundError, ValidationError } from 'laikacms/core/errors';
import { DocumentsRepository } from 'laikacms/documents';
import { InMemoryDocumentsRepository } from 'laikacms/documents/testing';

import type { ZodNamespace } from './json-schema-to-zod.js';
import { liveDocumentsLoader } from './live-loader.js';

const z = zod.z as unknown as ZodNamespace;

let documents: InMemoryDocumentsRepository;

beforeEach(async () => {
  documents = new InMemoryDocumentsRepository();
  await runTask(documents.createDocument({
    key: 'posts/hello',
    content: { title: 'Hello', body: '# Hello' },
    language: 'en',
  }));
  await runTask(documents.createUnpublished({
    key: 'posts/wip',
    content: { title: 'Work in progress', body: '# Draft' },
    language: 'en',
    status: 'draft',
  }));
});

const loader = (overrides: Record<string, unknown> = {}) => liveDocumentsLoader({ documents, ...overrides } as never);

describe('loadEntry', () => {
  it('reads a published document by its Astro id', async () => {
    const result = await loader().loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect(result).toMatchObject({ id: 'hello', data: { title: 'Hello' } });
  });

  it('reads by the full Laika key too', async () => {
    const result = await loader().loadEntry({ filter: { key: 'posts/hello' }, collection: 'posts' });

    expect(result).toMatchObject({ id: 'hello' });
  });

  it('keeps the body out of data, matching the build-time loader', async () => {
    const result = await loader().loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect(result).toMatchObject({ data: { title: 'Hello' } });
    expect((result as { data: Record<string, unknown> }).data).not.toHaveProperty('body');
  });

  it('reads an unpublished document — this is what makes preview possible', async () => {
    const result = await loader().loadEntry({
      filter: { id: 'wip', type: 'unpublished' },
      collection: 'posts',
    });

    expect(result).toMatchObject({ id: 'wip', data: { title: 'Work in progress' } });
  });

  it('does not hand back a different status than the one asked for', async () => {
    const result = await loader().loadEntry({
      filter: { id: 'wip', type: 'unpublished', status: 'pending_review' },
      collection: 'posts',
    });

    expect(result).toBeUndefined();
  });

  it('resolves to undefined for a missing entry, so Astro raises its own not-found error', async () => {
    const result = await loader().loadEntry({ filter: { id: 'nope' }, collection: 'posts' });

    expect(result).toBeUndefined();
  });

  it('reports a missing identifier rather than guessing one', async () => {
    const result = await loader().loadEntry({ filter: {}, collection: 'posts' });

    expect(result).toHaveProperty('error');
    expect((result as { error: Error }).error).toMatchObject({ code: 'bad_request' });
  });

  describe('errors other than not-found', () => {
    class FailingRepository extends InMemoryDocumentsRepository {
      override getDocument(): never {
        throw new ForbiddenError('Nope.');
      }
    }

    it('are returned, not thrown, so the code survives to the page', async () => {
      const result = await liveDocumentsLoader({
        documents: new FailingRepository() as unknown as DocumentsRepository,
      }).loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

      // Astro wraps a *thrown* error in an opaque LiveCollectionError, which
      // would erase `.code`. Returning it keeps the page able to branch on it.
      expect((result as { error: Error }).error).toMatchObject({
        code: 'forbidden',
        status: 403,
      });
    });

    it('wrap a non-Laika throw so the declared error type stays true', async () => {
      class Exploding extends InMemoryDocumentsRepository {
        override getDocument(): never {
          throw new TypeError('kaboom');
        }
      }

      const result = await liveDocumentsLoader({
        documents: new Exploding() as unknown as DocumentsRepository,
      }).loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

      expect((result as { error: Error }).error).toMatchObject({ code: 'internal_error' });
      expect((result as { error: Error & { cause?: unknown } }).error.cause)
        .toBeInstanceOf(TypeError);
    });
  });
});

describe('rendering', () => {
  it('is off by default, so no markdown parser is pulled into the server bundle', async () => {
    const result = await loader().loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect(result).not.toHaveProperty('rendered');
  });

  it('uses the injected renderer when asked', async () => {
    const result = await loader({
      render: { mode: 'markdown', markdown: async (body: string) => `<h1>${body}</h1>` },
    }).loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect(result).toMatchObject({ rendered: { html: '<h1># Hello</h1>' } });
  });

  it('stays silent rather than throwing when mode is markdown but no renderer was given', async () => {
    const result = await loader({ render: { mode: 'markdown' } })
      .loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect(result).not.toHaveProperty('rendered');
    expect(result).toMatchObject({ id: 'hello' });
  });
});

describe('cache hints', () => {
  it('tag an entry by collection and key, so a purge can target one document', async () => {
    const result = await loader().loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect((result as { cacheHint: { tags: string[] } }).cacheHint.tags)
      .toEqual(['laika', 'laika:posts', 'laika:posts/hello']);
  });

  it('carry lastModified so a CDN can revalidate', async () => {
    const result = await loader().loadEntry({ filter: { id: 'hello' }, collection: 'posts' });
    const hint = (result as { cacheHint: { lastModified?: Date } }).cacheHint;

    expect(hint.lastModified).toBeInstanceOf(Date);
    expect(Number.isNaN(hint.lastModified!.getTime())).toBe(false);
  });

  it('honour a custom tag function', async () => {
    const result = await loader({ cache: { tags: ({ key }: { key: string }) => [`custom:${key}`] } })
      .loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect((result as { cacheHint: { tags: string[] } }).cacheHint.tags)
      .toEqual(['custom:posts/hello']);
  });

  it('omit lastModified when switched off', async () => {
    const result = await loader({ cache: { lastModified: false } })
      .loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect((result as { cacheHint: { lastModified?: Date } }).cacheHint.lastModified)
      .toBeUndefined();
  });
});

describe('loadCollection', () => {
  it('returns the published documents', async () => {
    const result = await loader().loadCollection({ collection: 'posts' });

    expect((result as { entries: Array<{ id: string }> }).entries.map(entry => entry.id))
      .toEqual(['hello']);
  });

  it('returns unpublished documents when asked, for a draft index', async () => {
    const result = await loader().loadCollection({
      filter: { type: 'unpublished' },
      collection: 'posts',
    });

    expect((result as { entries: Array<{ id: string }> }).entries.map(entry => entry.id))
      .toEqual(['wip']);
  });

  it('lets a per-call filter override the configured default', async () => {
    const result = await loader({ select: { type: 'unpublished' } })
      .loadCollection({ filter: { type: 'published' }, collection: 'posts' });

    expect((result as { entries: Array<{ id: string }> }).entries.map(entry => entry.id))
      .toEqual(['hello']);
  });

  it('filters by language', async () => {
    const result = await loader().loadCollection({
      filter: { language: 'fr' },
      collection: 'posts',
    });

    expect((result as { entries: unknown[] }).entries).toEqual([]);
  });

  it('tags the collection so a whole-collection purge is possible', async () => {
    const result = await loader().loadCollection({ collection: 'posts' });

    expect((result as { cacheHint: { tags: string[] } }).cacheHint.tags)
      .toEqual(['laika', 'laika:posts']);
  });
});

describe('validate', () => {
  /** A catalog stub that answers exactly one collection. */
  const catalogWith = (schema: JSONSchema7 | undefined, error?: LaikaError): CatalogProvider =>
    ({
      getCollectionSchema: (collection: string) => {
        calls.push(collection);
        if (error !== undefined) return LaikaTask.fail(error);
        return LaikaTask.succeed(schema!);
      },
    }) as unknown as CatalogProvider;

  let calls: string[];
  beforeEach(() => {
    calls = [];
  });

  const POSTS_SCHEMA: JSONSchema7 = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      publishedAt: { type: 'string', format: 'date-time' },
      body: { type: 'string' },
    },
    required: ['title'],
  };

  it('is off by default — an entry the catalog would reject still loads', async () => {
    await runTask(documents.createDocument({
      key: 'posts/bad',
      content: { title: 42 },
      language: 'en',
    }));

    const result = await loader().loadEntry({ filter: { id: 'bad' }, collection: 'posts' });

    expect(result).toMatchObject({ data: { title: 42 } });
  });

  it('rejects an entry that does not match, as a ValidationError on the result', async () => {
    await runTask(documents.createDocument({
      key: 'posts/bad',
      content: { title: 42 },
      language: 'en',
    }));

    const result = await loader({ validate: { catalog: catalogWith(POSTS_SCHEMA), z } })
      .loadEntry({ filter: { id: 'bad' }, collection: 'posts' });

    // Returned, not thrown: Astro erases a thrown error's code, and a page
    // branches on `error.code`.
    const error = (result as { error: LaikaError }).error;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe(ValidationError.CODE);
  });

  it('lets a matching entry through, coerced', async () => {
    await runTask(documents.createDocument({
      key: 'posts/good',
      content: { title: 'Hi', publishedAt: '2026-01-01T00:00:00Z' },
      language: 'en',
    }));

    const result = await loader({ validate: { catalog: catalogWith(POSTS_SCHEMA), z } })
      .loadEntry({ filter: { id: 'good' }, collection: 'posts' });

    const data = (result as { data: Record<string, unknown> }).data;
    expect(data['title']).toBe('Hi');
    // The Zod coercion is what makes the generated `Date` half of the live
    // types true when validation is on.
    expect(data['publishedAt']).toBeInstanceOf(Date);
  });

  it('derives the schema once, not once per request', async () => {
    const live = loader({ validate: { catalog: catalogWith(POSTS_SCHEMA), z } });

    await live.loadEntry({ filter: { id: 'hello' }, collection: 'posts' });
    await live.loadEntry({ filter: { id: 'hello' }, collection: 'posts' });
    await live.loadCollection({ collection: 'posts' });

    expect(calls).toEqual(['posts']);
  });

  it('reports an unreadable catalog as a failure, not as a missing entry', async () => {
    // NotFoundError is the shape `loadEntry` turns into `undefined`. A catalog
    // that is missing must not be reported as a document that is missing.
    const live = loader({
      validate: {
        catalog: catalogWith(undefined, new NotFoundError('no config.yml')),
        z,
      },
    });

    const result = await live.loadEntry({ filter: { id: 'hello' }, collection: 'posts' });

    expect(result).not.toBeUndefined();
    expect((result as { error: LaikaError }).error.message).toContain('validate is on');
  });

  it('retries a catalog read that failed, rather than staying unvalidated', async () => {
    let attempts = 0;
    const flaky = {
      getCollectionSchema: () => {
        attempts += 1;
        return attempts === 1
          ? LaikaTask.fail(new NotFoundError('transient'))
          : LaikaTask.succeed(POSTS_SCHEMA);
      },
    } as unknown as CatalogProvider;

    const live = loader({ validate: { catalog: flaky, z } });

    expect(
      (await live.loadEntry({ filter: { id: 'hello' }, collection: 'posts' }) as {
        error?: LaikaError,
      }).error,
    ).toBeDefined();
    expect(
      (await live.loadEntry({ filter: { id: 'hello' }, collection: 'posts' }) as {
        error?: LaikaError,
      }).error,
    ).toBeUndefined();
    expect(attempts).toBe(2);
  });
});
