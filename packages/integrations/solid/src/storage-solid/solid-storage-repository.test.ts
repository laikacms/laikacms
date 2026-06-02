import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SolidDataSource } from './solid-datasource.js';
import { SolidStorageRepository } from './solid-storage-repository.js';
import { solidContractCase } from './testing/index.js';
import { parseTurtle, resolveIri, serializeTurtle, type TurtleTriple } from './turtle.js';

runStorageRepositoryContract(solidContractCase);

// ---------------------------------------------------------------------------
// In-memory Solid Pod / LDP mock.
//
// Implements the LDP semantics the repository relies on:
//
//   - PUT  <url>           — create/replace a resource (file)
//   - PUT  <url/> (Content-Type: text/turtle) — create a container
//   - GET  <url>           — fetch a resource (content negotiated)
//   - GET  <url/> (Accept: text/turtle) — return container Turtle
//                            listing the children via `ldp:contains`
//   - HEAD <url>           — existence probe
//   - DELETE <url>         — remove
//
// Files are tracked in `resources`; containers (folders) in `containers`.
// The container listing endpoint emits real Turtle so the repository's
// parser is exercised on the wire.
// ---------------------------------------------------------------------------

const POD_ROOT = 'https://alice.pod.test/laika/';
const TOKEN = 'solid_test_token';

interface Resource {
  url: string;
  content: string;
  contentType: string;
  etag: string;
}

let resources: Map<string, Resource>;
let containers: Set<string>; // every URL of a container; always ends in `/`
let putCount: number;
let deleteCount: number;
let containerGetCount: number;
let lastListingTurtle: string | null = null;

// Provision the pod root container.
const installRoot = () => {
  containers.add(POD_ROOT);
};

const nextEtag = (() => {
  let n = 0;
  return () => {
    n += 1;
    return `"${n.toString(16).padStart(8, '0')}"`;
  };
})();

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

  // ---- HEAD --------------------------------------------------------------
  if (method === 'HEAD') {
    if (containers.has(url) || resources.has(url)) {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  }

  // ---- DELETE ------------------------------------------------------------
  if (method === 'DELETE') {
    deleteCount += 1;
    if (resources.delete(url)) return new Response(null, { status: 204 });
    if (containers.delete(url)) return new Response(null, { status: 204 });
    return new Response('not found', { status: 404 });
  }

  // ---- PUT ---------------------------------------------------------------
  if (method === 'PUT') {
    putCount += 1;
    const ct = (init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? '';
    const ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
    const body = init?.body as string ?? '';

    // Container declaration: PUT <url/> with Content-Type: text/turtle.
    if (url.endsWith('/') && ct.startsWith('text/turtle')) {
      if (containers.has(url) && ifNoneMatch === '*') {
        return new Response('exists', { status: 412 });
      }
      containers.add(url);
      return new Response(null, { status: 201 });
    }
    // Resource creation / overwrite.
    if (resources.has(url) && ifNoneMatch === '*') {
      return new Response('exists', { status: 412 });
    }
    resources.set(url, { url, content: body, contentType: ct, etag: nextEtag() });
    return new Response(null, { status: 201, headers: { etag: nextEtag() } });
  }

  // ---- GET ---------------------------------------------------------------
  if (method === 'GET') {
    const accept = (init?.headers as Record<string, string> | undefined)?.['Accept'] ?? '*/*';

    // Container listing.
    if (url.endsWith('/') && containers.has(url)) {
      if (!accept.includes('text/turtle') && accept !== '*/*') {
        // Other Accept types — fall through; for our purposes we always serve Turtle.
      }
      containerGetCount += 1;
      // Build triples: <> a ldp:BasicContainer, ldp:Container; ldp:contains <child1>, <child2>...
      const childTriples: TurtleTriple[] = [];
      const containerSubject = url;
      childTriples.push({
        subject: containerSubject,
        predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        object: 'http://www.w3.org/ns/ldp#BasicContainer',
      });
      childTriples.push({
        subject: containerSubject,
        predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        object: 'http://www.w3.org/ns/ldp#Container',
      });

      // Immediate children: resources whose URL = `url + <name>` (no further `/`)
      // and containers whose URL = `url + <name>/`.
      for (const r of resources.values()) {
        if (!r.url.startsWith(url)) continue;
        const tail = r.url.slice(url.length);
        if (tail === '' || tail.includes('/')) continue;
        childTriples.push({
          subject: containerSubject,
          predicate: 'http://www.w3.org/ns/ldp#contains',
          object: r.url,
        });
        childTriples.push({
          subject: r.url,
          predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
          object: 'http://www.w3.org/ns/ldp#Resource',
        });
      }
      for (const c of containers) {
        if (c === url || !c.startsWith(url)) continue;
        const tail = c.slice(url.length);
        // Direct children only — tail has exactly one trailing slash and no internal slashes.
        if (tail === '' || tail.slice(0, -1).includes('/')) continue;
        childTriples.push({
          subject: containerSubject,
          predicate: 'http://www.w3.org/ns/ldp#contains',
          object: c,
        });
        childTriples.push({
          subject: c,
          predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
          object: 'http://www.w3.org/ns/ldp#BasicContainer',
        });
      }
      const ttl = serializeTurtle(childTriples, { baseIri: url });
      lastListingTurtle = ttl;
      return new Response(ttl, {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      });
    }

    // Regular resource fetch.
    const resource = resources.get(url);
    if (!resource) return new Response('not found', { status: 404 });
    return new Response(resource.content, {
      status: 200,
      headers: { 'content-type': resource.contentType, etag: resource.etag },
    });
  }

  return new Response('method not allowed', { status: 405 });
};

// ---------------------------------------------------------------------------
// Serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) => String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (fetchImpl: typeof fetch = mockFetch): SolidStorageRepository => {
  const ds = new SolidDataSource({
    podRoot: POD_ROOT,
    auth: { accessToken: TOKEN },
    fetch: fetchImpl,
  });
  return new SolidStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  resources = new Map();
  containers = new Set();
  installRoot();
  putCount = 0;
  deleteCount = 0;
  containerGetCount = 0;
  lastListingTurtle = null;
});

