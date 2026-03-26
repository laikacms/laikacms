/**
 * Main decap-ai implementation
 * Provides AI chat functionality for Decap CMS with document manipulation tools
 * 
 * This implementation is designed to be compatible with the Vercel AI SDK.
 * Tools are passed directly from the consumer using the standard tool() function.
 */

import { generateId, streamText, convertToModelMessages, type ToolSet } from 'ai';
import { Header } from '@laikacms/core';
import { documentTools } from './tools/document-tools.js';
import en from './i18n/en.js'
import type {
  AiMessage,
  AiSession,
  DecapAi,
  DecapAiConfig,
  SessionDetailResponse,
  SessionListResponse,
  User
} from './types.js';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
} as const;

function errorResponse(error: string, status: number = 400): Response {
  return new Response(JSON.stringify({ error }), { status, headers: SECURITY_HEADERS });
}

function normalizePath(path: string): string {
  let normalized = path.replace(/\/+$/, '');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return normalized;
}

function generateSessionTitle(message: string): string {
  const maxLength = 50;
  if (message.length <= maxLength) return message;
  const truncated = message.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + '...';
}

/**
 * Extract text content from a UIMessage (v3 format with parts array)
 * Falls back to content string for backwards compatibility
 */
function getMessageText(message: any): string | undefined {
  // New v3 format: parts array with { type: 'text', text: string }
  if (message.parts && Array.isArray(message.parts)) {
    const textParts = message.parts
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text);
    return textParts.length > 0 ? textParts.join('') : undefined;
  }
  // Old format: content string
  if (typeof message.content === 'string') {
    return message.content;
  }
  return undefined;
}

