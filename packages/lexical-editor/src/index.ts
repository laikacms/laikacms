// @laikacms/lexical-editor
//
// A framework-agnostic Lexical rich-text editor, built as an emotion-styled fork
// of htmujahid/shadcn-editor. This entry re-exports the editor component plus its
// format-agnostic themes and utilities.
//
// The Portable Text <-> Lexical bridge (PT conversion, node set, headless editor,
// RichtextValue) lives under the `@laikacms/lexical-editor/core` export, and the
// individual editor modules (UI components, themes, plugins) are reachable via
// subpath imports, e.g. `@laikacms/lexical-editor/editor/ui/button`.

export { Editor } from './editor/Editor';

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
