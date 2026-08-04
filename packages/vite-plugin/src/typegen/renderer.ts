import { BODY_EXPORT, bodyOf } from '../bodies.js';
import { isSafeIdentifier } from '../identifier.js';
import type { LaikaNamespace } from '../protocol.js';

/**
 * The concrete data for one content item, as returned by `readItem` (or handed
 * to `ingest`).
 */
export interface RenderInput {
  readonly namespace: LaikaNamespace;
  readonly key: string;
  /** Top-level content fields (become named exports when safe identifiers). */
  readonly content: Record<string, unknown>;
  /** Item metadata (source of the `$`-prefixed exports). */
  readonly meta: Record<string, unknown>;
}

export interface RenderOptions {
  /**
   * When `true`, append `as const` so tsc keeps literal types
   * (`title: "Hello"` instead of `title: string`). Opt-in.
   */
  readonly literals?: boolean;
  /**
   * Mirror the runtime `mdx` option: an item with prose also exports `Body`,
   * the compiled MDX component. Typing it needs `@types/mdx` in the consuming
   * project, which is where `mdx/types` comes from.
   */
  readonly mdx?: boolean;
}

/**
 * Builds the ordered set of `$`-prefixed meta export entries for an item,
 * matching module.ts's runtime surface:
 *   - doc:   $key, $language, $status, $version (only when present)
 *   - store: $key, $type, then one `$<metaKey>` per spread metadata key
 *
 * Returns `[exportName, value]` pairs. Only safe-identifier export names are
 * kept, and later entries never clobber `$key`/`$type`.
 */
function metaEntries(namespace: LaikaNamespace, meta: Record<string, unknown>): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  const seen = new Set<string>();
  const push = (name: string, value: unknown): void => {
    if (value === undefined) {
      return;
    }
    if (!isSafeIdentifier(name) || seen.has(name)) {
      return;
    }
    seen.add(name);
    entries.push([name, value]);
  };

  if (namespace === 'doc') {
    push('$key', meta.key);
    push('$language', meta.language);
    push('$status', meta.status);
    push('$version', meta.version);
    return entries;
  }

  // store
  push('$key', meta.key);
  push('$type', meta.type);
  const metadata = meta.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    for (const [metaKey, value] of Object.entries(metadata as Record<string, unknown>)) {
      push(`$${metaKey}`, value);
    }
  }
  return entries;
}

/**
 * Serialize a JSON-compatible value to a TypeScript expression. Object keys are
 * always quoted (valid TS) so non-identifier content keys survive inside the
 * default export without becoming named exports. `undefined` is dropped by the
 * caller before reaching here.
 */
function serializeValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Renders a value-bearing TypeScript module for one content item using the
 * WIDENING form so tsc widens literals to primitives consistently across the
 * named and default exports. The TypeScript compiler — not this code — then
 * infers the exported types from this source (see compiler-emit.ts), which is
 * what keeps the generated `.d.ts` free of hand-written type drift.
 *
 * Shape:
 *   const __data = { <content fields>, <$meta fields> };
 *   export const { <safe content keys>, <$meta keys> } = __data;
 *   export default __data;
 */
export function renderItemModule(input: RenderInput, options: RenderOptions = {}): string {
  const { content, meta, namespace } = input;

  // Data object = content fields first, then $-prefixed meta fields (which win
  // on the rare name collision). This object backs both the named and default
  // exports, guaranteeing identical inferred types.
  const dataEntries: Array<[string, unknown]> = [];
  const dataKeys = new Set<string>();
  for (const [k, v] of Object.entries(content)) {
    if (v === undefined) {
      continue;
    }
    dataEntries.push([k, v]);
    dataKeys.add(k);
  }
  const metas = metaEntries(namespace, meta);
  for (const [name, value] of metas) {
    if (dataKeys.has(name)) {
      // Overwrite the earlier content entry so the meta value wins.
      const idx = dataEntries.findIndex(([k]) => k === name);
      dataEntries[idx] = [name, value];
    } else {
      dataEntries.push([name, value]);
      dataKeys.add(name);
    }
  }

  const objectBody = dataEntries.length === 0
    ? '{}'
    : `{\n${dataEntries.map(([k, v]) => `  ${JSON.stringify(k)}: ${serializeValue(v)},`).join('\n')}\n}`;

  // Named exports: safe-identifier content keys + all $meta names, de-duped in
  // declaration order.
  const named: string[] = [];
  const namedSeen = new Set<string>();
  for (const [k] of Object.entries(content)) {
    if (content[k] === undefined) {
      continue;
    }
    if (isSafeIdentifier(k) && !namedSeen.has(k)) {
      named.push(k);
      namedSeen.add(k);
    }
  }
  for (const [name] of metas) {
    if (!namedSeen.has(name)) {
      named.push(name);
      namedSeen.add(name);
    }
  }

  const asConst = options.literals ? ' as const' : '';
  const lines = [`const __data = ${objectBody}${asConst};`];
  if (named.length > 0) {
    lines.push(`export const { ${named.join(', ')} } = __data;`);
  }
  lines.push('export default __data;');
  // The real module re-exports the chunk's default; here we only need tsc to
  // emit the declaration for it, so a cast off `null` is enough.
  if (options.mdx && bodyOf(content) !== null && !Object.hasOwn(content, BODY_EXPORT)) {
    lines.push(`export const ${BODY_EXPORT} = null as unknown as import('mdx/types').MDXContent;`);
  }
  return `${lines.join('\n')}\n`;
}
