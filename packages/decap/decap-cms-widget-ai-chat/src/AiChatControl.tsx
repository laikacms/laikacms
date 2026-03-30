import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connect } from 'react-redux';
import type { CmsWidgetControlProps } from "decap-cms-core";
import { css } from '@emotion/css';
import { useChat, type UIMessage } from '@ai-sdk/react';
import { DefaultChatTransport, isTextUIPart, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { applyPatch, type Operation } from 'fast-json-patch';
import type { AiChatWidgetOptions, SessionSummary, DocumentContext } from "./types";
import { changeDraftField, selectFields, type I18nInfo } from "./utils";
import type { EditorialWorkflow, Entries, State } from "decap-cms-core/types/redux";
import { fromJS, type List, type Map } from "immutable";
import { getI18nInfo } from "./utils";
import en from './i18n/nl'

// Styles
const containerStyles = css`
  display: flex;
  flex-direction: column;
  border: 1px solid #dfdfe3;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  margin-top: -26px;
  position: relative;
`;

const headerStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #dfdfe3;
`;

const headerTitleStyles = css`
  font-weight: 600;
  font-size: 14px;
  color: #333;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const sessionSelectStyles = css`
  padding: 6px 12px;
  border: 1px solid #dfdfe3;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
  
  &:hover {
    border-color: #3a69c7;
  }
`;

const newSessionButtonStyles = css`
  padding: 6px 12px;
  background: #3a69c7;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  
  &:hover {
    background: #2d5299;
  }
`;

const messagesContainerStyles = css`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const messageStyles = css`
  padding: 12px 16px;
  border-radius: 8px;
  max-width: 85%;
  font-size: 14px;
  line-height: 1.5;
  
  &.user {
    background: #3a69c7;
    color: #fff;
    align-self: flex-end;
    border-bottom-right-radius: 4px;
  }
  
  &.assistant {
    background: #f1f3f4;
    color: #333;
    align-self: flex-start;
    border-bottom-left-radius: 4px;
  }
  
  pre {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 8px 0;
    font-size: 13px;
  }
  
  code {
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 13px;
  }
  
  pre code {
    background: none;
    padding: 0;
  }
`;

const toolCallStyles = css`
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  padding: 8px 12px;
  margin: 8px 0;
  font-size: 12px;
  
  .tool-name {
    font-weight: 600;
    color: #856404;
  }
  
  .tool-result {
    margin-top: 4px;
    padding: 4px 8px;
    background: #fff;
    border-radius: 2px;
    font-family: monospace;
    font-size: 11px;
    max-height: 100px;
    overflow-y: auto;
  }
`;

const inputContainerStyles = css`
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #dfdfe3;
  background: #f8f9fa;
`;

const inputStyles = css`
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #dfdfe3;
  border-radius: 6px;
  font-size: 14px;
  resize: none;
  min-height: 40px;
  max-height: 120px;
  
  &:focus {
    outline: none;
    border-color: #3a69c7;
    box-shadow: 0 0 0 2px rgba(58, 105, 199, 0.2);
  }
  
  &:disabled {
    background: #e9ecef;
    cursor: not-allowed;
  }
`;

const sendButtonStyles = css`
  padding: 10px 20px;
  background: #3a69c7;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  
  &:hover:not(:disabled) {
    background: #2d5299;
  }
  
  &:disabled {
    background: #a0a0a0;
    cursor: not-allowed;
  }
`;

const loadingStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  color: #666;
  font-size: 13px;
  
  .dot {
    width: 6px;
    height: 6px;
    background: #3a69c7;
    border-radius: 50%;
    animation: bounce 1.4s infinite ease-in-out both;
    
    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
  
  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0); }
    40% { transform: scale(1); }
  }
`;

const emptyStateStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #666;
  text-align: center;
  
  .icon {
    font-size: 48px;
    margin-bottom: 16px;
  }
  
  h3 {
    margin: 0 0 8px;
    font-size: 16px;
    color: #333;
  }
  
  p {
    margin: 0;
    font-size: 14px;
  }
`;

