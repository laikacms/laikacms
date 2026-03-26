/**
 * @laikacms/decap-ai
 * 
 * AI chat backend for Decap CMS with LLM-agnostic support and document manipulation tools.
 * 
 * @example
 * ```typescript
 * import { decapAi } from '@laikacms/decap-ai';
 * import { openai } from '@ai-sdk/openai';
 * 
 * const ai = decapAi({
 *   authenticateAccessToken: async (token) => {
 *     // Your authentication logic (same as decap-api)
 *     return { id: 'user-1', email: 'user@example.com' };
 *   },
 *   model: openai('gpt-4o'),
 *   callbacks: {
 *     createSession: async (session) => { ... },
 *     getSession: async (sessionId) => { ... },
 *     getSessionsByDocument: async (slug, userId) => { ... },
 *     updateSession: async (sessionId, updates) => { ... },
 *     deleteSession: async (sessionId) => { ... },
 *   },
 *   systemPrompt: 'You are a helpful CMS assistant...',
 * });
 * 
 * // In your worker/server
 * export default {
 *   fetch: ai.fetch,
 * };
 * ```
 */

// Main export
export { decapAi, default } from './decap-ai.js';

// Types
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

// Tools (for custom tool creation)
export { documentTools } from './tools/index.js';

// i18n exports
export type { Translation, TranslationKey } from './i18n/types.js';
