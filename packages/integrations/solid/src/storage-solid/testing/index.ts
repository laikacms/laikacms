import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { SolidDataSource } from '../solid-datasource.js';
import { SolidStorageRepository } from '../solid-storage-repository.js';
import { serializeTurtle, type TurtleTriple } from '../turtle.js';

const POD_ROOT = 'https://alice.pod.test/laika/';
const TOKEN = 'solid_test_token';

interface Resource {
  url: string;
  content: string;
  contentType: string;
  etag: string;
}

const createMockSolid = () => {
  const resources = new Map<string, Resource>();
  const containers = new Set<string>();
  containers.add(POD_ROOT);

  let etagCounter = 0;
  const nextEtag = (): string => `"${(++etagCounter).toString(16).padStart(8, '0')}"`;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

    if (method === 'HEAD') {
      if (containers.has(url) || resources.has(url)) return new Response(null, { status: 200 });
      return new Response(null, { status: 404 });
    }

    if (method === 'DELETE') {
      if (resources.delete(url)) return new Response(null, { status: 204 });
      if (containers.delete(url)) return new Response(null, { status: 204 });
      return new Response('not found', { status: 404 });
    }

    if (method === 'PUT') {
      const ct = (init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? '';
      const ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
      const body = init?.body as string ?? '';

      if (url.endsWith('/') && ct.startsWith('text/turtle')) {
        if (containers.has(url) && ifNoneMatch === '*') return new Response('exists', { status: 412 });
        containers.add(url);
        return new Response(null, { status: 201 });
      }
      if (resources.has(url) && ifNoneMatch === '*') return new Response('exists', { status: 412 });
      resources.set(url, { url, content: body, contentType: ct, etag: nextEtag() });
      return new Response(null, { status: 201, headers: { etag: nextEtag() } });
    }

    if (method === 'GET') {
      if (url.endsWith('/') && containers.has(url)) {
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
          if (tail === '' || tail.slice(0, -1).includes('/')) continue;
          childTriples.push({ subject: containerSubject, predicate: 'http://www.w3.org/ns/ldp#contains', object: c });
          childTriples.push({
            subject: c,
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://www.w3.org/ns/ldp#BasicContainer',
          });
        }
        const ttl = serializeTurtle(childTriples, { baseIri: url });
        return new Response(ttl, { status: 200, headers: { 'content-type': 'text/turtle' } });
      }
      const resource = resources.get(url);
      if (!resource) return new Response('not found', { status: 404 });
      return new Response(resource.content, {
        status: 200,
        headers: { 'content-type': resource.contentType, etag: resource.etag },
      });
    }

    return new Response('method not allowed', { status: 405 });
  };

  return { resources, containers, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const solidContractCase: StorageContractCase = {
  name: 'SolidStorageRepository',
  async makeRepo() {
    const mock = createMockSolid();
    const ds = new SolidDataSource({
      podRoot: POD_ROOT,
      auth: { accessToken: TOKEN },
      fetch: mock.fetch,
    });
    return new SolidStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
  skip: ['createFolder'],
};
