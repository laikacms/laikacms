import type { StorageContractCase } from 'laikacms/storage/testing';

import type { ContentfulContentType, ContentfulEntry } from '../contentful-datasource.js';
import { ContentfulStorageRepository } from '../contentful-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Contentful Management API mock.
//
// Contentful's data model maps directly to a two-level key space:
//   <contentTypeId>/<entryId>  → object
//   <contentTypeId>            → folder (content type)
//
// The standard contract test keys use multi-segment prefixes
// ("contract-test/list-atoms-.../a") which exceed the two-level limit.
// Those capabilities are skipped; the remaining four (createObject,
// createOrUpdateObject, updateObject, removeAtoms) work fine.
//
// The mock always reports every content type as existing so that
// createObject's "content type must exist" pre-flight passes.
// ---------------------------------------------------------------------------

const SPACE_ID = 'test-space';
const ENV_ID = 'master';
const DEFAULT_LOCALE = 'en-US';
const API_URL = 'https://contentful-mock.test';
const ACCESS_TOKEN = 'test-token';

const now = () => new Date().toISOString();

const stubContentType = (id: string): ContentfulContentType => ({
  sys: {
    id,
    type: 'ContentType',
    version: 1,
    publishedVersion: 1,
    createdAt: now(),
    updatedAt: now(),
  },
  name: id,
  fields: [{ id: 'body', name: 'Body', type: 'Text', required: false, localized: false }],
});

const createMockContentful = () => {
  // entryId → ContentfulEntry
  const entries = new Map<string, ContentfulEntry>();
  // contentTypeId → ContentfulContentType
  const contentTypes = new Map<string, ContentfulContentType>();

  let versionCounter = 1;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const envBase = `/spaces/${SPACE_ID}/environments/${ENV_ID}`;

    // Entries ---------------------------------------------------------------

    // GET /entries/:id
    const getEntry = u.pathname.match(new RegExp(`^${envBase}/entries/([^/]+)$`));
    if (getEntry && method === 'GET') {
      const entryId = decodeURIComponent(getEntry[1]!);
      const entry = entries.get(entryId) ?? null;
      if (!entry) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(entry), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // GET /entries?content_type=...
    if (u.pathname === `${envBase}/entries` && method === 'GET') {
      const ctId = u.searchParams.get('content_type') ?? '';
      const items = [...entries.values()].filter(e => e.sys.contentType.sys.id === ctId);
      return new Response(JSON.stringify({ items, total: items.length }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // PUT /entries/:id  (create or update)
    const putEntry = u.pathname.match(new RegExp(`^${envBase}/entries/([^/]+)$`));
    if (putEntry && method === 'PUT') {
      const entryId = decodeURIComponent(putEntry[1]!);
      const body = JSON.parse((init?.body as string) ?? '{}') as { fields: ContentfulEntry['fields'] };
      const versionHeader = (init?.headers as Record<string, string> | undefined)?.['X-Contentful-Version'];
      const contentTypeHeader = (init?.headers as Record<string, string> | undefined)?.['X-Contentful-Content-Type'];

      const existing = entries.get(entryId);
      if (existing && contentTypeHeader) {
        // It's a create-only call (no version) but entry already exists → 409
        return new Response(JSON.stringify({ message: 'conflict' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }

      const expectedVersion = versionHeader ? Number(versionHeader) : undefined;
      if (existing && expectedVersion !== undefined && existing.sys.version !== expectedVersion) {
        return new Response(JSON.stringify({ message: 'version mismatch' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }

      const ctId = contentTypeHeader ?? existing?.sys.contentType.sys.id ?? 'unknown';
      const newVersion = ++versionCounter;
      const entry: ContentfulEntry = {
        sys: {
          id: entryId,
          type: 'Entry',
          version: newVersion,
          contentType: { sys: { id: ctId } },
          createdAt: existing?.sys.createdAt ?? now(),
          updatedAt: now(),
        },
        fields: body.fields ?? {},
      };
      entries.set(entryId, entry);
      return new Response(JSON.stringify(entry), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    // DELETE /entries/:id
    const delEntry = u.pathname.match(new RegExp(`^${envBase}/entries/([^/]+)$`));
    if (delEntry && method === 'DELETE') {
      const entryId = decodeURIComponent(delEntry[1]!);
      entries.delete(entryId);
      // Use 200 instead of 204 — Node.js 22+ throws for Response({ status: 204 }) with a body.
      return new Response(null, { status: 200 });
    }

    // Content types ---------------------------------------------------------

    // GET /content_types/:id
    const getCt = u.pathname.match(new RegExp(`^${envBase}/content_types/([^/]+)$`));
    if (getCt && method === 'GET') {
      const ctId = decodeURIComponent(getCt[1]!);
      // Always return a stub so createObject's "content type must exist" check passes.
      const ct = contentTypes.get(ctId) ?? stubContentType(ctId);
      return new Response(JSON.stringify(ct), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // PUT /content_types/:id  (create)
    const putCt = u.pathname.match(new RegExp(`^${envBase}/content_types/([^/]+)$`));
    if (putCt && method === 'PUT') {
      const ctId = decodeURIComponent(putCt[1]!);
      const existing = contentTypes.get(ctId);
      if (!existing) {
        const ct = stubContentType(ctId);
        contentTypes.set(ctId, ct);
        return new Response(JSON.stringify(ct), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(existing), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // PUT /content_types/:id/published  (activate)
    const activateCt = u.pathname.match(new RegExp(`^${envBase}/content_types/([^/]+)/published$`));
    if (activateCt && method === 'PUT') {
      const ctId = decodeURIComponent(activateCt[1]!);
      const ct = contentTypes.get(ctId) ?? stubContentType(ctId);
      if (!contentTypes.has(ctId)) contentTypes.set(ctId, ct);
      return new Response(JSON.stringify(ct), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // GET /content_types
    if (u.pathname === `${envBase}/content_types` && method === 'GET') {
      const items = [...contentTypes.values()];
      return new Response(JSON.stringify({ items, total: items.length }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(`mock: unhandled ${method} ${u.pathname}`, { status: 501 });
  };

  return { fetchImpl };
};

export const contentfulContractCase: StorageContractCase = {
  name: 'ContentfulStorageRepository',
  // Contentful's two-level key model (contentTypeId/entryId) is
  // incompatible with the contract test's nested key patterns
  // ("prefix/a", "prefix/b/c"). Skip the capabilities that require
  // nested keys or single-segment folder keys.
  skip: ['createFolder', 'listAtoms', 'listAtomSummaries', 'getAtom'],
  async makeRepo() {
    const { fetchImpl } = createMockContentful();
    return new ContentfulStorageRepository({
      spaceId: SPACE_ID,
      environmentId: ENV_ID,
      defaultLocale: DEFAULT_LOCALE,
      auth: { accessToken: ACCESS_TOKEN },
      apiUrl: API_URL,
      fetch: fetchImpl,
    });
  },
};
