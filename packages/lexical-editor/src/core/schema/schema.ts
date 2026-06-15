/**
 * Editor schema — the configurable vocabulary of decorators, styles, lists,
 * annotations and block objects an editor instance allows.
 *
 * We reuse `@portabletext/schema` (a zero-dependency package) so a schema
 * defined here is interchangeable with `@portabletext/editor`'s `defineSchema`
 * and the Portable Text format mappers. The Lexical editor reads the schema to
 * decide which authoring controls to show, and the PT bridge reads it to decide
 * which decorators/styles/lists/links survive serialization.
 */
import { defineSchema, type SchemaDefinition } from '@portabletext/schema';

export { defineSchema };
export type { SchemaDefinition };

/** Alias: the schema shape this editor consumes. */
export type EditorSchema = SchemaDefinition;

/**
 * The "everything enabled" schema. Passing no schema to the editor or bridge is
 * equivalent to passing this — it reproduces the editor's original behavior and
 * mirrors the fixed decorator/style/list set the bridge historically emitted.
 */
export const DEFAULT_EDITOR_SCHEMA = defineSchema({
  decorators: [
    { name: 'strong' },
    { name: 'em' },
    { name: 'strike-through' },
    { name: 'underline' },
    { name: 'code' },
    { name: 'sub' },
    { name: 'sup' },
    { name: 'highlight' },
  ],
  styles: [
    { name: 'normal' },
    { name: 'h1' },
    { name: 'h2' },
    { name: 'h3' },
    { name: 'h4' },
    { name: 'h5' },
    { name: 'h6' },
    { name: 'blockquote' },
  ],
  lists: [
    { name: 'bullet' },
    { name: 'number' },
    // Non-standard, but preserves the editor's check-list affordance.
    { name: 'check' },
  ],
  annotations: [
    { name: 'link', fields: [{ name: 'href', type: 'string' }] },
  ],
  blockObjects: [
    { name: 'image' },
    { name: 'table' },
    { name: 'code' },
    { name: 'divider' },
    { name: 'columnsLayout' },
    { name: 'tweet' },
    { name: 'youtube' },
    { name: 'dateTime' },
  ],
  inlineObjects: [],
}) satisfies EditorSchema;

function names(defs: ReadonlyArray<{ name: string }> | undefined): Set<string> {
  return new Set((defs ?? []).map(def => def.name));
}

/** Allowed decorator names (e.g. `strong`, `em`, `code`). */
export function schemaDecoratorNames(schema: EditorSchema): Set<string> {
  return names(schema.decorators);
}

/** Allowed block style names (e.g. `normal`, `h1`, `blockquote`). */
export function schemaStyleNames(schema: EditorSchema): Set<string> {
  return names(schema.styles);
}

/** Allowed list types (e.g. `bullet`, `number`, `check`). */
export function schemaListNames(schema: EditorSchema): Set<string> {
  return names(schema.lists);
}

/** Allowed block object types (e.g. `image`, `table`, `code`). */
export function schemaBlockObjectNames(schema: EditorSchema): Set<string> {
  return names(schema.blockObjects);
}

/** True when `schema` declares an annotation with the given name (e.g. `link`). */
export function schemaHasAnnotation(schema: EditorSchema, name: string): boolean {
  return names(schema.annotations).has(name);
}
