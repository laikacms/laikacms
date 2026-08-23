/**
 * The served API against real repositories.
 *
 * The unit tests in `api-access.test.ts` check the policy in isolation; these
 * check that it actually holds over HTTP, which is the only form that matters
 * if the route is reachable from the internet.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runTask } from 'laikacms/compat';

import { createApiHandler } from './api-handler.js';
import { type LaikaRepositories, resolveRepositories } from './repositories.js';

const BASE = '/api/laika';
const tempDirs: string[] = [];

let repositories: LaikaRepositories;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-astro-api-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'posts'), { recursive: true });
  repositories = resolveRepositories({ dir: '.', defaultExtension: 'md' }, dir);

  await runTask(repositories.documents.createDocument({
    key: 'posts/live',
    content: { title: 'Live', body: 'Published.' },
    language: 'en',
  }));
  await runTask(repositories.documents.createUnpublished({
    key: 'posts/secret',
    content: { title: 'Secret draft', body: 'Not for the public.' },
    language: 'en',
    status: 'draft',
  }));
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

const call = (
  access: Parameters<typeof createApiHandler>[0]['access'],
  url: string,
  init?: RequestInit,
) =>
  createApiHandler({ repositories, basePath: BASE, access })(
    new Request(`https://example.com${url}`, init),
  );

describe('the default published access', () => {
  it('serves a published document', async () => {
    const response = await call(undefined, `${BASE}/documents/published/posts%2Flive`);

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { attributes: { content: { title: string } } } };
    expect(body.data.attributes.content.title).toBe('Live');
  });

  it('does not serve a draft', async () => {
    const response = await call(undefined, `${BASE}/documents/unpublished/posts%2Fsecret`);

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Not for the public');
  });

  it('does not leak drafts through a listing filter', async () => {
    const response = await call(
      undefined,
      `${BASE}/documents/record-summaries?filter%5Btype%5D=unpublished&filter%5Bfolder%5D=posts`,
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('secret');
  });

  it('does not leak drafts through filter[type]=all', async () => {
    const response = await call(
      undefined,
      `${BASE}/documents/record-summaries?filter%5Btype%5D=all&filter%5Bfolder%5D=posts`,
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('secret');
  });

  it('lists published documents', async () => {
    const response = await call(
      undefined,
      `${BASE}/documents/record-summaries?filter%5Bfolder%5D=posts`,
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('posts/live');
    expect(text).not.toContain('secret');
  });

  it('refuses to create a document', async () => {
    const response = await call(undefined, `${BASE}/documents/published`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({
        data: { type: 'published', id: 'posts/intruder', attributes: { content: { title: 'No' } } },
      }),
    });

    expect(response.status).toBe(403);
    // And nothing was written.
    await expect(runTask(repositories.documents.getDocument('posts/intruder'))).rejects.toThrow();
  });

  it('refuses to delete a document', async () => {
    const response = await call(undefined, `${BASE}/documents/published/posts%2Flive`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(403);
    await expect(runTask(repositories.documents.getDocument('posts/live'))).resolves.toBeDefined();
  });

  it('refuses to write through the storage route', async () => {
    const response = await call(undefined, `${BASE}/storage/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({ data: { type: 'object', id: 'posts/x', attributes: { content: {} } } }),
    });

    expect(response.status).toBe(403);
  });
});

describe('read access', () => {
  it('serves a draft, for a preview deployment behind your own auth', async () => {
    const response = await call('read', `${BASE}/documents/unpublished/posts%2Fsecret`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Secret draft');
  });

  it('still refuses writes', async () => {
    const response = await call('read', `${BASE}/documents/published/posts%2Flive`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(403);
  });
});

describe('routing', () => {
  it('answers 404 for a path outside the mounted sub-APIs', async () => {
    const response = await call(undefined, `${BASE}/nope`);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('documents');
  });

  it('serves storage reads', async () => {
    const response = await call(undefined, `${BASE}/storage/objects/posts%2Flive`);

    expect(response.status).toBe(200);
  });
});
