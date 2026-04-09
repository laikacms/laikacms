/**
 * English translations for AI Chat Widget
 */

export const en = {
  aiAssistant: 'AI Assistant',
  newConversation: 'New conversation',
  newButton: '+ New',
  session: 'Session',
  startConversation: 'Start a conversation',
  defaultWelcomeMessage:
    'Hello! I can help you edit this document. Ask me anything about the content or request changes.',
  defaultPlaceholder: 'Ask the AI assistant...',
  aiThinking: 'AI is thinking...',
  error: 'Error',
  send: 'Send',
  failedToLoadSession: 'Failed to load session',
  failedToSendMessage: 'Failed to send message',
  failedToApplyPatch: 'Failed to apply patch - no new document generated',
  unknownErrorApplyingPatch: 'Unknown error applying patch',
};

/**
 * Translation type derived from the English translations structure
 */
export type Translation = typeof en;

export default en;
