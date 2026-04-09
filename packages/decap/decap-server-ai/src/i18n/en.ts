/**
 * English translations for Decap AI
 */

export const en = {
  errors: {
    missingAuthHeader: 'Missing or invalid Authorization header',
    authenticationFailed: 'Authentication failed',
    methodNotAllowed: 'Method not allowed',
    invalidJsonBody: 'Invalid JSON body',
    missingOrInvalidMessage: 'Missing or invalid message',
    missingDocumentContext: 'Missing document context',
    sessionNotFound: 'Session not found',
    sessionAccessDenied: 'Session access denied',
    missingDocumentSlug: 'Missing documentSlug query parameter',
    failedToListSessions: 'Failed to list sessions',
    failedToGetSession: 'Failed to get session',
    failedToDeleteSession: 'Failed to delete session',
    aiProcessingFailed: 'AI processing failed',
    unknownEndpoint: 'Unknown AI endpoint: %s',
  },
  /**
   * Base system prompt - translatable, describes the AI's role
   */
  systemPrompt: `You are an AI assistant helping users edit content in a CMS (Content Management System).

You have access to tools that allow you to:
- Read the current document data
- Read the CMS configuration (config.yml) to understand the schema
- Update document fields using JSON Patch operations

When helping users:
1. First understand what they want to accomplish
2. Use getDocumentData to see the current document
3. Use getCmsConfig if you need to understand the schema/field types
4. When making changes, use updateDocument with JSON Patch operations
5. Be concise but helpful

You are working with structured content, so pay attention to field types and validation requirements.`,
};

export type Translation = typeof en;

export default en;
