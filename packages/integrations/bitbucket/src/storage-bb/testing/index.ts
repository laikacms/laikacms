import type { StorageContractCase } from 'laikacms/storage/testing';

import { BitbucketStorageRepository } from '../bitbucket-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Bitbucket Cloud API mock — stateful Map-based file store.
// Covers the Bitbucket REST endpoints the datasource uses:
//   GET  /repositories/{ws}/{repo}/src/{branch}/{path}            → file content
//   GET  /repositories/{ws}/{repo}/src/{branch}/{path}?format=meta → file metadata
//   GET  /repositories/{ws}/{repo}/src/{branch}/{path}/?pagelen=N  → directory listing
//   POST /repositories/{ws}/{repo}/src                            → commit (create/update/delete)
// ---------------------------------------------------------------------------

const WORKSPACE = 'test-workspace';
const REPO_SLUG = 'test-repo';
const BRANCH = 'main';
const API_URL = 'https://api.bb.test/2.0';
const OAUTH_TOKEN = 'test-oauth-token';

const createMockBitbucket = () => {
  // Map from path → file content.
  const files = new Map<string, string>();
  let commitCounter = 0;
  const newCommit = (): string => `${(++commitCounter).toString(16).padStart(40, '0')}`;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  // Reconstruct the full file path from an encoded Bitbucket URL path.
  // The datasource encodes each segment separately: `path.split('/').map(encodeURIComponent).join('/')`.
  const decodeBbSegments = (encoded: string): string =>
    encoded.split('/').filter(s => s.length > 0).map(decodeURIComponent).join('/');

  const repoBase = `${API_URL}/repositories/${encodeURIComponent(WORKSPACE)}/${encodeURIComponent(REPO_SLUG)}`;
  const srcBase = `${repoBase}/src`;
  const encodedBranch = encodeURIComponent(BRANCH);

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);
    const pathname = u.pathname;

    // POST /repositories/{ws}/{repo}/src — commit
    if (method === 'POST' && pathname === new URL(srcBase).pathname) {
      const body = init?.body;
      if (!(body instanceof FormData)) return json({ error: { message: 'expected multipart form data' } }, 400);

      const branch = body.get('branch');
      if (branch !== BRANCH) return json({ error: { message: `unknown branch: ${branch}` } }, 400);

      // Process deletes (repeated `files` form fields).
      const deleteFields = body.getAll('files');
      for (const path of deleteFields) {
        if (typeof path === 'string') files.delete(path);
      }

      // Process file puts — any field that's not a metadata field is a file.
      const META_KEYS = new Set(['branch', 'message', 'author', 'files']);
      for (const [key, value] of body.entries()) {
        if (META_KEYS.has(key)) continue;
        const content = value instanceof Blob ? await value.text() : String(value);
        files.set(key, content);
      }

      return new Response('', { status: 201 });
    }

    // GET /repositories/{ws}/{repo}/src/{branch}/{path}[?format=meta|?pagelen=N]
    const srcBranchPrefix = `${new URL(srcBase).pathname}/${encodedBranch}`;
    if (method === 'GET' && pathname.startsWith(srcBranchPrefix)) {
      // Extract the path portion after `/src/{branch}`.
      const afterBranch = pathname.slice(srcBranchPrefix.length);
      // `afterBranch` starts with `/` or is empty.
      const encodedPath = afterBranch.replace(/^\//, '').replace(/\/$/, '');
      const filePath = encodedPath === '' ? '' : decodeBbSegments(encodedPath);

      const format = u.searchParams.get('format');
      const isDirectoryListing = pathname.endsWith('/') || u.searchParams.has('pagelen');

      // Directory listing.
      if (isDirectoryListing) {
        const prefix = filePath === '' ? '' : `${filePath}/`;
        const seen = new Set<string>();
        const values: Array<{ type: string, path: string, size?: number, commit?: { hash: string } }> = [];

        for (const name of files.keys()) {
          if (prefix !== '' && !name.startsWith(prefix)) continue;
          const rest = prefix === '' ? name : name.slice(prefix.length);
          const slashIdx = rest.indexOf('/');
          if (slashIdx === -1) {
            // Direct file in this dir.
            values.push({
              type: 'commit_file',
              path: name,
              size: new TextEncoder().encode(files.get(name) ?? '').byteLength,
              commit: { hash: newCommit() },
            });
          } else {
            // Subdirectory.
            const subdir = prefix + rest.slice(0, slashIdx);
            if (!seen.has(subdir)) {
              seen.add(subdir);
              values.push({ type: 'commit_directory', path: subdir });
            }
          }
        }

        if (values.length === 0 && filePath !== '') {
          return json({ error: { message: `not found: ${filePath}` } }, 404);
        }

        return json({ values });
      }

      // Metadata.
      if (format === 'meta') {
        if (!files.has(filePath)) return json({ error: { message: `not found: ${filePath}` } }, 404);
        const content = files.get(filePath) ?? '';
        return json({
          type: 'commit_file',
          path: filePath,
          size: new TextEncoder().encode(content).byteLength,
          commit: { hash: newCommit(), date: new Date().toISOString() },
        });
      }

      // File content.
      if (!files.has(filePath)) return json({ error: { message: `not found: ${filePath}` } }, 404);
      return new Response(files.get(filePath) ?? '', { status: 200 });
    }

    return json({ error: { message: `unhandled: ${method} ${pathname}` } }, 501);
  };

  return { fetch: mockFetch };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const bitbucketContractCase: StorageContractCase = {
  name: 'BitbucketStorageRepository',
  async makeRepo() {
    const mock = createMockBitbucket();
    return new BitbucketStorageRepository({
      workspace: WORKSPACE,
      repo: REPO_SLUG,
      branch: BRANCH,
      auth: { oauthToken: OAUTH_TOKEN },
      apiUrl: API_URL,
      fetch: mock.fetch,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
