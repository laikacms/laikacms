import type { StorageContractCase } from 'laikacms/storage/testing';

import { GistStorageRepository } from '../gist-storage-repository.js';

// ---------------------------------------------------------------------------
// Minimal in-memory GitHub Gist mock. Handles GET + PATCH /gists/{id}.
// ---------------------------------------------------------------------------

const GIST_ID = 'contract-test-gist';
const API_URL = 'https://mock.github.contract';

interface MockFile {
  filename: string;
  content: string;
}

const createMockGist = () => {
  const files = new Map<string, MockFile>();
  const createdAt = new Date('2026-01-01').toISOString();
  let historyCounter = 0;

  const newVersion = () => `v${(++historyCounter).toString().padStart(8, '0')}`;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const buildGistResponse = () => ({
    id: GIST_ID,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    history: [{ version: newVersion() }],
    files: Object.fromEntries(
      [...files.values()].map(f => [f.filename, {
        filename: f.filename,
        content: f.content,
        size: f.content.length,
        raw_url: `${API_URL}/raw/${encodeURIComponent(f.filename)}`,
        truncated: false,
      }]),
    ),
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === `/gists/${GIST_ID}` && method === 'GET') {
      return json(buildGistResponse());
    }

    if (path === `/gists/${GIST_ID}` && method === 'PATCH') {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        files: Record<string, { content?: string } | null>,
      };
      for (const [filename, value] of Object.entries(body.files)) {
        if (value === null) {
          files.delete(filename);
        } else if (value.content !== undefined) {
          files.set(filename, { filename, content: value.content });
        }
      }
      return json(buildGistResponse());
    }

    return new Response(`{"unhandled":"${method} ${path}"}`, { status: 501 });
  };

  return { fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as Record<string, unknown>,
  },
});

export const gistContractCase: StorageContractCase = {
  name: 'GistStorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockGist();
    return new GistStorageRepository({
      gistId: GIST_ID,
      auth: { token: 'gh_pat_test' },
      apiUrl: API_URL,
      fetch: fetchImpl,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
};
