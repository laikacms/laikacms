import { AiChatControl } from './AiChatControl';
import { AiChatPreview } from './AiChatPreview';
import type { AiChatWidgetOptions } from './types';

export { AiChatControl } from './AiChatControl';
export { AiChatPreview } from './AiChatPreview';
export type { AiChatWidgetOptions, DocumentContext, SessionSummary } from './types';

// i18n exports
export type { Translation, TranslationKey } from './i18n/types';

function Widget(opts: AiChatWidgetOptions) {
  return {
    name: 'ai-chat',
    controlComponent: AiChatControl,
    previewComponent: AiChatPreview,
    ...opts,
  };
}

export const WidgetAiChat = {
  name: 'ai-chat',
  Widget,
  controlComponent: AiChatControl,
  previewComponent: AiChatPreview,
};

export default WidgetAiChat;
