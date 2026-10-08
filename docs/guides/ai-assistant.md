# AI Assistant

`@laikacms/server/ai` provides the chat and session endpoints behind the Decap CMS editor assistant.
It authenticates a Bearer token, streams a model response through the Vercel AI SDK, and persists
conversations through consumer-supplied callbacks.

```bash
pnpm add @laikacms/server ai @ai-sdk/anthropic
```

`ai` and the `@ai-sdk/*` provider are only needed when you mount these endpoints; swap
`@ai-sdk/anthropic` for whichever provider you use.

## Wiring example

```typescript
import { decapAi } from '@laikacms/server/ai';
import { anthropic } from '@laikacms/server/ai/providers';
import { resolveBearer } from 'laikacms/auth';

const ai = decapAi({
  model: anthropic('claude-sonnet-5-5'),
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

| Option                    | Type                                                                             | Required | Default            | Description                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------- | -------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                   | `LanguageModel`                                                                  | ✓        | —                  | Vercel AI SDK model (e.g. `anthropic('claude-sonnet-5-5')`)                                                                                                                                                                                                       |
| `authenticateAccessToken` | `(token) => User`                                                                | ✓        | —                  | Validate a Bearer token; return `{ ...ctx.user, scopes: ctx.scopes }` from [`resolveBearer`](../reference/api/laikacms/auth/functions/resolveBearer)                                                                                                              |
| `callbacks`               | [`AiSessionCallbacks`](../reference/api/server/ai/interfaces/AiSessionCallbacks) | ✓        | —                  | Session persistence; see below                                                                                                                                                                                                                                    |
| `basePath`                | `string`                                                                         |          | `'/api/ai'`        | URL prefix for all endpoints                                                                                                                                                                                                                                      |
| `requiredScope`           | [`Scope`](../reference/api/laikacms/auth/type-aliases/Scope)                     |          | `'content:write'`  | Scope checked against `user.scopes`; users with no scopes (legacy full-admin sessions) are always allowed                                                                                                                                                         |
| `systemPrompt`            | `string`                                                                         |          | English CMS prompt | **Replaces** the default system prompt entirely; the default [`getDocumentData`](../reference/api/server/ai/tools/variables/getDocumentData)/[`updateDocument`](../reference/api/server/ai/tools/variables/updateDocument) guidance is discarded when this is set |
| `tools`                   | `ToolSet`                                                                        |          | —                  | Additional server-side tools (with `execute`); see client-side tools note below                                                                                                                                                                                   |
| `maxOutputTokens`         | `number`                                                                         |          | `4096`             | Maximum tokens in the model response                                                                                                                                                                                                                              |
| `temperature`             | `number`                                                                         |          | `0.7`              | Sampling temperature                                                                                                                                                                                                                                              |
| `logger`                  | `{ error(...): void }`                                                           |          | —                  | Receives internal errors                                                                                                                                                                                                                                          |
| `messages`                | [`Translation`](../reference/api/server/ai/i18n/en/type-aliases/Translation)     |          | English            | Localized error responses and system prompt                                                                                                                                                                                                                       |

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

## Client-side wiring

The server endpoints above are only half the picture. The **Decap CMS admin** needs a client-side
transport that points the chat panel at those endpoints. That transport is
[`@laikacms/decap-cms-llm-dulla`](https://github.com/laikacms/decap-cms/tree/main/extensions/llm/dulla)
— it lives in the `laikacms/decap-cms` fork as `extensions/llm/dulla`.

**`@laikacms/decap-cms-llm-dulla` is not published to npm.** Vendor the source into your project or
reference it as a local workspace dependency from a checkout of the `laikacms/decap-cms` repo:

```sh
# copy the source once
cp -R /path/to/laikacms-decap-cms/extensions/llm/dulla vendor/decap-cms-llm-dulla
```

```json
{
  "dependencies": {
    "@laikacms/decap-cms-llm-dulla": "workspace:*"
  }
}
```

### Register the transport

If you own the app entry point, pass the transport as a prop:

```tsx
import { createDullaTransport } from '@laikacms/decap-cms-llm-dulla';

const llm = createDullaTransport({
  apiBasePath: '/api/ai',
  getToken: () => myAuth.getAccessToken(),
});

<DecapCmsProvider llm={llm}>…</DecapCmsProvider>;
```

If the CMS is initialised before your app code runs (e.g. a pre-built admin bundle), use the global
registration path instead:

```ts
import { registerDulla } from '@laikacms/decap-cms-llm-dulla';

registerDulla({ apiBasePath: '/api/ai' });
```

`apiBasePath` must match the `basePath` you passed to `decapAi()` on the server (default
`'/api/ai'`). With a transport registered an **Assistant** panel appears in the editor and the
locale row gains a translate action for i18n collections.

### Transport options

| Option        | Type                                              | Default   | Purpose                                                  |
| ------------- | ------------------------------------------------- | --------- | -------------------------------------------------------- |
| `apiBasePath` | `string`                                          | `/api/ai` | Must match the server's `basePath`                       |
| `getToken`    | `() => string \| null \| undefined \| Promise<…>` | _(none)_  | Bearer token resolver; omit for cookie/same-origin auth  |
| `fetch`       | `typeof fetch`                                    | global    | Custom `fetch` for proxies, tests, or custom credentials |
| `body`        | `Record<string, unknown>`                         | _(none)_  | Extra fields merged into every `/chat` request body      |
| `onError`     | `(error: Error) => void`                          | _(none)_  | Transport-level errors, alongside the session panel      |

## Client-side tools

`getDocumentData` and `updateDocument` are declared with **no `execute`**, so the SDK ships them to
the browser where the Dulla transport runs them against the open editor draft — see
[client-side wiring](#client-side-wiring) above. Add your own server-side tools through
`config.tools` — those should have an `execute`.

## Authorization

`requiredScope` defaults to `content:write` because the assistant can edit entries. A
[`User`](../reference/api/server/ai/interfaces/User) with no `scopes` is treated as full access,
matching `resolveBearer`'s convention for legacy sessions; populate `scopes` to gate AI access
separately from content access.
