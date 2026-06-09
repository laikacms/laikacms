# @laikacms/decap-ai

AI chat integration for Decap CMS. Provides a runtime-agnostic server adapter, a React widget, model
provider re-exports, and document-manipulation tools — all bundled with their own Vercel AI SDK
runtime so consumers stay decoupled from the underlying `ai` and `@ai-sdk/*` packages.

## Install

```bash
pnpm add @laikacms/decap-ai
```

Peer dependencies (install what you use):

```bash
pnpm add react react-dom decap-cms-core decap-cms-lib-util decap-cms-ui-default react-redux
```

## Exports

| Sub-path                               | Purpose                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `@laikacms/decap-ai`                   | `decapAi()` server adapter factory + Vercel AI SDK re-exports                         |
| `@laikacms/decap-ai/tools`             | Built-in client-side document tools (`getDocumentData`, `updateDocument`)             |
| `@laikacms/decap-ai/providers`         | Model provider re-exports (`anthropic`, `openai` and their factories)                 |
| `@laikacms/decap-ai/widget`            | React widget components (`WidgetAiChat`, `AiChatControl`, `AiChatPreview`, `useChat`) |
| `@laikacms/decap-ai/widget/i18n/types` | TypeScript types for widget translation strings                                       |
| `@laikacms/decap-ai/widget/i18n/en`    | English widget UI strings                                                             |
| `@laikacms/decap-ai/widget/i18n/nl`    | Dutch widget UI strings                                                               |
| `@laikacms/decap-ai/i18n/types`        | TypeScript types for server-side translation strings                                  |
| `@laikacms/decap-ai/i18n/en`           | English server-side strings (errors, system prompt)                                   |
| `@laikacms/decap-ai/i18n/nl`           | Dutch server-side strings                                                             |

## Usage

### Server adapter

`decapAi()` returns a `{ fetch(request: Request): Promise<Response> }` handler that you mount at an
API route. It exposes three endpoints:

| Method | Path                      | Description                  |
| ------ | ------------------------- | ---------------------------- |
| GET    | `{basePath}/health`       | Health check (no auth)       |
| POST   | `{basePath}/chat`         | Stream an AI response        |
| GET    | `{basePath}/sessions`     | List sessions for a document |
| GET    | `{basePath}/sessions/:id` | Get a single session         |
| DELETE | `{basePath}/sessions/:id` | Delete a session             |

```typescript
import { decapAi } from '@laikacms/decap-ai';
import { tool } from '@laikacms/decap-ai';
import { anthropic } from '@laikacms/decap-ai/providers';
import { z } from 'zod';

const ai = decapAi({
  // Validate Bearer tokens — same callback as decap-api
  authenticateAccessToken: async token => {
    const user = await myAuth.verify(token);
    return { id: user.sub, email: user.email };
  },

  // Any Vercel AI SDK LanguageModel
  model: anthropic('claude-3-5-sonnet-20241022'),

  // Session persistence — implement with any storage (KV, DynamoDB, D1, …)
  callbacks: {
    createSession: async session => kv.put(session.id, session),
    getSession: async id => kv.get(id),
    getSessionsByDocument: async (slug, userId) => kv.list({ prefix: `${slug}:${userId}:` }),
    updateSession: async (id, updates) => kv.patch(id, updates),
    deleteSession: async id => kv.delete(id),
  },

  // Optional: additional server-side tools
  tools: {
    getCmsConfig: tool({
      description: 'Return the raw CMS config YAML',
      inputSchema: z.object({}),
      execute: async () => ({ configYaml: myCmsConfig }),
    }),
  },
});

// Mount in your framework of choice (Next.js, Hono, Cloudflare Workers, …)
export async function POST(request: Request) {
  return ai.fetch(request);
}
```

### Widget (React / Decap CMS)

Register the AI chat widget with Decap CMS so editors can chat with the AI from inside the editor
sidebar:

```typescript
import WidgetAiChat from '@laikacms/decap-ai/widget';
import nl from '@laikacms/decap-ai/widget/i18n/nl';
import CMS from 'decap-cms-app';

CMS.registerWidget(
  WidgetAiChat.Widget({
    aiSdk: { api: '/api/ai' }, // base path served by your decapAi adapter
    messages: nl, // optional: override default English strings
  }),
);
```

The widget exports `AiChatControl` and `AiChatPreview` separately if you need to compose them
manually.

## Model provider configuration

Import providers from `@laikacms/decap-ai/providers` — **not** from `@ai-sdk/anthropic` or
`@ai-sdk/openai` directly. This ensures all parts of the package share the same physical `ai`
runtime and avoids branded-type mismatches.

```typescript
import { anthropic, createAnthropic } from '@laikacms/decap-ai/providers';
import { createOpenAI, openai } from '@laikacms/decap-ai/providers';

// Anthropic
const model = anthropic('claude-3-5-sonnet-20241022');

// OpenAI
const model = openai('gpt-4o');

// Custom endpoint (e.g., Azure OpenAI, Ollama)
const myOpenAI = createOpenAI({ baseURL: 'https://…', apiKey: '…' });
const model = myOpenAI('my-deployment');
```

## AI SDK re-exports

The root export re-exports several helpers from `ai` so you never need to import the `ai` package
directly:

```typescript
import {
  convertToModelMessages,
  generateId,
  isTextUIPart,
  isToolUIPart,
  streamText,
  tool,
} from '@laikacms/decap-ai';
```

## i18n

The package ships English and Dutch translations for both the server adapter and the widget.

### Server-side strings

```typescript
import nl from '@laikacms/decap-ai/i18n/nl';
import type { Translation } from '@laikacms/decap-ai/i18n/types';

const ai = decapAi({ messages: nl, … });
```

The `Translation` type covers `errors.*` keys and the default `systemPrompt`.

### Widget strings

```typescript
import nl from '@laikacms/decap-ai/widget/i18n/nl';
import type { Translation } from '@laikacms/decap-ai/widget/i18n/types';

WidgetAiChat.Widget({ messages: nl, … });
```

## Extending the `User` type

By default `User` carries `{ id, email, name? }`. Add fields via module augmentation:

```typescript
declare module '@laikacms/decap-ai' {
  interface User {
    role: 'admin' | 'editor';
    organizationId: string;
  }
}
```
