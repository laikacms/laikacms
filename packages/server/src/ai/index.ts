/**
 * @laikacms/server/ai
 *
 * The chat/session HTTP surface behind Decap CMS's assistant: a
 * `fetch(Request) => Response` handler with `POST {base}/chat` plus session
 * list/detail endpoints. It pairs with the `Dulla` transport shipped by
 * laikacms/decap-cms, which implements the CMS's `LlmTransport` interface
 * against these endpoints and executes the document tools client-side.
 *
 * The Vercel AI SDK is an optional peer: install `ai` (and a provider such as
 * `@ai-sdk/anthropic`) to use this module. Re-export `tool`, model factories
 * and runtime helpers from here rather than importing `'ai'` directly, so
 * there is a single physical `ai` package and the branded schema/tool types
 * stay consistent.
 *
 * @example
 * ```typescript
 * import { decapAi, jsonSchema, tool } from '@laikacms/server/ai';
 * import { anthropic } from '@laikacms/server/ai/providers';
 *
 * // authenticateAccessToken routes through the resolveBearer seam in
 * // laikacms/auth and forwards its scopes:
 * //   const ctx = await resolveBearer(token, { verifySessionToken, lookupPatByHash });
 * //   if (!ctx) throw new Error('Unauthorized');
 * //   return { ...ctx.user, scopes: ctx.scopes };
 * const ai = decapAi({
 *   authenticateAccessToken: async (token) => ({ id: '1', email: 'u@x' }),
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   callbacks: { ... },
 *   tools: {
 *     hello: tool({
 *       description: 'say hi',
 *       inputSchema: jsonSchema({
 *         type: 'object',
 *         properties: {},
 *         additionalProperties: false,
 *       }),
 *       execute: async () => ({ greeting: 'hi' }),
 *     }),
 *   },
 * });
 * ```
 */

export { decapAi, default } from './decap-ai.js';

export type {
  AiMessage,
  AiSession,
  AiSessionCallbacks,
  ChatRequest,
  DecapAi,
  DecapAiConfig,
  DocumentContext,
  Logger,
  SessionDetailResponse,
  SessionListResponse,
  User,
} from './types.js';

export { documentTools } from './tools/index.js';

export type { Translation, TranslationKey } from './i18n/types.js';

// ---------------------------------------------------------------------------
// Re-exports from the AI SDK runtime so consumers do not import `ai` or
// `@ai-sdk/*` directly. This guarantees a single physical `ai` package in the
// consumer's node_modules and keeps the branded schema/tool types consistent.
// ---------------------------------------------------------------------------

export {
  convertToModelMessages,
  DefaultChatTransport,
  generateId,
  isTextUIPart,
  isToolUIPart,
  jsonSchema,
  lastAssistantMessageIsCompleteWithToolCalls,
  streamText,
  tool,
} from 'ai';

export type { LanguageModel, ToolSet } from 'ai';
