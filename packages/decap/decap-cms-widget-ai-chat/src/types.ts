/**
 * Type definitions for @laikacms/decap-cms-widget-ai-chat
 */

import type { Translation } from './i18n/types';

/**
 * Session summary for the session list
 */
export interface SessionSummary {
  id: string;
  title?: string;
  documentSlug: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * AI Message
 */
export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: number;
  toolInvocations?: ToolInvocation[];
}

/**
 * Tool invocation
 */
export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  state: 'pending' | 'result' | 'error';
}

/**
 * AI Session
 */
export interface AiSession {
  id: string;
  documentSlug: string;
  userId: string;
  title?: string;
  messages: AiMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Serialized CMS config for AI context
 */
export interface SerializedCmsConfig {
  collections?: Array<{
    name: string,
    label?: string,
    fields?: unknown[],
  }>;
  backend?: string;
}

/**
 * Document context for the AI
 */
export type DocumentContext = {
  data: string, // JSON string of the document data, truncated if necessary
  '$dataTruncatedToMaxLength'?: number, // Indicates if the data was truncated
  slug: string,
  collection?: string,
  schema?: string, // JSON string of the collection schema, truncated if necessary
  '$schemaTruncatedToMaxLength'?: number, // Indicates if the schema was truncated
  locale?: string, // Current locale being edited (for i18n support)
};

/**
 * AI SDK configuration options for the widget
 */
export interface AiSdkOptions {
  /** The API endpoint base path (e.g., '/api/v1/ai') */
  api?: string;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Extra body to send with requests */
  body?: Record<string, unknown>;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Finish callback */
  onFinish?: (event: unknown) => void;
}

/**
 * Configuration for the AI Chat widget
 * These options are passed via the Decap CMS field configuration
 */
export interface AiChatWidgetOptions {
  aiSdk?: AiSdkOptions;
  /** Localized messages for the widget UI */
  messages?: Translation;
}

/**
 * Chat API request body
 */
export interface ChatRequest {
  sessionId?: string;
  message: string;
  document: DocumentContext;
}

/**
 * Session list API response
 */
export interface SessionListResponse {
  sessions: SessionSummary[];
}

/**
 * Session detail API response
 */
export interface SessionDetailResponse {
  session: AiSession;
}
