/**
 * The `laika:` import protocol.
 *
 * A source id looks like `laika:<namespace>/<key>`, where the namespace selects
 * the repository the key is read from:
 *
 * - `laika:doc/<key>`   → the documents repository (`getDocument`)
 * - `laika:store/<key>` → the storage repository (`getObject`)
 *
 * Resolved ids are prefixed with a NUL byte (`\0`) — the Rollup/Vite convention
 * for virtual modules — so no other plugin tries to read them from disk.
 */

export type Namespace = 'doc' | 'store';

/** Alias of {@link Namespace}. Exists for call sites that prefer the fuller name. */
export type LaikaNamespace = Namespace;

export const PROTOCOL = 'laika:';
export const VIRTUAL_PREFIX = '\0laika:';

/** Accepted spellings for each namespace, normalized to the canonical form. */
const NAMESPACE_ALIASES: Record<string, Namespace> = {
  doc: 'doc',
  docs: 'doc',
  document: 'doc',
  documents: 'doc',
  store: 'store',
  storage: 'store',
};

export interface LaikaId {
  namespace: Namespace;
  /** The repository key, e.g. `posts/hello`. */
  key: string;
}

/** True when `source` is written with the `laika:` protocol. */
export function isLaikaSource(source: string): boolean {
  return source.startsWith(PROTOCOL);
}

/** True when `id` is an already-resolved virtual laika id. */
export function isVirtualId(id: string): boolean {
  return id.startsWith(VIRTUAL_PREFIX);
}

/** Split a `laika:<namespace>/<key>` (or virtual) string into namespace + key. Throws on a malformed id. */
export function parseLaikaId(source: string): LaikaId {
  const withoutPrefix = source.startsWith(VIRTUAL_PREFIX)
    ? source.slice(VIRTUAL_PREFIX.length)
    : source.startsWith(PROTOCOL)
    ? source.slice(PROTOCOL.length)
    : source;

  const slash = withoutPrefix.indexOf('/');
  if (slash === -1) {
    throw new Error(
      `Invalid laika id "${source}": expected "laika:<namespace>/<key>" (e.g. "laika:doc/posts/hello").`,
    );
  }
  const rawNamespace = withoutPrefix.slice(0, slash);
  const key = withoutPrefix.slice(slash + 1);
  const namespace = NAMESPACE_ALIASES[rawNamespace];
  if (!namespace) {
    throw new Error(
      `Invalid laika namespace "${rawNamespace}" in "${source}": expected one of doc, store.`,
    );
  }
  if (!key) {
    throw new Error(`Invalid laika id "${source}": missing key after "${rawNamespace}/".`);
  }
  return { namespace, key };
}

/** Render a {@link LaikaId} back to its canonical virtual id. */
export function toVirtualId(id: LaikaId): string {
  return `${VIRTUAL_PREFIX}${id.namespace}/${id.key}`;
}

/** Render a {@link LaikaId} back to its canonical public `laika:` source. */
export function toSource(id: LaikaId): string {
  return `${PROTOCOL}${id.namespace}/${id.key}`;
}
