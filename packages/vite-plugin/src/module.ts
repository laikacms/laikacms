/**
 * Render a content object into an ES module string with one named export per
 * top-level field. Rollup treats each named export as an independent binding,
 * so `import { title } from 'laika:doc/posts/hello'` drops every other field
 * from the bundle — which is what makes `import.meta.glob(..., { import: 'title' })`
 * over a blog index cheap.
 */

import { BODY_EXPORT } from './bodies.js';
import { isSafeIdentifier } from './identifier.js';

export interface RenderModuleOptions {
  /** The content fields — each becomes a named export. */
  content: Record<string, unknown>;
  /**
   * Repository metadata (key, language, status, …). Exported under `$`-prefixed
   * names so they never collide with content fields.
   */
  meta?: Record<string, unknown>;
  /**
   * Specifier of the item's `.mdx` body chunk. Its default export is re-exported
   * as `Body`, deliberately *outside* the default export: importing the data
   * object must not drag the compiled component (and the MDX runtime) in with
   * it. The raw `body` string export stays either way.
   */
  mdxSpecifier?: string;
}

/** Build the ES module source for a single content item. */
export function renderModule({ content, meta = {}, mdxSpecifier }: RenderModuleOptions): string {
  const lines: string[] = [];
  const defaultEntries: string[] = [];

  let counter = 0;
  for (const [key, value] of Object.entries(content)) {
    const temp = `__f${counter++}`;
    lines.push(`const ${temp} = ${JSON.stringify(value ?? null)};`);
    if (isSafeIdentifier(key)) {
      lines.push(`export const ${key} = ${temp};`);
    } else {
      // ES2022 arbitrary module namespace names keep odd keys importable
      // (e.g. via `import.meta.glob(..., { import: 'kebab-case' })`).
      lines.push(`export { ${temp} as ${JSON.stringify(key)} };`);
    }
    defaultEntries.push(`${JSON.stringify(key)}: ${temp}`);
  }

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    const name = `$${key}`;
    if (isSafeIdentifier(name)) {
      lines.push(`export const ${name} = ${JSON.stringify(value)};`);
    }
  }

  lines.push(`export default { ${defaultEntries.join(', ')} };`);

  if (mdxSpecifier !== undefined) {
    if (Object.hasOwn(content, BODY_EXPORT)) {
      throw new Error(
        `Content item "${String(meta['key'] ?? '')}" has a "${BODY_EXPORT}" field, which collides `
          + `with the export the MDX body is compiled into. Rename the field, or turn off "mdx".`,
      );
    }
    lines.push(`export { default as ${BODY_EXPORT} } from ${JSON.stringify(mdxSpecifier)};`);
  }

  return lines.join('\n') + '\n';
}
