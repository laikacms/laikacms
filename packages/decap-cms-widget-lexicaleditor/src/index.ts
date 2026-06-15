// decap-cms-widget-lexicaleditor
//
// The Decap CMS adapter for the Lexical editor. The reusable editor lives in
// `@laikacms/lexical-editor`; this package only wires it into Decap as a widget
// (control + preview + schema + factory + passthrough value serializer).

export { LexicalControl, lexicalEditorWidgetSchema, LexicalPreview, passthroughSerializer, Widget } from './widget';
export type { LexicalWidgetDefinition } from './widget';
