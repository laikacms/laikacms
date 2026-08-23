/**
 * Translating a Laika record into an Astro `DataEntry`.
 *
 * The two models disagree in exactly one interesting place. Laika keeps a
 * document's whole payload in one open `content` bag — frontmatter fields and
 * the prose body side by side — because storage serializers do not know which
 * field is prose. Astro splits them: `data` is validated against the collection
 * schema, `body` is raw source, `rendered` is HTML. This module is that split,
 * and nothing else in the package needs to know about it.
 */

import type { DataStore, MetaStore } from 'astro/loaders';
import type { JSONSchema7 } from 'json-schema';

/**
 * The slice of Astro's `LoaderContext` these loaders actually use.
 *
 * Deliberately *not* Astro's `LoaderContext` itself. That type embeds the whole
 * `AstroConfig`, and a project whose installed Astro differs from the one this
 * package's types were built against makes TypeScript compare two enormous,
 * structurally-identical config types — which exceeds its instantiation depth
 * limit and surfaces to the user as "Excessive stack depth comparing types" from
 * `astro check`. Naming only what we read keeps that comparison shallow, and it
 * documents the dependency honestly: a loader needs a store, a logger and four
 * functions, not the site's build configuration.
 *
 * Parameter position makes this safe: a function accepting less is assignable to
 * one accepting more, so `LaikaLoader` remains a valid Astro `Loader`.
 */
export interface LaikaLoaderContext {
  collection: string;
  store: DataStore;
  meta: MetaStore;
  logger: {
    info(message: string): void,
    warn(message: string): void,
    error(message: string): void,
    debug(message: string): void,
  };
  config: { root: URL };
  parseData: <TData extends Record<string, unknown>>(
    props: { id: string, data: TData, filePath?: string },
  ) => Promise<TData>;
  renderMarkdown: (content: string) => Promise<{ html: string, metadata?: Record<string, unknown> }>;
  generateDigest: (data: Record<string, unknown> | string) => string;
  refreshContextData?: Record<string, unknown> | undefined;
}

/** The loader shape these loaders produce. Assignable to Astro's `Loader`. */
export interface LaikaLoader {
  name: string;
  load: (context: LaikaLoaderContext) => Promise<void>;
  /**
   * Supplies the collection schema *and* the TypeScript source describing it.
   * Astro calls this when the collection declares no schema of its own, writes
   * the source into `.astro/loaders/`, and types entries from it — which is how
   * a schema derived from a CMS config at build time still gives you
   * `entry.data.title` in an editor.
   */
  createSchema?: () => Promise<{ schema: unknown, types: string }>;
}

/**
 * Astro's content-store entry.
 *
 * `astro/loaders` re-exports `DataStore` but not `DataEntry`, so we recover it
 * from the store's own signature instead of deep-importing an internal path
 * that Astro is free to move.
 */
export type DataEntry = NonNullable<ReturnType<DataStore['get']>>;

/** The default field a serializer writes prose into (see `markdownSerializer`). */
export const DEFAULT_BODY_FIELD = 'body';

export interface EntryOptions {
  /** Derive the Astro entry id from a Laika key. Defaults to stripping the collection prefix. */
  id?: (context: { key: string, collection: string }) => string;
  /** Copy the full Laika key into `data` under this name. Off by default. */
  keyField?: string;
  /** Copy the record's version token into `data` under this name. Off by default. */
  versionField?: string;
}

export interface RenderOptions {
  /**
   * How the body field becomes rendered output.
   *
   * - `'markdown'` (default) — rendered eagerly through Astro's markdown
   *   pipeline. Works for every repository, including remote ones.
   * - `'none'` — no rendering; `body` is still exposed for a custom renderer.
   * - `'deferred'` — hand rendering to Vite at request time. This is the only
   *   route to MDX and to your own remark/rehype plugins, but Astro resolves a
   *   deferred entry through its *file path*, so it requires {@link filePath}
   *   and a repository backed by real files on disk.
   */
  mode?: 'markdown' | 'none' | 'deferred';
  /** Which content field holds the prose. Defaults to `'body'`. */
  bodyField?: string;
  /** Keep the raw body on the entry. Defaults to `true`. */
  retainBody?: boolean;
  /** Resolve a Laika key to an on-disk path, for `mode: 'deferred'`. */
  filePath?: (context: { key: string, collection: string }) => string | undefined;
}

/** A record as this package consumes it — the common shape of a document and a storage object. */
export interface SourceRecord {
  key: string;
  content: Record<string, unknown>;
  /** Opaque change token, when the repository tracks one. */
  version?: string | undefined;
}

/** Everything the mapping needs that does not come from the record itself. */
export interface MappingContext {
  collection: string;
  entry: EntryOptions;
  render: RenderOptions;
  renderMarkdown: (content: string) => Promise<{ html: string, metadata?: Record<string, unknown> }>;
  generateDigest: (data: Record<string, unknown> | string) => string;
  parseData: <TData extends Record<string, unknown>>(
    props: { id: string, data: TData, filePath?: string },
  ) => Promise<TData>;
  addModuleImport?: (fileName: string) => void;
  /** Called once per load when `mode: 'deferred'` cannot be honoured. */
  onDeferredUnavailable?: () => void;
}

