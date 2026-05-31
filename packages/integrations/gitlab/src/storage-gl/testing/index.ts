import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { GitlabStorageRepository } from '../gitlab-storage-repository.js';

const PROJECT_ID = '42';
const BRANCH = 'main';
const API_URL = 'https://gl.test/api/v4';

interface MockFile {
  content: string;
  blob_id: string;
  last_commit_id: string;
  committed_date: string;
  created_date: string;
}

const createMockServer = () => {
  const files = new Map<string, MockFile>();
  let commitCounter = 0;

  const newCommitId = (): string => {
    commitCounter += 1;
    return `commit-${commitCounter}`;
  };

  const segmentsOf = (path: string): string[] => path.split('/').filter(s => s.length > 0);

  const directChildren = (parent: string): Array<{ name: string, path: string, type: 'tree' | 'blob' }> => {
    const parentSegs = segmentsOf(parent);
    const seenDirs = new Set<string>();
    const out: Array<{ name: string, path: string, type: 'tree' | 'blob' }> = [];
    for (const path of files.keys()) {
      const segs = segmentsOf(path);
      if (parentSegs.length >= segs.length) continue;
      let mismatch = false;
      for (let i = 0; i < parentSegs.length; i++) {
        if (segs[i] !== parentSegs[i]) {
          mismatch = true;
          break;
        }
      }
      if (mismatch) continue;
      if (segs.length === parentSegs.length + 1) {
        out.push({ name: segs[segs.length - 1], path: segs.join('/'), type: 'blob' });
      } else {
        const dirSegs = segs.slice(0, parentSegs.length + 1);
        const dirPath = dirSegs.join('/');
        if (!seenDirs.has(dirPath)) {
          seenDirs.add(dirPath);
          out.push({ name: dirSegs[dirSegs.length - 1], path: dirPath, type: 'tree' });
        }
      }
    }
    return out;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;
    const projectPrefix = `/api/v4/projects/${PROJECT_ID}`;

    const fileMatch = pathname.match(
      new RegExp(`^${projectPrefix.replace(/\//g, '\\/')}\\/repository\\/files\\/(.+)$`),
    );
    if (fileMatch && method === 'GET') {
      const filePath = decodeURIComponent(fileMatch[1]);
      const file = files.get(filePath);
      if (!file) return new Response('{"message":"404 File Not Found"}', { status: 404 });
      return new Response(
        JSON.stringify({
          file_path: filePath,
          file_name: filePath.split('/').pop(),
          encoding: 'base64',
          content: file.content,
          blob_id: file.blob_id,
          commit_id: file.last_commit_id,
          last_commit_id: file.last_commit_id,
          size: file.content.length,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (fileMatch && method === 'POST') {
      const filePath = decodeURIComponent(fileMatch[1]);
      if (files.has(filePath)) {
        return new Response('{"message":"A file with this name already exists"}', { status: 400 });
      }
      const body = JSON.parse((init?.body as string) ?? '{}');
      const now = new Date().toISOString();
      files.set(filePath, {
        content: body.content ?? '',
        blob_id: `blob-${filePath}-${Date.now()}`,
        last_commit_id: newCommitId(),
        committed_date: now,
        created_date: now,
      });
      return new Response(JSON.stringify({ file_path: filePath, branch: body.branch }), { status: 201 });
    }
    if (fileMatch && method === 'PUT') {
      const filePath = decodeURIComponent(fileMatch[1]);
      const file = files.get(filePath);
      if (!file) return new Response('{"message":"404 File Not Found"}', { status: 404 });
      const body = JSON.parse((init?.body as string) ?? '{}');
      const updated: MockFile = {
        ...file,
        content: body.content ?? file.content,
        last_commit_id: newCommitId(),
        committed_date: new Date().toISOString(),
      };
      files.set(filePath, updated);
      return new Response(JSON.stringify({ file_path: filePath, branch: body.branch }), { status: 200 });
    }
    if (fileMatch && method === 'DELETE') {
      const filePath = decodeURIComponent(fileMatch[1]);
      if (!files.has(filePath)) return new Response('{"message":"404 File Not Found"}', { status: 404 });
      files.delete(filePath);
      return new Response(null, { status: 204 });
    }

    if (pathname === `${projectPrefix}/repository/tree` && method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      const perPage = Number(url.searchParams.get('per_page') ?? '20');
      const page = Number(url.searchParams.get('page') ?? '1');
      const entries = directChildren(path);
      if (entries.length === 0 && path !== '') {
        const isPrefix = [...files.keys()].some(p => p.startsWith(`${path}/`));
        if (!isPrefix) return new Response('{"message":"404 Tree Not Found"}', { status: 404 });
      }
      const start = (page - 1) * perPage;
      const slice = entries.slice(start, start + perPage);
      const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
      const nextPage = page < totalPages ? String(page + 1) : '';
      const body = slice.map(e => ({
        id: `tree-${e.path}`,
        name: e.name,
        type: e.type,
        path: e.path,
        mode: '100644',
      }));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Total': String(entries.length),
          'X-Total-Pages': String(totalPages),
          'X-Page': String(page),
          'X-Per-Page': String(perPage),
          'X-Next-Page': nextPage,
        },
      });
    }

    if (pathname === `${projectPrefix}/repository/commits` && method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      const file = files.get(path);
      if (!file) return new Response('[]', { status: 200, headers: { 'X-Total-Pages': '0' } });
      return new Response(
        JSON.stringify([{
          id: file.last_commit_id,
          committed_date: file.committed_date,
          authored_date: file.committed_date,
          created_at: file.committed_date,
        }]),
        { status: 200, headers: { 'Content-Type': 'application/json', 'X-Total-Pages': '1' } },
      );
    }

    return new Response(`{"unhandled":"${method} ${pathname}"}`, { status: 501 });
  };

  return { files, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const gitlabContractCase: StorageContractCase = {
  name: 'GitlabStorageRepository',
  async makeRepo() {
    const server = createMockServer();
    return new GitlabStorageRepository({
      projectId: PROJECT_ID,
      branch: BRANCH,
      apiUrl: API_URL,
      auth: { token: 'glpat-test' },
      fetch: server.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
