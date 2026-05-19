/**
 * @laikacms/decap-ai
 *
 * AI chat integration for Decap CMS. Bundles the Vercel AI SDK so consumers
 * get a single, shared `ai` runtime — re-export `tool`, model factories, and
 * runtime helpers from this package instead of importing `'ai'` or
 * `'@ai-sdk/*'` directly to avoid duplicate-package brand-symbol mismatches.
 *
 * @example
 * ```typescript
 * import { decapAi, tool, anthropic } from '@laikacms/decap-ai';
 * import { z } from 'zod';
 *
 * const ai = decapAi({
 *   authenticateAccessToken: async (token) => ({ id: '1', email: 'u@x' }),
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   callbacks: { ... },
 *   tools: {
 *     hello: tool({
 *       description: 'say hi',
 *       inputSchema: z.object({}),
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
  lastAssistantMessageIsCompleteWithToolCalls,
  streamText,
  tool,
} from 'ai';

export type { LanguageModel, ToolSet } from 'ai';
