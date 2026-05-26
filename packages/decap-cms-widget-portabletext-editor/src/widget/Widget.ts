import { PortableTextEditorControl } from './control';
import { PortableTextEditorPreview } from './preview';
import { schema } from './schema';

/**
 * Decap widget descriptor.
 *
 * Registered with Decap via:
 *
 *     CMS.registerWidget(Widget());
 *
 * The widget value passed through `onChange` is a `RichtextValue` instance;
 * Decap's per-format value-serializer pipeline (`formats/{json,yaml,toml}`)
 * calls `toString()` exactly once at file-write time.
 */
export function Widget(): {
  name: string,
  controlComponent: typeof PortableTextEditorControl,
  previewComponent: typeof PortableTextEditorPreview,
  schema: typeof schema,
} {
  return {
    name: 'portabletext-editor',
    controlComponent: PortableTextEditorControl,
    previewComponent: PortableTextEditorPreview,
    schema,
  };
}
