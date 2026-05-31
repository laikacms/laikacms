import type { StorageContractCase } from 'laikacms/storage/testing';

import { GelDataSource } from '../gel-datasource.js';
import { GelStorageRepository } from '../gel-storage-repository.js';

// ---------------------------------------------------------------------------
// Minimal in-memory Gel HTTP EdgeQL mock. Dispatches by query fingerprint
// (after collapsing whitespace) to simulate the EdgeQL operations the
// repository actually uses.
// ---------------------------------------------------------------------------

const API = 'http://gel.contract-test:5656';
const BRANCH = 'main';

interface FileRow {
  id: string;
  path: string;
  parent: string;
  name: string;
  extension: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface FolderRow {
  id: string;
  path: string;
  parent: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const createMockGel = () => {
  const files = new Map<string, FileRow>();
  const folders = new Map<string, FolderRow>();
  let idCounter = 0;
  const newId = () => `id-${(++idCounter).toString().padStart(8, '0')}`;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const norm = (q: string) => q.replace(/\s+/g, ' ').trim();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname !== `/branch/${BRANCH}/edgeql`) {
      return new Response('{"error":{"message":"bad route"}}', { status: 404 });
    }
    const body = JSON.parse((init?.body as string) ?? '{}') as {
      query: string,
      variables: Record<string, unknown>,
    };
    const q = norm(body.query);
    const vars = body.variables;

    // SELECT LaikaFile ... FILTER .parent = <str>$parent AND .name = <str>$name LIMIT 1
    if (/^SELECT LaikaFile\b/.test(q) && q.includes('.parent =') && q.includes('.name =') && q.includes('LIMIT 1')) {
      const parent = String(vars['parent'] ?? '');
      const name = String(vars['name'] ?? '');
      const row = [...files.values()].find(r => r.parent === parent && r.name === name) ?? null;
      return json({ data: row ? [row] : [] });
    }

    // SELECT LaikaFile { id } LIMIT 1 (existence probe)
    if (/^SELECT LaikaFile \{ id \} LIMIT 1$/.test(q)) {
      const row = [...files.values()][0] ?? null;
      return json({ data: row ? [{ id: row.id }] : [] });
    }

    // SELECT LaikaFile { id } FILTER .parent = ... LIMIT 1 (implicit folder probe)
    if (/^SELECT LaikaFile \{ id \} FILTER \.parent = <str>\$parent LIMIT 1$/.test(q)) {
      const parent = String(vars['parent'] ?? '');
      const row = [...files.values()].find(r => r.parent === parent) ?? null;
      return json({ data: row ? [{ id: row.id }] : [] });
    }

    // SELECT LaikaFolder ... FILTER .path = ... LIMIT 1
    if (/^SELECT LaikaFolder\b/.test(q) && q.includes('.path =') && q.includes('LIMIT 1')) {
      const path = String(vars['path'] ?? '');
      const row = [...folders.values()].find(r => r.path === path) ?? null;
      return json({ data: row ? [row] : [] });
    }

    // SELECT LaikaFolder { id } LIMIT 1 (root probe)
    if (/^SELECT LaikaFolder \{ id \} LIMIT 1$/.test(q)) {
      const row = [...folders.values()][0] ?? null;
      return json({ data: row ? [{ id: row.id }] : [] });
    }

    // SELECT LaikaFile ... FILTER .parent = <str>$parent (list files in folder)
    if (/^SELECT LaikaFile \{[^}]+\} FILTER \.parent = <str>\$parent$/.test(q)) {
      const parent = String(vars['parent'] ?? '');
      const rows = [...files.values()].filter(r => r.parent === parent);
      return json({ data: rows });
    }

    // SELECT LaikaFolder ... FILTER .parent = <str>$parent (list folders in folder)
    if (/^SELECT LaikaFolder \{[^}]+\} FILTER \.parent = <str>\$parent$/.test(q)) {
      const parent = String(vars['parent'] ?? '');
      const rows = [...folders.values()].filter(r => r.parent === parent);
      return json({ data: rows });
    }

    // INSERT LaikaFile ... (no UNLESS CONFLICT)
    if (/^INSERT LaikaFile \{/.test(q) && !q.includes('UNLESS CONFLICT')) {
      const path = String(vars['path'] ?? '');
      const parent = String(vars['parent'] ?? '');
      const name = String(vars['name'] ?? '');
      const extension = String(vars['extension'] ?? '');
      const content = String(vars['content'] ?? '');
      const now = String(vars['now'] ?? new Date().toISOString());
      const id = newId();
      files.set(path, { id, path, parent, name, extension, content, createdAt: now, updatedAt: now });
      return json({ data: [{ id }] });
    }

    // INSERT LaikaFile ... UNLESS CONFLICT ON .path ELSE ( UPDATE ... )
    if (/^INSERT LaikaFile \{/.test(q) && q.includes('UNLESS CONFLICT') && q.includes('ELSE')) {
      const path = String(vars['path'] ?? '');
      const parent = String(vars['parent'] ?? '');
      const name = String(vars['name'] ?? '');
      const extension = String(vars['extension'] ?? '');
      const content = String(vars['content'] ?? '');
      const now = String(vars['now'] ?? new Date().toISOString());
      const existing = files.get(path);
      if (existing) {
        files.set(path, { ...existing, content, updatedAt: now });
      } else {
        const id = newId();
        files.set(path, { id, path, parent, name, extension, content, createdAt: now, updatedAt: now });
      }
      return json({ data: [] });
    }

    // UPDATE LaikaFile ... SET { content := ... }
    if (/^UPDATE LaikaFile/.test(q) && q.includes('.path =')) {
      const path = String(vars['path'] ?? '');
      const content = String(vars['content'] ?? '');
      const now = String(vars['now'] ?? new Date().toISOString());
      const existing = files.get(path);
      if (existing) files.set(path, { ...existing, content, updatedAt: now });
      return json({ data: [] });
    }

    // INSERT LaikaFolder ... UNLESS CONFLICT ON .path
    if (/^INSERT LaikaFolder \{/.test(q) && q.includes('UNLESS CONFLICT')) {
      const path = String(vars['path'] ?? '');
      const parent = String(vars['parent'] ?? '');
      const name = String(vars['name'] ?? '');
      const now = String(vars['now'] ?? new Date().toISOString());
      if (!folders.has(path)) {
        const id = newId();
        folders.set(path, { id, path, parent, name, createdAt: now, updatedAt: now });
      }
      return json({ data: [] });
    }

    // FOR p IN array_unpack(<array<str>>$paths) UNION ( DELETE LaikaFile ... )
    if (q.includes('FOR p IN array_unpack') && q.includes('DELETE LaikaFile')) {
      const paths = (vars['paths'] as string[]) ?? [];
      let deleted = 0;
      for (const p of paths) {
        if (files.delete(p)) deleted += 1;
      }
      return json({ data: Array(deleted).fill({}) });
    }

    return new Response(
      JSON.stringify({ error: { type: 'UnknownQuery', message: `unmatched query: ${q.slice(0, 80)}` } }),
      { status: 200 },
    );
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

export const gelContractCase: StorageContractCase = {
  name: 'GelStorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockGel();
    const ds = new GelDataSource({
      url: API,
      branch: BRANCH,
      fetch: fetchImpl,
    });
    return new GelStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
};
