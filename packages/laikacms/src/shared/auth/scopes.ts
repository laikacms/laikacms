/**
 * Open `resource:action` scope vocabulary for CMS-issued credentials (OAuth
 * sessions and PATs). CMS-agnostic mechanism: the granular scopes below are
 * shipped defaults, but the vocabulary is open, a consumer may grant its own
 * namespaced scopes (e.g. `shipping:read`). This is the single source of the
 * scope primitives; adapters (`@laikacms/decap`) layer their own vocabulary +
 * policy on top, and `decap-cms` keeps a types-only copy for its admin UI.
 *
 * Wildcards:
 * - `admin` (and the equivalent `*`) grant every scope.
 * - `resource:*` grants every action on that resource (e.g. `content:*`).
 */
export const GRANULAR_SCOPES = [
  'content:read',
  'content:write',
  'media:read',
  'media:write',
  'config:read',
] as const;

export type GranularScope = (typeof GRANULAR_SCOPES)[number];

/** Global grant: implies every scope. */
export const ADMIN_SCOPE = 'admin' as const;

/** Global grant alias, `*`. Treated identically to {@link ADMIN_SCOPE}. */
export const WILDCARD_SCOPE = '*' as const;

/**
 * An open scope: the CMS well-knowns, either global grant, or any
 * `resource:action` pair (including a `resource:*` per-resource wildcard).
 */
export type Scope =
  | GranularScope
  | typeof ADMIN_SCOPE
  | typeof WILDCARD_SCOPE
  | `${string}:${string}`;

/** The CMS's shipped scopes plus the global admin grant (not the full universe). */
export const ALL_SCOPES: readonly Scope[] = [...GRANULAR_SCOPES, ADMIN_SCOPE];

/**
 * True if `value` is a syntactically valid scope: `admin`, `*`, or a
 * `resource:action` pair with non-empty resource and action. Structural, not
 * membership, so a consumer's `shipping:read` is valid.
 */
export function isScope(value: string): value is Scope {
  if (value === ADMIN_SCOPE || value === WILDCARD_SCOPE) {
    return true;
  }
  const [resource, action, ...rest] = value.split(':');
  return rest.length === 0 && !!resource && !!action;
}

/**
 * Does `granted` satisfy `required`, accounting for wildcards?
 *
 * - a global grant (`admin`/`*`) satisfies anything;
 * - an exact match satisfies;
 * - a `resource:*` grant satisfies any `resource:action` on that resource.
 */
export function hasScope(granted: readonly Scope[], required: Scope): boolean {
  if (granted.includes(ADMIN_SCOPE) || granted.includes(WILDCARD_SCOPE)) {
    return true;
  }
  if (granted.includes(required)) {
    return true;
  }
  const colon = required.indexOf(':');
  if (colon > 0) {
    const resource = required.slice(0, colon);
    if (granted.includes(`${resource}:*` as Scope)) {
      return true;
    }
  }
  return false;
}

/**
 * Canonicalize a scope set for storage: dedupe, and collapse a global grant
 * (`admin`/`*`) to a single `admin`. Does not enumerate granular scopes (the
 * vocabulary is open); wildcard semantics are resolved at check time by
 * {@link hasScope}.
 */
export function normalizeScopes(scopes: readonly Scope[]): Scope[] {
  if (scopes.includes(ADMIN_SCOPE) || scopes.includes(WILDCARD_SCOPE)) {
    return [ADMIN_SCOPE];
  }
  return Array.from(new Set(scopes));
}
