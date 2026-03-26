/**
 * Type definitions for @laikacms/decap-ai
 */

import type { LanguageModel, ToolSet } from 'ai';
import type { Translation } from './i18n/types.js';

/**
 * Default user interface with required fields.
 * Consumers can extend this by declaring the module:
 *
 * @example
 * ```typescript
 * declare module '@laikacms/decap-ai' {
 *   interface User {
 *     role: 'admin' | 'editor';
 *     organizationId: string;
 *   }
 * }
 * ```
 */
export interface User {
  id: string;
  email: string;
  name?: string;
}

/**
 * AI Message - stores the raw UIMessage from Vercel AI SDK v3
 * We store the entire UIMessage object as-is for full fidelity restoration
 */
export interface AiMessage {
  /** The raw UIMessage object from @ai-sdk/react v3 */
  id: string;
  role: 'user' | 'assistant';
  /** v3 format: array of message parts (text, tool calls, etc.) */
  parts: unknown[];
  /** Timestamp when the message was created */
  createdAt?: number;
}

/**
 * AI Chat Session
 * Stores conversation history for a specific document
 */
export interface AiSession {
  id: string;
  /** Document slug/path this session is associated with */
  documentSlug: string;
  /** User ID who owns this session */
  userId: string;
  /** Session title (auto-generated from first message or user-defined) */
  title?: string;
  /** Conversation messages */
  messages: AiMessage[];
  /** Session creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Callbacks for session storage
 * Consumer implements these to persist sessions to their storage (KV, D1, etc.)
 */
export interface AiSessionCallbacks {
  /**
   * Create a new session
   */
  createSession(session: AiSession): Promise<void>;

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Promise<AiSession | null>;

  /**
   * Get all sessions for a document and user
   * Used to show session history in the widget
   */
  getSessionsByDocument(documentSlug: string, userId: string): Promise<AiSession[]>;

  /**
   * Update session messages
   */
  updateSession(sessionId: string, updates: Partial<Pick<AiSession, 'messages' | 'title' | 'updatedAt'>>): Promise<void>;

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): Promise<void>;
}

/**
 * Document context passed to tools
 */
export interface DocumentContext {
  /** Current document data */
  data: Record<string, unknown>;
  /** Document slug/path */
  slug: string;
  /** Document collection name */
  collection?: string;
  /** Document schema (field definitions) */
  schema?: Record<string, unknown>;
}

/**
 * Logger interface (same as decap-api)
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Configuration for decapAi
 */
export interface DecapAiConfig {
  /**
   * Authenticate a Bearer access token and return the user.
   * This should be the same callback used in decap-api.
   */
  authenticateAccessToken: (rawToken: string) => Promise<User>;

  /**
   * LLM model to use (from Vercel AI SDK)
   * Example: openai('gpt-4o'), anthropic('claude-3-5-sonnet-20241022')
   */
  model: LanguageModel;

  /**
   * Session storage callbacks
   */
  callbacks: AiSessionCallbacks;

  /**
   * System prompt for the AI assistant
   * Will be prepended to all conversations
   */
  systemPrompt?: string;

  /**
   * Tools to provide to the AI.
   * Use the standard Vercel AI SDK tool() function to create tools.
   *
   * Client-side tools (getDocumentData, updateDocument) are handled by the widget.
   * Server-side tools should have an execute function.
   *
   * @example
   * ```typescript
   * import { tool } from 'ai';
   * import { z } from 'zod';
   *
   * tools: {
   *   getCmsConfig: tool({
   *     description: 'Get the CMS configuration',
   *     parameters: z.object({}),
   *     execute: async () => ({ configYaml: myConfigYaml }),
   *   }),
   * }
   * ```
   */
  tools?: ToolSet;

  /**
   * Base path for the AI endpoints (default: '/ai')
   */
  basePath?: string;

  /**
   * Maximum output tokens for response (default: 4096)
   */
  maxOutputTokens?: number;

  /**
   * Temperature for response generation (default: 0.7)
   */
  temperature?: number;

  /**
   * Logger instance
   */
  logger?: Logger;

  /**
   * Localized messages for error responses and system prompts.
   * If not provided, defaults to English messages.
   */
  messages?: Translation;
}

/**
 * DecapAi instance returned by decapAi()
 */
export interface DecapAi {
  /**
   * Handle incoming requests
   * Routes to appropriate endpoint based on path
   */
  fetch(request: Request): Promise<Response>;
}

/**
 * Chat request body
 */
export interface ChatRequest {
  /** Session ID (optional - creates new session if not provided) */
  sessionId?: string;
  /** User message */
  message: string;
  /** Document context */
  document: DocumentContext;
}

/**
 * Session list response
 */
export interface SessionListResponse {
  sessions: Array<{
    id: string;
    title?: string;
    documentSlug: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
  }>;
}

/**
 * Session detail response
 */
export interface SessionDetailResponse {
  session: AiSession;
}
