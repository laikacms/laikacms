import type { Octokit } from '@octokit/rest';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { GithubStorageRepository } from '../github-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory GitHub Contents API mock via a minimal Octokit stub.
// The datasource accepts a pre-constructed `octokit` instance, so we mock
// at that boundary rather than at `fetch`.
//
// Operations simulated:
//   octokit.repos.getContent        → GET a file or directory listing
//   octokit.repos.createOrUpdateFileContents → PUT/PATCH a file
//   octokit.repos.deleteFile        → DELETE a file
//   octokit.rest.repos.listCommits  → list commits for a path (for createdAt/updatedAt)
// ---------------------------------------------------------------------------

interface StoredFile {
  content: string;
  sha: string;
  path: string;
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const createMockOctokit = () => {
  const files = new Map<string, StoredFile>();
  let shaCounter = 0;
  const newSha = () => `sha${(++shaCounter).toString().padStart(40, '0')}`;
  const createdAt = new Date('2026-01-01');

  const getContentData = (path: string) => {
    const exactFile = files.get(path);
    if (exactFile) {
      return {
        type: 'file',
        content: textToBase64(exactFile.content),
        encoding: 'base64',
        sha: exactFile.sha,
        path,
        name: path.split('/').pop() ?? path,
      };
    }

    // Build a directory listing that includes both direct file children and
    // immediate subdirectory entries (needed for depth>1 traversal).
    const childPrefix = path === '' ? '' : `${path}/`;
    const seen = new Set<string>();
    const entries: Array<{ type: string, sha: string, path: string, name: string }> = [];

    for (const f of files.values()) {
      if (path !== '' && !f.path.startsWith(childPrefix)) continue;
      const rest = path === '' ? f.path : f.path.slice(childPrefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        // Direct file child
        if (!seen.has(f.path)) {
          seen.add(f.path);
          entries.push({ type: 'file', sha: f.sha, path: f.path, name: f.path.split('/').pop() ?? f.path });
        }
      } else {
        // Nested under a subdirectory — emit the immediate subdirectory entry
        const childName = rest.slice(0, slash);
        const childPath = path === '' ? childName : `${path}/${childName}`;
        if (!seen.has(childPath)) {
          seen.add(childPath);
          entries.push({ type: 'dir', sha: f.sha, path: childPath, name: childName });
        }
      }
    }

    if (entries.length > 0) return entries;

    // Simulate 404
    const err = new Error('Not Found') as Error & { status: number };
    err.status = 404;
    throw err;
  };

  const octokit = {
    repos: {
      getContent: async ({ path }: { owner: string, repo: string, path: string, ref?: string }) => {
        const data = getContentData(path);
        return { data };
      },
      createOrUpdateFileContents: async ({
        path,
        content,
        sha: expectedSha,
      }: {
        owner: string,
        repo: string,
        path: string,
        message: string,
        content: string,
        branch?: string,
        sha?: string,
        committer?: unknown,
      }) => {
        const existing = files.get(path);
        if (existing && expectedSha && existing.sha !== expectedSha) {
          const err = new Error('Conflict') as Error & { status: number };
          err.status = 409;
          throw err;
        }
        const sha = newSha();
        const decoded = (() => {
          const b64 = content.replace(/\s+/g, '');
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new TextDecoder().decode(bytes);
        })();
        files.set(path, { content: decoded, sha, path });
        return { data: { content: { sha, path } } };
      },
      deleteFile: async ({
        path,
        sha,
      }: {
        owner: string,
        repo: string,
        path: string,
        message: string,
        sha: string,
        branch?: string,
        committer?: unknown,
      }) => {
        const existing = files.get(path);
        if (!existing) {
          const err = new Error('Not Found') as Error & { status: number };
          err.status = 404;
          throw err;
        }
        if (existing.sha !== sha) {
          const err = new Error('Conflict') as Error & { status: number };
          err.status = 409;
          throw err;
        }
        files.delete(path);
        return {};
      },
    },
    rest: {
      repos: {
        listCommits: async (_params: {
          owner: string,
          repo: string,
          path: string,
          sha?: string,
          per_page?: number,
          page?: number,
        }) => {
          // Return a single fake commit for all paths.
          const commit = {
            commit: {
              author: { date: createdAt.toISOString() },
              committer: { date: createdAt.toISOString() },
            },
          };
          return {
            data: [commit],
            headers: {},
          };
        },
      },
    },
  };

  return { files, octokit };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as Record<string, unknown>,
  },
});

export const githubContractCase: StorageContractCase = {
  name: 'GithubStorageRepository',
  async makeRepo() {
    const { octokit } = createMockOctokit();
    return new GithubStorageRepository({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      octokit: octokit as unknown as Octokit,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
};
