import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { GitlabStorageRepository } from '@laikacms/gitlab/storage-gl';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * GITLAB_PROJECT_ID — Numeric project ID or URL-encoded path (e.g. "mygroup/my-blog").
 * GITLAB_TOKEN      — Personal access token with api scope (or read_repository + write_repository).
 * GITLAB_BRANCH     — Branch to store content on (default: "main").
 * GITLAB_API_URL    — Override for self-hosted GitLab (default: https://gitlab.com/api/v4).
 *
 * Quick start:
 *   1. Create a GitLab project (or use an existing one).
 *   2. Generate a Personal Access Token with `api` scope.
 *   3. Set env vars and run:
 *
 *   GITLAB_PROJECT_ID=mygroup/my-blog \
 *   GITLAB_TOKEN=glpat-xxxx \
 *   pnpm dev
 *
 * Self-hosted GitLab:
 *   GITLAB_API_URL=https://gitlab.example.com/api/v4 \
 *   GITLAB_PROJECT_ID=42 \
 *   GITLAB_TOKEN=glpat-xxxx \
 *   pnpm dev
 */
const storage = new GitlabStorageRepository({
  projectId: requireEnv('GITLAB_PROJECT_ID'),
  branch: process.env['GITLAB_BRANCH'] ?? 'main',
  auth: { token: requireEnv('GITLAB_TOKEN') },
  apiUrl: process.env['GITLAB_API_URL'],
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const adminHtml = decapAdminHtml();
