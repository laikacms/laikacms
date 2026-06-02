/**
 * Public widget entry: factory + components + a passthrough widget value
 * serializer registration helper.
 */
import { LexicalControl } from './control';
import { LexicalPreview } from './preview';
import { lexicalEditorWidgetSchema } from './schema';

export { LexicalControl, lexicalEditorWidgetSchema, LexicalPreview };

export interface LexicalWidgetDefinition {
  name: 'lexicaleditor';
  controlComponent: typeof LexicalControl;
  previewComponent: typeof LexicalPreview;
  schema: typeof lexicalEditorWidgetSchema;
}

/**
 * Widget factory. Pass the result to `CMS.registerWidget(...)`.
 *
 * Also wire the passthrough value serializer with
 * `CMS.registerWidgetValueSerializer('lexicaleditor', passthroughSerializer)` so
 * Decap's `serializeValues()` doesn't stringify the `RichtextValue` early —
 * `toString()` fires once, at file-write time.
 *
 * Register the output formats you want at call site via
 * `registerMapper(...)` from `@laikacloud/portabletext-core` — formats are
 * intentionally not bundled here so consumers only pay for what they use.
 */
export function Widget(): LexicalWidgetDefinition {
  return {
    name: 'lexicaleditor',
    controlComponent: LexicalControl,
    previewComponent: LexicalPreview,
    schema: lexicalEditorWidgetSchema,
  };
}

/** A passthrough serializer so the lazy proxy survives Decap's value pipeline. */
export const passthroughSerializer = {
  serialize: <T>(value: T): T => value,
  deserialize: <T>(value: T): T => value,
};

export default Widget;