export function decapAi(config: DecapAiConfig): DecapAi {
  const basePath = normalizePath(config.basePath ?? '/ai');
  const t = config.messages ?? en;
  const systemPrompt = config.systemPrompt ?? t.systemPrompt;
  const maxOutputTokens = config.maxOutputTokens ?? 4096;
  const temperature = config.temperature ?? 0.7;

  const chatEndpoint = `${basePath}/chat`;
  const sessionsEndpoint = `${basePath}/sessions`;
  const sessionDetailPattern = new RegExp(`^${basePath}/sessions/([^/]+)$`);

  async function authenticateRequest(request: Request): Promise<User | Response> {
    const token = Header.ExtractAuthorizationBearerToken(request.headers.get('Authorization'));
    if (!token) return errorResponse(t.errors.missingAuthHeader, 401);
    try {
      return await config.authenticateAccessToken(token);
    } catch {
      return errorResponse(t.errors.authenticationFailed, 401);
    }
  }

  /**
   * Handle POST /ai/chat
   * Uses Vercel AI SDK's convertToCoreMessages for standard message handling
   */
  async function handleChat(request: Request, user: User): Promise<Response> {
    if (request.method !== 'POST') return errorResponse(t.errors.methodNotAllowed, 405);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return errorResponse(t.errors.invalidJsonBody, 400);
    }

    // Vercel AI SDK format: { messages: [...], sessionId?, document }
    if (!body.messages || !Array.isArray(body.messages)) {
      return errorResponse(t.errors.missingOrInvalidMessage, 400);
    }

    const { sessionId, document } = body;
    if (!document?.slug) return errorResponse(t.errors.missingDocumentContext, 400);

    // Get last user message for session title (supports both v3 parts format and legacy content format)
    const userMessages = body.messages.filter((m: any) => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    const lastUserMessageText = lastUserMessage ? getMessageText(lastUserMessage) : undefined;
    if (!lastUserMessageText) return errorResponse(t.errors.missingOrInvalidMessage, 400);

    // Get or create session
    let session: AiSession;
    const now = Date.now();

    if (sessionId) {
      const existing = await config.callbacks.getSession(sessionId);
      if (!existing) return errorResponse(t.errors.sessionNotFound, 404);
      if (existing.userId !== user.id) return errorResponse(t.errors.sessionAccessDenied, 403);
      session = existing;
    } else {
      session = {
        id: generateId(),
        documentSlug: document.slug,
        userId: user.id,
        title: generateSessionTitle(lastUserMessageText),
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      await config.callbacks.createSession(session);
    }

    // Merge client-side document tools with consumer-provided tools
    // Client-side tools (no execute) will be handled by the widget's onToolCall
    const tools: ToolSet = {
      ...documentTools,
      ...config.tools,
    };

    // Use Vercel AI SDK's convertToModelMessages - handles tool calls/results automatically
    // Pass tools so it can properly convert tool calls and results
    // ignoreIncompleteToolCalls: false ensures tool results are properly processed
    const modelMessages = await convertToModelMessages(body.messages, {
      tools,
    });

    try {
      const result = streamText({
        model: config.model,
        system: systemPrompt,
        messages: modelMessages,
        tools,
        maxOutputTokens,
        temperature,
      });

      // Consume stream to ensure it completes even if client disconnects
      result.consumeStream();

      // Use SDK's built-in message handling - onFinish receives complete UIMessages
      const response = result.toUIMessageStreamResponse({
        originalMessages: body.messages,
        onFinish: async ({ messages }) => {
          // messages is the complete conversation including AI response as UIMessage[]
          await config.callbacks.updateSession(session.id, {
            messages: messages as AiMessage[],
            updatedAt: Date.now(),
          });
        },
      });

      const headers = new Headers(response.headers);
      headers.set('X-Session-Id', session.id);
      headers.set('X-Content-Type-Options', 'nosniff');

      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      config.logger?.error('AI chat error:', error);
      return errorResponse(t.errors.aiProcessingFailed, 500);
    }
  }

  async function handleListSessions(request: Request, user: User): Promise<Response> {
    if (request.method !== 'GET') return errorResponse(t.errors.methodNotAllowed, 405);

    const url = new URL(request.url);
    const documentSlug = url.searchParams.get('documentSlug');
    if (!documentSlug) return errorResponse(t.errors.missingDocumentSlug, 400);

    try {
      const sessions = await config.callbacks.getSessionsByDocument(documentSlug, user.id);
      const response: SessionListResponse = {
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          documentSlug: s.documentSlug,
          messageCount: s.messages.length,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      };
      return new Response(JSON.stringify(response), { status: 200, headers: SECURITY_HEADERS });
    } catch {
      return errorResponse(t.errors.failedToListSessions, 500);
    }
  }

  async function handleSessionDetail(request: Request, user: User, sessionId: string): Promise<Response> {
    if (request.method === 'GET') {
      try {
        const session = await config.callbacks.getSession(sessionId);
        if (!session) return errorResponse(t.errors.sessionNotFound, 404);
        if (session.userId !== user.id) return errorResponse(t.errors.sessionAccessDenied, 403);
        const response: SessionDetailResponse = { session };
        return new Response(JSON.stringify(response), { status: 200, headers: SECURITY_HEADERS });
      } catch {
        return errorResponse(t.errors.failedToGetSession, 500);
      }
    }

    if (request.method === 'DELETE') {
      try {
        const session = await config.callbacks.getSession(sessionId);
        if (!session) return errorResponse(t.errors.sessionNotFound, 404);
        if (session.userId !== user.id) return errorResponse(t.errors.sessionAccessDenied, 403);
        await config.callbacks.deleteSession(sessionId);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: SECURITY_HEADERS });
      } catch {
        return errorResponse(t.errors.failedToDeleteSession, 500);
      }
    }

    return errorResponse(t.errors.methodNotAllowed, 405);
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = normalizePath(url.pathname);

      // Health check (no auth)
      if (pathname === `${basePath}/health`) {
        return new Response(
          JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
          { status: 200, headers: SECURITY_HEADERS }
        );
      }

      const authResult = await authenticateRequest(request);
      if (authResult instanceof Response) return authResult;
      const user = authResult;

      if (pathname === chatEndpoint) return handleChat(request, user);
      if (pathname === sessionsEndpoint) return handleListSessions(request, user);

      const sessionMatch = pathname.match(sessionDetailPattern);
      if (sessionMatch) return handleSessionDetail(request, user, sessionMatch[1]);

      return errorResponse(t.errors.unknownEndpoint.replace('%s', pathname), 404);
    },
  };
}

export default decapAi;