/**
 * Derive an Astro entry id from a Laika key.
 *
 * The default strips the collection prefix and keeps everything after it,
 * slashes included: `posts/2026/hello` in collection `posts` becomes
 * `2026/hello`. That keeps the mapping round-trippable — `key` is always
 * `${collection}/${id}` — which is what lets the live loader accept an id and
 * the build loader accept a key without either needing a lookup table.
 */
export function entryIdOf(key: string, collection: string, entry: EntryOptions): string {
  if (entry.id) return entry.id({ key, collection });
  const prefix = `${collection}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/** The inverse of {@link entryIdOf} for the default derivation. */
export function keyOf(id: string, collection: string): string {
  return `${collection}/${id}`;
}

/**
 * Split a record's `content` into Astro's `data` / `body` pair.
 *
 * `data` deliberately excludes the body field so a user's Zod schema describes
 * frontmatter only — the same contract Astro's built-in `glob()` loader offers.
 */
export function splitContent(
  record: SourceRecord,
  options: { entry: EntryOptions, render: RenderOptions },
): { data: Record<string, unknown>, body: string | undefined } {
  const bodyField = options.render.bodyField ?? DEFAULT_BODY_FIELD;
  const { [bodyField]: rawBody, ...rest } = record.content;
  const data: Record<string, unknown> = { ...rest };

  if (options.entry.keyField) data[options.entry.keyField] = record.key;
  if (options.entry.versionField && record.version !== undefined) {
    data[options.entry.versionField] = record.version;
  }

  return { data, body: typeof rawBody === 'string' ? rawBody : undefined };
}

/**
 * The change token stored on an entry.
 *
 * A repository-supplied `version` is preferred — it is authoritative and free.
 * Hashing the content is the fallback for repositories that do not track
 * versions, which is most of them today. Both land in the same field so the
 * sync tiers can compare them without caring which one produced the value.
 */
export function digestOf(
  record: SourceRecord,
  generateDigest: (data: Record<string, unknown> | string) => string,
): string {
  return record.version ?? generateDigest(record.content);
}

/** Map one record to a `DataEntry`, applying the schema via `parseData`. */
export async function toDataEntry(
  record: SourceRecord,
  context: MappingContext,
): Promise<DataEntry> {
  const id = entryIdOf(record.key, context.collection, context.entry);
  const { data, body } = splitContent(record, context);

  const mode = context.render.mode ?? 'markdown';
  // Resolved in every mode, not just `'deferred'`. Astro also uses `filePath`
  // to anchor the relative image paths a markdown body refers to, so a project
  // whose repository is backed by real files benefits from it under eager
  // rendering too.
  const filePath = context.render.filePath?.({ key: record.key, collection: context.collection });
  // A deferred entry is resolved by Astro through `contentModules.get(filePath)`
  // at render time. Without a path there is nothing to resolve, and the page
  // would fail at request time rather than here — so fall back loudly instead.
  const deferred = mode === 'deferred' && filePath !== undefined;
  if (mode === 'deferred' && !deferred) context.onDeferredUnavailable?.();

  const parsed = await context.parseData({
    id,
    data,
    ...(filePath !== undefined ? { filePath } : {}),
  });

  const entry: DataEntry = {
    id,
    data: parsed,
    digest: digestOf(record, context.generateDigest),
  };
  if (filePath !== undefined) entry.filePath = filePath;
  if (body !== undefined && context.render.retainBody !== false) entry.body = body;

  if (deferred) {
    entry.deferredRender = true;
    if (filePath !== undefined) context.addModuleImport?.(filePath);
    return entry;
  }

  const shouldRender = (mode === 'markdown' || (mode === 'deferred' && !deferred))
    && body !== undefined;
  if (shouldRender && body !== undefined) {
    const rendered = await context.renderMarkdown(body);
    entry.rendered = rendered;
    // Image paths are relative to the file the markdown came from, so they are
    // only resolvable when a real path backed this entry.
    const imagePaths = rendered.metadata?.['imagePaths'];
    if (filePath !== undefined && Array.isArray(imagePaths) && imagePaths.length > 0) {
      entry.assetImports = imagePaths as string[];
    }
  }

  return entry;
}

/**
 * Remove the prose field from a collection schema.
 *
 * The loaders put prose on `entry.body` and `entry.rendered`, never in `data`,
 * so a schema that still required it would reject every entry. Lives here
 * rather than beside the build-time loader because the live loader applies the
 * same split and must not reach into a module that imports `node:`.
 */
export function stripBodyField(schema: JSONSchema7, bodyField: string): JSONSchema7 {
  if (schema.properties?.[bodyField] === undefined) return schema;
  const { [bodyField]: _body, ...properties } = schema.properties;
  return {
    ...schema,
    properties,
    ...(schema.required !== undefined
      ? { required: schema.required.filter(name => name !== bodyField) }
      : {}),
  };
}
