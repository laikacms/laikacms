# @laikacms/server/ai

[![npm](https://img.shields.io/npm/v/@laikacms/server)](https://www.npmjs.com/package/@laikacms/server)

The chat and session endpoints behind Decap CMS's editor assistant. One `fetch(request)` handler
that authenticates a Bearer token, streams a model response through the Vercel AI SDK, and persists
the conversation through consumer-supplied callbacks.

This module is the server half of a two-part arrangement:

| Half       | Where it lives                                                      | Job                                                          |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Server** | here (`@laikacms/server/ai`)                                        | auth, model call, session persistence                        |
| **Client** | `@laikacms/decap-cms-llm-dulla` (the `Dulla` transport in the fork) | implements the CMS's `LlmTransport`, executes document tools |

The CMS itself ships no transport and no AI dependency: it defines an `LlmTransport` interface, a
chat panel, and a translate action. `Dulla` is the implementation that points them at this server.

## Optional dependency

`ai` (and any `@ai-sdk/*` provider) is an **optional peer** of `@laikacms/server`. Install it only
if you mount these endpoints:

```bash
pnpm add ai @ai-sdk/anthropic
```

## Usage

```typescript
import { decapAi } from '@laikacms/server/ai';
import { anthropic } from '@laikacms/server/ai/providers';
import { resolveBearer } from 'laikacms/auth';

const ai = decapAi({
  model: anthropic('claude-3-5-sonnet-20241022'),
  basePath: '/api/ai',
  authenticateAccessToken: async token => {
    const ctx = await resolveBearer(token, { verifySessionToken, lookupPatByHash });
    if (!ctx) throw new Error('Unauthorized');
    // Forward the scopes: decapAi enforces `requiredScope` ('content:write' by
    // default) rather than treating any authenticated user as full admin.
    return { ...ctx.user, scopes: ctx.scopes };
  },
  callbacks: {
    createSession,
    getSession,
    getSessionsByDocument,
    updateSession,
    deleteSession,
  },
});

export default { fetch: ai.fetch.bind(ai) };
```

Re-export `tool`, `jsonSchema` and the model factories from this module rather than importing `ai`
directly, so there is a single physical `ai` package and the branded tool/schema types match.

## Endpoints

All paths are relative to `basePath` (default `/api/ai`). Everything but `/health` requires
`Authorization: Bearer <token>` and the `requiredScope`.

| Method   | Path            | Purpose                                                       |
| -------- | --------------- | ------------------------------------------------------------- |
| `GET`    | `/health`       | Liveness probe; no auth                                       |
| `POST`   | `/chat`         | Streams a response; body `{ messages, sessionId?, document }` |
| `GET`    | `/sessions`     | Sessions for `?documentSlug=`, scoped to the caller           |
| `GET`    | `/sessions/:id` | One session with its full message history                     |
| `DELETE` | `/sessions/:id` | Deletes a session the caller owns                             |

`POST /chat` answers with the AI SDK's UI message stream and an `X-Session-Id` header naming the
session the turn was written to.

## Client-side tools

`getDocumentData` and `updateDocument` are declared with **no `execute`**, so the SDK ships them to
the browser: the open entry lives in the CMS's store, not on the server. The client applies
`updateDocument`'s RFC 6902 patch to the draft and reports the result back as the tool output. Add
your own server-side tools through `config.tools` — those do get an `execute`.

## Authorization

`requiredScope` defaults to `content:write`, because the assistant can edit entries. A `User` with
no `scopes` is treated as full access, matching `resolveBearer`'s "omitted means full admin"
convention; populate `scopes` to gate AI access properly.

## Configuration reference

All `DecapAiConfig` fields — the ones already in the Usage example above and the ones often missed:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | `LanguageModel` | _(required)_ | Vercel AI SDK model. |
| `authenticateAccessToken` | `(token: string) => Promise<User>` | _(required)_ | Verify a Bearer token and return the user (with `scopes`). |
| `callbacks` | `AiSessionCallbacks` | _(required)_ | Session storage (create / get / list / update / delete). |
| `basePath` | `string` | `'/api/ai'` | Route prefix for all AI endpoints. |
| `requiredScope` | `Scope` | `'content:write'` | Scope enforced on every authenticated request. |
| `tools` | `ToolSet` | `{}` | Extra server-side tools passed to `streamText`. Client-side tools (`getDocumentData`, `updateDocument`) are always injected by the framework. |
| `systemPrompt` | `string` | built-in English prompt | **Replaces** the default prompt entirely — the built-in `getDocumentData`/`updateDocument` tool guidance is discarded when this is set. To extend the default rather than replace it, use `messages` instead (see below). |
| `maxOutputTokens` | `number` | `4096` | Maximum tokens the model may emit per response. |
| `temperature` | `number` | `0.7` | Sampling temperature. |
| `messages` | `Translation` | English bundle | Localized error strings and system prompt. Import from `@laikacms/server/ai/i18n/en` to extend: `messages: { ...en, systemPrompt: 'Your prefix.\n\n' + en.systemPrompt }`. |
| `logger` | `{ error(...args): void }` | _(none)_ | Receives internal diagnostic output. |
