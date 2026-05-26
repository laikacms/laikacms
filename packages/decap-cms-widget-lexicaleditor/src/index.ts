// decap-cms-widget-lexicaleditor
//
// A Lexical rich-text widget for Decap CMS, built as an emotion-styled fork of
// htmujahid/shadcn-editor. Phase 5 (the editor port) is in progress; this entry
// currently re-exports the ported, format-agnostic editor utilities.

export { Editor } from './editor/Editor';

// Decap widget integration: factory, control/preview components, passthrough serializer.
export {
  ensureDefaultFormatsRegistered,
  LexicalControl,
  lexicalEditorWidgetSchema,
  LexicalPreview,
  passthroughSerializer,
  Widget,
} from './widget';
export type { LexicalWidgetDefinition } from './widget';

export * from './editor/themes/editor-theme';
export * from './editor/themes/global-styles';

export * from './editor/utils/doc-serialization';
export * from './editor/utils/emoji-list';
export * from './editor/utils/get-dom-range-rect';
export * from './editor/utils/get-selected-node';
export * from './editor/utils/guard';
export * from './editor/utils/set-floating-elem-position';
export * from './editor/utils/set-floating-elem-position-for-link-editor';
export * from './editor/utils/swipe';
export * from './editor/utils/url';