export interface AiChatControlProps extends CmsWidgetControlProps<never> {
  widget: AiChatWidgetOptions;
  config: any; // Decap config
  dispatch: (action: any) => any;
  collection: Map<string, any>;
  entry: Map<string, any>;
  metadata: Record<string, unknown>;
  locale: string | undefined;
}

export interface AiChatControlPropsAfterConnect extends AiChatControlProps {
  unPublishedEntry?: Map<string, any> | undefined;
  publishedEntry?: Map<string, any> | undefined;
  fields?: List<Map<string, any>> | undefined;
}

/**
 * Get the data path for a specific locale
 * For the default locale, data is at 'data'
 * For other locales, data is at 'i18n.<locale>.data'
 */
function getLocaleData(entry: any, locale: string | undefined, defaultLocale: string | undefined): any {
  if (!locale || !defaultLocale || locale === defaultLocale) {
    // Default locale - data is directly in 'data'
    return entry?.get?.('data')?.toJS?.() || {};
  }
  
  // Non-default locale - data is in 'i18n.<locale>.data'
  const i18nData = entry?.get?.('i18n');
  if (i18nData) {
    const localeEntry = i18nData.get?.(locale);
    if (localeEntry) {
      // The locale data is nested under 'data' key within the locale entry
      const localeData = localeEntry.get?.('data');
      if (localeData) {
        return localeData.toJS?.() || localeData || {};
      }
      // Fallback: maybe the data is directly on the locale entry (older format)
      return localeEntry.toJS?.() || localeEntry || {};
    }
  }
  
  // Fallback to default data if locale-specific data not found
  return entry?.get?.('data')?.toJS?.() || {};
}

/**
 * Get current document context from Decap CMS
 */
function getDocumentContext(entry: any, locale: string | undefined, defaultLocale: string | undefined): DocumentContext {
  const data = getLocaleData(entry, locale, defaultLocale);
  const slug = entry?.get?.('slug') || 'untitled';
  const collection = entry?.get?.('collection') || undefined;

  return {
    data,
    slug,
    collection,
    locale,
  };
}

/**
 * Extract text content from UIMessage parts
 */
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map(part => part.text)
    .join('');
}

/**
 * Extract tool invocations from UIMessage parts
 */
function getToolParts(message: UIMessage): Array<{ toolCallId: string; toolName: string; state: string; output?: unknown }> {
  return message.parts
    .filter(isToolUIPart)
    .map(part => ({
      toolCallId: part.toolCallId,
      toolName: part.type.replace('tool-', ''),
      state: part.state,
      output: 'output' in part ? part.output : undefined,
    }));
}

/**
 * Component for rendering text parts
 */
interface TextPartProps {
  text: string;
}

const TextPart: React.FC<TextPartProps> = ({ text }) => {
  return <span>{text}</span>;
};

/**
 * Component for rendering tool invocation parts
 */
interface ToolInvocationPartProps {
  toolCallId: string;
  toolName: string;
  state: string;
  output?: unknown;
}

