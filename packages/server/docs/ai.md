---
title: AI assistant
order: 2
---

# AI assistant

`@laikacms/server/ai` provides the chat and session endpoints behind the Decap CMS editor assistant.
It authenticates a Bearer token, streams a model response through the Vercel AI SDK, and persists
conversations through consumer-supplied callbacks.

`ai` (and any `@ai-sdk/*` provider) is an **optional peer** — install it only if you mount these
endpoints:

```bash
pnpm add ai @ai-sdk/anthropic
```

## Wiring example

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

Re-export `tool`, `jsonSchema`, and the model factories from `@laikacms/server/ai` rather than
importing `ai` directly — this keeps a single physical `ai` package and ensures branded tool/schema
types match.

## Endpoints

All paths are relative to `basePath` (default `/api/ai`). Every endpoint except `/health` requires
`Authorization: Bearer <token>` and the `requiredScope`.

| Method   | Path            | Purpose                                                       |
| -------- | --------------- | ------------------------------------------------------------- |
| `GET`    | `/health`       | Liveness probe; no auth                                       |
| `POST`   | `/chat`         | Streams a response; body `{ messages, sessionId?, document }` |
| `GET`    | `/sessions`     | Sessions for `?documentSlug=`, scoped to the caller           |
| `GET`    | `/sessions/:id` | One session with its full message history                     |
| `DELETE` | `/sessions/:id` | Deletes a session the caller owns                             |

`POST /chat` replies with the AI SDK's UI message stream and an `X-Session-Id` header.

## `DecapAiConfig` options

| Option                    | Type                   | Required | Default            | Description                                                                                                                            |
| ------------------------- | ---------------------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                   | `LanguageModel`        | ✓        | —                  | Vercel AI SDK model (e.g. `anthropic('claude-3-5-sonnet-20241022')`)                                                                   |
| `authenticateAccessToken` | `(token) => User`      | ✓        | —                  | Validate a Bearer token; return `{ ...ctx.user, scopes: ctx.scopes }` from `resolveBearer`                                             |
| `callbacks`               | `AiSessionCallbacks`   | ✓        | —                  | Session persistence; see below                                                                                                         |
| `basePath`                | `string`               |          | `'/api/ai'`        | URL prefix for all endpoints                                                                                                           |
| `requiredScope`           | `Scope`                |          | `'content:write'`  | Scope checked against `user.scopes`; users with no scopes (legacy full-admin sessions) are always allowed                              |
| `systemPrompt`            | `string`               |          | English CMS prompt | **Replaces** the default system prompt entirely; the default `getDocumentData`/`updateDocument` guidance is discarded when this is set |
| `tools`                   | `ToolSet`              |          | —                  | Additional server-side tools (with `execute`); see client-side tools note below                                                        |
| `maxOutputTokens`         | `number`               |          | `4096`             | Maximum tokens in the model response                                                                                                   |
| `temperature`             | `number`               |          | `0.7`              | Sampling temperature                                                                                                                   |
| `logger`                  | `{ error(...): void }` |          | —                  | Receives internal errors                                                                                                               |
| `messages`                | `Translation`          |          | English            | Localized error responses and system prompt                                                                                            |

## `AiSessionCallbacks` interface

Consumer-supplied callbacks that persist conversations to your storage (KV, D1, Postgres, etc.).

```typescript
interface AiSessionCallbacks {
  createSession(session: AiSession): Promise<void>;
  getSession(sessionId: string): Promise<AiSession | null>;
  getSessionsByDocument(documentSlug: string, userId: string): Promise<AiSession[]>;
  updateSession(
    sessionId: string,
    updates: Partial<Pick<AiSession, 'messages' | 'title' | 'updatedAt'>>,
  ): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
```

## Client-side tools

`getDocumentData` and `updateDocument` are declared with **no `execute`**, so the SDK ships them to
the browser: the CMS client (the Dulla `LlmTransport`) applies document edits locally and reports
the result back as the tool output. Add your own server-side tools through `config.tools` — those
should have an `execute`.

## Authorization

`requiredScope` defaults to `content:write` because the assistant can edit entries. A `User` with no
`scopes` is treated as full access, matching `resolveBearer`'s convention for legacy sessions;
populate `scopes` to gate AI access separately from content access.
