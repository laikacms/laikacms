import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { GistStorageRepository } from '@laikacms/gist/storage-gist';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

/**
 * GitHub Gist as the content store for LaikaCMS.
 *
 * All storage operations go through exactly two endpoints:
 *   GET  /gists/{id}   — read the full file map
 *   PATCH /gists/{id}  — write a file-delta map (create/update/delete)
 *
 * Three traits distinct from every other backend in this repo:
 *
 *   1. Atomic multi-file PATCH. Every operation that touches multiple files
 *      ships one PATCH with the full delta:
 *        { files: { "hello.md": { content: "..." }, "bye.md": null } }
 *      removeAtoms(N) resolves all N keys then sends one PATCH — not N.
 *      Multiple changes land as a single revision in the gist's git history.
 *
 *   2. "/" is forbidden in gist filenames. The data source encodes "/" → "__"
 *      and decodes on read:
 *        storage key "notes/hello" → gist filename "notes__hello.md"
 *      Keys that literally contain "__" are rejected with BadRequestError so
 *      the encoding stays unambiguous.
 *
 *   3. Single-gist scope. One Gist instance, bounded at ~300 files and ~1MB.
 *      The gist must exist before starting — create it manually or via the
 *      GitHub API and pass its ID as GIST_ID.
 *
 * Required env vars:
 *   GIST_ID          — ID of an existing GitHub Gist (the 32-char hex from the URL)
 *   GITHUB_PAT       — Personal Access Token with `gist` scope
 *
 * Quick start:
 *   1. Create a gist at https://gist.github.com (can be empty, with one placeholder file)
 *   2. Copy the gist ID from the URL
 *   3. Create a PAT with `gist` scope at https://github.com/settings/tokens
 *   4. Set env vars and pnpm dev
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const storage = new GistStorageRepository({
  gistId: requireEnv('GIST_ID'),
  auth: { token: requireEnv('GITHUB_PAT') },
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapAdminHtml };
