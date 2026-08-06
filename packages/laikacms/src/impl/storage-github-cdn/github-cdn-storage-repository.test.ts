import { describe, expect, it } from 'vitest';

import { LaikaStream, LaikaTask, NotFoundError, NotImplementedError } from 'laikacms/core';

import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import { GithubCdnStorageRepository } from './github-cdn-storage-repository.js';

const OWNER = 'acme';
const REPO = 'docs';
const DATA_API_BASE = 'https://data.jsdelivr.test/v1/packages/gh';
const CDN_BASE = 'https://cdn.jsdelivr.test/gh';

const TREE_FILES = [
  {
    type: 'directory',
    name: 'posts',
    files: [
      { type: 'file', name: 'hello.json', hash: 'sha-hello' },
      {
        type: 'directory',
        name: 'sub',
        files: [{ type: 'file', name: 'nested.json', hash: 'sha-nested' }],
      },
      { type: 'file', name: '.keep', hash: 'sha-keep' },
    ],
  },
  { type: 'file', name: 'readme.json', hash: 'sha-readme' },
];

const FILE_BODIES: Record<string, string> = {
  'posts/hello.json': JSON.stringify({ title: 'Hello' }),
  'posts/sub/nested.json': JSON.stringify({ title: 'Nested' }),
  'readme.json': JSON.stringify({ title: 'Readme' }),
  'posts/.keep': '',
};

/** Builds a fetch stub serving a canned jsDelivr tree + per-path file bodies. */
const makeFakeFetch = (bodies: Record<string, string> = FILE_BODIES) => {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (url.toString().startsWith(DATA_API_BASE)) {
      return new Response(JSON.stringify({ files: TREE_FILES }), { status: 200 });
    }

    if (url.toString().startsWith(CDN_BASE)) {
      const path = decodeURIComponent(url.pathname.split('@HEAD/')[1] ?? '');
      const body = bodies[path];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200 });
    }

    throw new Error(`Unexpected fetch to ${url.toString()}`);
  };

  return { fetchImpl, calls };
};

const makeRepo = (bodies?: Record<string, string>) => {
  const { fetchImpl, calls } = makeFakeFetch(bodies);
  const repo = new GithubCdnStorageRepository({
    owner: OWNER,
    repo: REPO,
    cdnBaseUrl: CDN_BASE,
    dataApiBaseUrl: DATA_API_BASE,
    fetch: fetchImpl,
    serializerRegistry: { json: jsonSerializer },
  });
  return { repo, calls };
};

describe('GithubCdnStorageRepository.getObject', () => {
  it('resolves the extension via the serializer registry and returns deserialized content', async () => {
    const { repo } = makeRepo();
    const obj = await LaikaTask.runPromise(repo.getObject('posts/hello'));
    expect(obj.key).toBe('posts/hello');
    expect(obj.content).toEqual({ title: 'Hello' });
    expect(obj.metadata).toMatchObject({ extension: 'json', revisionId: 'sha-hello' });
  });

  it('fails with NotFoundError when no candidate extension matches', async () => {
    const { repo } = makeRepo();
    await expect(LaikaTask.runPromise(repo.getObject('posts/missing'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fails when the CDN response body cannot be deserialized by the matched serializer', async () => {
    const { repo } = makeRepo({ ...FILE_BODIES, 'posts/hello.json': 'not valid json' });
    await expect(LaikaTask.runPromise(repo.getObject('posts/hello'))).rejects.toThrow();
  });
});

describe('GithubCdnStorageRepository.getFolder', () => {
  it('returns a Folder for an existing directory with epoch(0) timestamps', async () => {
    const { repo } = makeRepo();
    const folder = await LaikaTask.runPromise(repo.getFolder('posts'));
    expect(folder.key).toBe('posts');
    expect(folder.type).toBe('folder');
    expect(folder.createdAt).toBe(new Date(0).toISOString());
  });
});

describe('GithubCdnStorageRepository.getAtom', () => {
  it('resolves a file path to a StorageObject', async () => {
    const { repo } = makeRepo();
    const atom = await LaikaTask.runPromise(repo.getAtom('posts/hello'));
    expect(atom.type).toBe('object');
    expect(atom.key).toBe('posts/hello');
  });

  it('resolves a directory path to a Folder', async () => {
    const { repo } = makeRepo();
    const atom = await LaikaTask.runPromise(repo.getAtom('posts'));
    expect(atom.type).toBe('folder');
    expect(atom.key).toBe('posts');
  });

  it('falls back to getObject when pathType lookup fails', async () => {
    const { repo } = makeRepo();
    const atom = await LaikaTask.runPromise(repo.getAtom('readme'));
    expect(atom.type).toBe('object');
    expect(atom.key).toBe('readme');
  });
});

describe('GithubCdnStorageRepository.listAtoms / listAtomSummaries', () => {
  it('lists atoms at depth 1, excluding ignoreList entries like .keep', async () => {
    const { repo } = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtoms('posts', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    const keys = collected.data.map(a => a.key).sort();
    expect(keys).toEqual(['posts/hello', 'posts/sub']);
    expect(collected.done.total).toBe(2);
  });

  it('lists nested atoms at depth 2', async () => {
    const { repo } = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtoms('posts', { depth: 2, pagination: { offset: 0, limit: 100 } }),
    );
    const keys = collected.data.map(a => a.key).sort();
    expect(keys).toContain('posts/sub/nested');
  });

  it('listAtomSummaries returns summaries without fetching object content', async () => {
    const { repo, calls } = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('posts', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    const keys = collected.data.map(s => s.key).sort();
    expect(keys).toEqual(['posts/hello', 'posts/sub']);
    // Summaries shouldn't need to fetch file content, only the (cached) tree.
    expect(calls.some(c => c.includes('posts/hello.json') && c.startsWith(CDN_BASE))).toBe(false);
  });

  it('applies pagination to listAtoms while keeping done.total as the full count', async () => {
    const { repo } = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtoms('posts', { depth: 1, pagination: { offset: 0, limit: 1 } }),
    );
    expect(collected.data).toHaveLength(1);
    expect(collected.done.total).toBe(2);
  });
});

describe('GithubCdnStorageRepository.getCapabilities', () => {
  it('reports read-only pagination support and the configured serializer extensions', async () => {
    const { repo } = makeRepo();
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(caps.pagination.supported).toBe(true);
    expect(caps.pagination.styles.cursor).toBe(false);
    expect(caps.fileExtensions.supportedExtensions).toHaveProperty('json');
  });
});

describe('GithubCdnStorageRepository mutations', () => {
  it('createObject fails with NotImplementedError (read-only CDN backend)', async () => {
    const { repo } = makeRepo();
    await expect(
      LaikaTask.runPromise(repo.createObject({ key: 'x', type: 'object', content: {} })),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('updateObject fails with NotImplementedError', async () => {
    const { repo } = makeRepo();
    await expect(
      LaikaTask.runPromise(repo.updateObject({ key: 'x', content: {} })),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('createFolder fails with NotImplementedError', async () => {
    const { repo } = makeRepo();
    await expect(
      LaikaTask.runPromise(repo.createFolder({ key: 'x', type: 'folder' })),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('removeAtoms fails with NotImplementedError', async () => {
    const { repo } = makeRepo();
    await expect(
      LaikaStream.runPromiseCollect(repo.removeAtoms(['x'])),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
