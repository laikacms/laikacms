import type { StorageContractCase } from 'laikacms/storage/testing';

import { type FirestoreFields, toFirestoreFields } from '../firestore-datasource.js';
import { FirestoreStorageRepository } from '../firestore-storage-repository.js';

// ---------------------------------------------------------------------------
// Minimal in-memory Firestore mock. Handles the alternating
// collection/document path scheme the repository emits.
// ---------------------------------------------------------------------------

const PROJECT = 'contract-test-project';
const DB = '(default)';
const API_URL = 'https://mock.firestore.contract/v1';

interface StoredDoc {
  fields: FirestoreFields;
  createTime: string;
  updateTime: string;
}

const createMockFirestore = () => {
  const docs = new Map<string, StoredDoc>();

  const fullName = (path: string) => `projects/${PROJECT}/databases/${DB}/documents/${path}`;

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const stripPrefix = (pathname: string): string | null => {
    const prefix = `/v1/projects/${PROJECT}/databases/${encodeURIComponent(DB)}/documents/`;
    if (!pathname.startsWith(prefix)) return null;
    return pathname.slice(prefix.length);
  };

  const isCollectionPath = (path: string): boolean => path.split('/').length % 2 === 1;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = stripPrefix(url.pathname);
    if (path === null) return new Response('{"error":"bad route"}', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && isCollectionPath(path)) {
      const documents: Array<{ name: string, fields: FirestoreFields, createTime: string, updateTime: string }> = [];
      for (const [docPath, doc] of docs) {
        if (!docPath.startsWith(`${path}/`)) continue;
        const remainder = docPath.slice(path.length + 1);
        if (remainder.split('/').length !== 1) continue;
        documents.push({
          name: fullName(docPath),
          fields: doc.fields,
          createTime: doc.createTime,
          updateTime: doc.updateTime,
        });
      }
      return json({ documents });
    }

    if (method === 'GET') {
      const doc = docs.get(path);
      if (!doc) return json({ error: { message: 'NOT_FOUND' } }, { status: 404 });
      return json({ name: fullName(path), fields: doc.fields, createTime: doc.createTime, updateTime: doc.updateTime });
    }

    if (method === 'PATCH') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { fields?: FirestoreFields };
      const now = new Date().toISOString();
      const existing = docs.get(path);
      docs.set(path, {
        fields: body.fields ?? {},
        createTime: existing?.createTime ?? now,
        updateTime: now,
      });
      return json({
        name: fullName(path),
        fields: body.fields ?? {},
        createTime: existing?.createTime ?? now,
        updateTime: now,
      });
    }

    if (method === 'DELETE') {
      docs.delete(path);
      return json({});
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { docs, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as Record<string, unknown>,
  },
});

// Firestore path segments must match /^[A-Za-z0-9._-]+$/ — contract test keys use
// `contract-test/` prefix with slashes and alphanumeric segments, which is fine.
// However the contract tests use keys like `contract-test/create-object-<timestamp>`.
// The hyphens and digits are valid Firestore segment characters.

export const firestoreContractCase: StorageContractCase = {
  name: 'FirestoreStorageRepository',
  async makeRepo() {
    const mock = createMockFirestore();
    return new FirestoreStorageRepository({
      auth: { accessToken: 'ya29.fake' },
      projectId: PROJECT,
      apiUrl: API_URL,
      fetch: mock.fetch,
      rootCollection: 'laika',
      itemsCollection: 'items',
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
};

export { toFirestoreFields };