const ToolInvocationPart: React.FC<ToolInvocationPartProps> = ({ toolCallId, toolName, state, output }) => {
  return (
    <div className={toolCallStyles}>
      <div className="tool-name">
        🔧 {toolName}
      </div>
      {state === 'output-available' && output != null ? (
        <div className="tool-result">
          {JSON.stringify(output, null, 2)}
        </div>
      ) : state === 'output-error' ? (
        <div className="tool-result" style={{ color: '#dc3545' }}>
          Error: {JSON.stringify(output, null, 2)}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Check if a part type is a tool invocation (type starts with 'tool-')
 */
function isToolInvocationPart(part: any): boolean {
  return part.type?.startsWith('tool-') && part.type !== 'text';
}

/**
 * Extract tool name from part type (e.g., 'tool-updateDocument' -> 'updateDocument')
 */
function getToolNameFromPart(part: any): string {
  if (part.type?.startsWith('tool-')) {
    return part.type.slice(5); // Remove 'tool-' prefix
  }
  return part.toolName || 'Unknown tool';
}

/**
 * Render a single message part based on its type
 */
const MessagePart: React.FC<{ part: any; index: number }> = ({ part, index }) => {
  if (part.type === 'text') {
    return <TextPart key={index} text={part.text} />;
  }
  // Handle tool invocations - both v3 format (type: 'tool-{toolName}') and legacy format (type: 'tool-invocation')
  if (isToolInvocationPart(part)) {
    // v3 format: tool data is directly on the part
    // Legacy format: tool data is in part.toolInvocation
    const toolCallId = part.toolCallId || part.toolInvocation?.toolCallId || '';
    const toolName = getToolNameFromPart(part) || part.toolInvocation?.toolName || 'Unknown tool';
    const state = part.state || part.toolInvocation?.state || '';
    const output = part.output ?? part.toolInvocation?.output;
    
    return (
      <ToolInvocationPart
        key={toolCallId || index}
        toolCallId={toolCallId}
        toolName={toolName}
        state={state}
        output={output}
      />
    );
  }
  return null;
};

const AiChatControl: React.FC<AiChatControlPropsAfterConnect> = (props) => {
  const { field, fields, locale, entry, widget, config, metadata, dispatch, collection } = props;
  console.log('AiChatControl props', props);

  // Get messages - use widget messages if provided, otherwise use defaults
  const t = widget.messages ?? en;
  
  // Get i18n info for locale handling
  const i18nInfo = useMemo(() => getI18nInfo(collection), [collection]);
  const defaultLocale = (i18nInfo as I18nInfo).defaultLocale;
  
  const placeholder = field.get('placeholder') as string || t.defaultPlaceholder;
  const welcomeMessage = field.get('welcomeMessage') as string || t.defaultWelcomeMessage;
  const maxHeight = field.get('maxHeight') as string || '500px';
  
  // The api option should be the base path (e.g., '/api/v1/ai')
  // useChat sends to `${api}` directly, so we need to append /chat
  const apiBasePath = widget.aiSdk?.api || '/api/v1/ai';
  const chatEndpoint = `${apiBasePath}/chat`;
  const sessionsEndpoint = apiBasePath;

  // State
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');

  // Get document context with locale-aware data
  const documentContext = useMemo(() => getDocumentContext(entry, locale, defaultLocale), [entry, locale, defaultLocale]);

  console.log('Document context for AI', documentContext);

  const aiFetch = widget.aiSdk?.fetch || fetch;

  // Reference to entry for tool calls
  const entryRef = useRef(entry);
  entryRef.current = entry;

  // Create transport with dynamic body that includes sessionId and document context
  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: chatEndpoint,
      fetch: aiFetch,
      body: () => ({
        ...widget.aiSdk?.body,
        sessionId: currentSessionId,
        document: documentContext,
      }),
    });
  }, [chatEndpoint, aiFetch, widget.aiSdk?.body, currentSessionId, documentContext]);

  // Chat hook from Vercel AI SDK v3
  const chatHelpers = useChat({
    transport,
    onToolCall: ({ toolCall }: { toolCall: any }) => {
      // Get current document data - use locale-aware data retrieval
      const currentData = getLocaleData(entryRef.current, locale, defaultLocale);
      const slug = entryRef.current?.get?.('slug') || 'untitled';
      const collectionName = entryRef.current?.get?.('collection') || undefined;

      // Handle tool calls and provide results
      const toolName = toolCall.toolName || (toolCall.type ? toolCall.type.replace('tool-', '') : 'unknown');
      const toolCallId = toolCall.toolCallId;
      const args = toolCall.input || toolCall.args || {};

      console.log('Tool call received:', { toolName, toolCallId, args, locale, defaultLocale });

      // Use addToolOutput (v3 API) to provide tool results
      const addOutput = (output: any) => {
        console.log('Adding tool output:', { toolName, toolCallId, output });
        chatHelpers.addToolOutput({
          tool: toolName as any,
          toolCallId,
          state: 'output-available',
          output,
        });
      };

      switch (toolName) {
        case 'getDocumentData': {
          const result = {
            success: true,
            slug,
            collection: collectionName,
            locale,
            data: currentData,
          };
          console.log('getDocumentData result:', result);
          addOutput(result);
          break;
        }

        case 'updateDocument': {
          const operations = (args as { operations?: Operation[] })?.operations || [];
          
          try {
            // Apply JSON Patch operations to get the new document
            const result = applyPatch(currentData, operations, true, false);

            console.log('Update document tool call', { currentData, operations, result });
            
            if (result.newDocument) {
              Object.keys(result.newDocument).forEach((key) => {
                const rawValue = result.newDocument[key];
                const hasChanges = operations.some(op => op.path.startsWith(`/${key}`));
                if (!hasChanges) {
                  console.log(`Field "${key}" has no changes, skipping update`);
                  return;
                }
                const thisField = fields?.find(f => f.get('name') === key);
                if (!thisField) {
                  console.warn(`Field "${key}" not found in collection schema, skipping update`);
                  return;
                }
                // Convert plain JS objects/arrays to Immutable structures
                // Decap CMS expects Immutable data for nested fields like lists
                const value = (typeof rawValue === 'object' && rawValue !== null)
                  ? fromJS(rawValue)
                  : rawValue;
                // Use the current entry which contains both default data and i18n data
                // This matches the structure expected by DRAFT_CHANGE_FIELD action
                const entries = [entryRef.current].filter(Boolean) as Map<string, any>[];
                const i18nInfoForAction = getI18nInfo(collection);
                const i18n = {
                  currentLocale: locale,
                  defaultLocale: (i18nInfoForAction as I18nInfo).defaultLocale,
                  locales: (i18nInfoForAction as I18nInfo).locales
                }
                const action = changeDraftField({ field: thisField, value, metadata, entries, i18n });
                console.log('Dispatching DRAFT_CHANGE_FIELD action:', action);
                dispatch(action);
              });

              addOutput({ success: true });
            } else {
              addOutput({
                success: false,
                error: t.failedToApplyPatch,
              });
            }
          } catch (err) {
            addOutput({
              success: false,
              error: err instanceof Error ? err.message : t.unknownErrorApplyingPatch,
            });
          }
          break;
        }

        default:
          // Unknown tool - provide error output so AI knows the tool doesn't exist
          console.warn(`Unknown tool: ${toolName}`);
          chatHelpers.addToolOutput({
            tool: toolName as any,
            toolCallId,
            state: 'output-error',
            errorText: `Unknown tool: "${toolName}". Available tools are: getDocumentData, updateDocument.`,
          });
          break;
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      widget.aiSdk?.onError?.(err);
    },
    // Automatically continue after tool calls are completed
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const { messages, sendMessage, status, setMessages } = chatHelpers;

  const isLoading = status === 'submitted' || status === 'streaming';

  // Fetch sessions for this document
  const fetchSessions = useCallback(async () => {
    if (!documentContext.slug) return;

    setIsLoadingSessions(true);
    try {
      const response = await aiFetch(
        `${sessionsEndpoint}/sessions?documentSlug=${encodeURIComponent(documentContext.slug)}`
      );

      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [documentContext.slug, aiFetch, sessionsEndpoint]);

  // Load sessions on mount
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Load session messages when session changes
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const response = await aiFetch(`${sessionsEndpoint}/sessions/${sessionId}`);

      if (response.ok) {
        const data = await response.json();
        const session = data.session;

        console.log('Loading session:', session);

        // Messages are stored in v3 UIMessage format with parts array - use directly
        const chatMessages: UIMessage[] = session.messages.map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          parts: m.parts || [],
        }));

        console.log('Loaded messages:', chatMessages);

        setMessages(chatMessages);
        setCurrentSessionId(sessionId);
      } else {
        console.error('Failed to load session, status:', response.status);
        setError(t.failedToLoadSession);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
      setError(t.failedToLoadSession);
    }
  }, [setMessages, aiFetch, sessionsEndpoint, t.failedToLoadSession]);

  // Handle new session
  const handleNewSession = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
  }, [setMessages]);

  // Handle session select
  const handleSessionSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const sessionId = e.target.value;
    if (sessionId === 'new') {
      handleNewSession();
    } else if (sessionId) {
      loadSession(sessionId);
    }
  }, [handleNewSession, loadSession]);

  // Custom submit handler
  const handleFormSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input || !input.trim() || isLoading) return;

    try {
      // Send message using the new v3 API
      await sendMessage({ text: input });
      setInput('');
    } catch (err) {
      setError(t.failedToSendMessage);
    }
  }, [input, isLoading, sendMessage, t.failedToSendMessage]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit(e as any);
    }
  }, [handleFormSubmit]);

  return (
    <div className={containerStyles} style={{ maxHeight }}>
      {/* Header */}
      <div className={headerStyles}>
        <div className={headerTitleStyles}>
          <span>🤖</span>
          <span>{t.aiAssistant}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {sessions.length > 0 && (
            <select
              className={sessionSelectStyles}
              value={currentSessionId || 'new'}
              onChange={handleSessionSelect}
            >
              <option value="new">{t.newConversation}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || `${t.session} ${s.id.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
          {currentSessionId && (
            <button
              className={newSessionButtonStyles}
              onClick={handleNewSession}
            >
              {t.newButton}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className={messagesContainerStyles}>
        {messages.length === 0 ? (
          <div className={emptyStateStyles}>
            <div className="icon">💬</div>
            <h3>{t.startConversation}</h3>
            <p>{welcomeMessage}</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${messageStyles} ${message.role}`}
            >
              {/* Render parts in order - text and tool calls interleaved */}
              {message.parts.map((part: any, index: number) => (
                <MessagePart key={index} part={part} index={index} />
              ))}
            </div>
          ))
        )}

        {isLoading && (
          <div className={loadingStyles}>
            <div className="dot" />
            <div className="dot" />
            <div className="dot" />
            <span>{t.aiThinking}</span>
          </div>
        )}

        {error && (
          <div style={{ color: '#dc3545', padding: '8px', fontSize: '13px' }}>
            {t.error}: {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleFormSubmit} className={inputContainerStyles}>
        <textarea
          className={inputStyles}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading}
          rows={1}
        />
        <button
          type="submit"
          className={sendButtonStyles}
          disabled={isLoading || !input || !input.trim()}
        >
          {t.send}
        </button>
      </form>
    </div>
  );
};

function selectEntry(state: Entries, collection: string, slug: string) {
  return state.getIn(['entities', `${collection}.${slug}`]) as unknown as Map<string, any> | undefined;
}

function selectUnpublishedEntry(state: EditorialWorkflow, collection: string, slug: string) {
  return state && state.getIn(['entities', `${collection}.${slug}`]) as unknown as Map<string, any> | undefined;
}

function mapStateToProps(state: State, ownProps: AiChatControlProps) {
  const slug = ownProps.entry.get('slug');
  const collection = ownProps.collection;
  const collectionName = collection.get('name');
  const unPublishedEntry = selectUnpublishedEntry(state.editorialWorkflow, collectionName, slug);
  const publishedEntry = selectEntry(state.entries, collectionName, slug);
  const fields = selectFields(collection, slug);

  return {
    unPublishedEntry,
    publishedEntry,
    fields,
  }
}

const ConnectedAiChatControl = connect(mapStateToProps, null, null, { forwardRef: true })(AiChatControl);

export default ConnectedAiChatControl;

export { ConnectedAiChatControl as AiChatControl };