afterEach(() => {
  resources.clear();
  containers.clear();
});

// ---------------------------------------------------------------------------
// Turtle parser/helpers — unit tests
// ---------------------------------------------------------------------------

describe('Turtle parser', () => {
  it('extracts ldp:contains triples and rdf:type discriminators', () => {
    const ttl = `
      @prefix ldp: <http://www.w3.org/ns/ldp#>.
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.

      <> a ldp:BasicContainer, ldp:Container;
         ldp:contains <hello.md>, <notes/>.

      <hello.md> a ldp:Resource.
      <notes/>   a ldp:BasicContainer.
    `;
    const triples = parseTurtle(ttl, 'https://alice.pod.test/laika/');
    const contains = triples
      .filter(t => t.predicate === 'http://www.w3.org/ns/ldp#contains')
      .map(t => t.object);
    expect(contains).toContain('https://alice.pod.test/laika/hello.md');
    expect(contains).toContain('https://alice.pod.test/laika/notes/');
  });

  it('uses the `a` keyword as shorthand for rdf:type', () => {
    const ttl = `<x> a <Type>.`;
    const triples = parseTurtle(ttl, 'https://example.com/');
    expect(triples).toHaveLength(1);
    expect(triples[0]?.predicate).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
    expect(triples[0]?.object).toBe('https://example.com/Type');
  });

  it('resolves relative IRIs against a base', () => {
    expect(resolveIri('https://a.test/laika/', 'foo.md'))
      .toBe('https://a.test/laika/foo.md');
    expect(resolveIri('https://a.test/laika/x/', '../y/z'))
      .toBe('https://a.test/laika/x/../y/z'); // unresolved `..` is fine for LDP needs
    expect(resolveIri('https://a.test/laika/', '/abs/path'))
      .toBe('https://a.test/abs/path');
    expect(resolveIri('https://a.test/laika/', 'https://other/x'))
      .toBe('https://other/x');
  });

  it('round-trips through serializeTurtle + parseTurtle', () => {
    const triples: TurtleTriple[] = [
      { subject: 'https://x.test/a/', predicate: 'http://www.w3.org/ns/ldp#contains', object: 'https://x.test/a/foo' },
      {
        subject: 'https://x.test/a/foo',
        predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        object: 'http://www.w3.org/ns/ldp#Resource',
      },
    ];
    const ttl = serializeTurtle(triples, { baseIri: 'https://x.test/a/' });
    const reparsed = parseTurtle(ttl, 'https://x.test/a/');
    expect(reparsed).toHaveLength(2);
    const contains = reparsed.find(t => t.predicate === 'http://www.w3.org/ns/ldp#contains');
    expect(contains?.object).toBe('https://x.test/a/foo');
  });
});

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('SolidStorageRepository', () => {
  it('createObject + getObject round-trip stores resource at URL with the right Content-Type', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');

    const stored = resources.get(`${POD_ROOT}notes/hello.md`);
    expect(stored).toBeDefined();
    expect(stored?.content).toBe('hi');
    expect(stored?.contentType).toBe('text/markdown');

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('createObject auto-creates ancestor containers (LDP requires parent containers)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c/deep', content: { body: 'x' } }),
    );
    expect(containers.has(`${POD_ROOT}a/`)).toBe(true);
    expect(containers.has(`${POD_ROOT}a/b/`)).toBe(true);
    expect(containers.has(`${POD_ROOT}a/b/c/`)).toBe(true);
    expect(resources.has(`${POD_ROOT}a/b/c/deep.md`)).toBe(true);
  });

  it('createObject uses If-None-Match: * for create-only semantics', async () => {
    // Sniff the PUT headers.
    let lastPutHeaders: Record<string, string> | null = null;
    const sniff: typeof fetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        lastPutHeaders = (init?.headers as Record<string, string>) ?? null;
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // The PUT for the FILE itself uses If-None-Match: * (container PUTs may or may not).
    // Find the most recent PUT to a resource URL (no trailing /).
    expect(lastPutHeaders?.['If-None-Match']).toBe('*');
  });

  it('createObject rejects duplicates via HTTP 412 → EntryAlreadyExistsError', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('updateObject overwrites in place (no If-None-Match)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(resources.get(`${POD_ROOT}notes/x.md`)?.content).toBe('b');
  });

  it('listAtomSummaries GETs Turtle from the container and parses ldp:contains', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes/sub' }));

    containerGetCount = 0;
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    expect(containerGetCount).toBe(1);

    // The Turtle response was parsed — assert the relevant predicate appears.
    expect(lastListingTurtle).toContain('ldp:contains');

    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
  });

  it('removeAtoms does N parallel DELETEs (no LDP bulk primitive — documented)', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    deleteCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // Honest: 3 separate DELETEs — LDP has no native bulk endpoint.
    expect(deleteCount).toBe(3);
    expect(resources.size).toBe(0);
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('createFolder creates an LDP basic container at <url/>', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect(containers.has(`${POD_ROOT}empty/`)).toBe(true);
    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('createFolder is idempotent (412 swallowed via existence probe)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    putCount = 0;
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    // The second call HEAD-probes and finds the container exists, so no PUT.
    expect(putCount).toBe(0);
  });

  it('getFolder fails for a missing container', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('container URLs end in `/`; resource URLs do not (LDP convention)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    // Resource: no trailing slash, stored in `resources`.
    expect(resources.has(`${POD_ROOT}notes/hello.md`)).toBe(true);
    expect(containers.has(`${POD_ROOT}notes/hello.md`)).toBe(false);
    // Container: trailing slash, stored in `containers`.
    expect(containers.has(`${POD_ROOT}notes/`)).toBe(true);
    expect(resources.has(`${POD_ROOT}notes/`)).toBe(false);
  });
});
