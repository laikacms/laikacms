import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { TrelloDataSource, TrelloStorageRepository } from '@laikacms/trello/storage-trello';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * TRELLO_API_KEY — Trello API key (required). Get at https://trello.com/app-key
 * TRELLO_TOKEN   — Trello OAuth 1.0a token (required). Obtained from the
 *                  same page — click "generate a token" next to your API key.
 * TRELLO_BOARD_ID — ID of the Trello board to use as storage (required).
 *                   Find it in the board URL: trello.com/b/<boardId>/...
 *                   or append .json to the board URL and read the "id" field.
 *
 * Five distinctive Trello traits this starter exercises:
 *
 *   1. Query-string auth — credentials go as ?key=…&token=… URL params,
 *      not in the Authorization header. First backend in the suite with
 *      query-string-based auth.
 *
 *   2. Float pos ordering — every card and list carries a positive-float
 *      pos field for drag-and-drop ordering. New entries get pos='bottom'.
 *      First backend with native positional ordering at the wire level.
 *
 *   3. Soft-delete lists — Trello archives lists via closed=true (no
 *      physical DELETE endpoint for lists). Cards can be hard-deleted.
 *      Type-specific delete semantics within the same backend.
 *
 *   4. 2-level platform flattened to N-level paths — Trello has boards
 *      and lists. The repository encodes deep paths into list names:
 *        posts/hello → card "hello.md" in list "posts"
 *        notes/sub/deep → card "deep.md" in list "notes/sub"
 *        standalone → card "standalone.md" in list "__root__"
 *
 *   5. Server-managed revision — dateLastActivity timestamp updated by
 *      Trello on every card mutation; surfaced as metadata.revisionId.
 *
 * Note: card desc is capped at 16,384 characters. Posts must be short
 * enough to fit. For larger content, use a different backend.
 *
 * Quick start:
 *   1. Create a Trello board and get the board ID from the URL
 *   2. Get your API key + token from https://trello.com/app-key
 *   TRELLO_API_KEY=<key> TRELLO_TOKEN=<token> TRELLO_BOARD_ID=<id> pnpm dev
 */
const dataSource = new TrelloDataSource({
  boardId: requireEnv('TRELLO_BOARD_ID'),
  auth: {
    apiKey: requireEnv('TRELLO_API_KEY'),
    token: requireEnv('TRELLO_TOKEN'),
  },
});

const storage = new TrelloStorageRepository({
  dataSource,
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
