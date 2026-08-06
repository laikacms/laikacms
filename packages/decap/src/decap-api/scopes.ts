/**
 * Scope model + an opt-in default authorization policy for `decap-api`.
 *
 * `authorize(ctx)` stays the single, consumer-owned access decision (see
 * {@link DecapOptions.authorize}). This module does not change that: it ships a
 * *convenience* so the common case ("viewers read, editors write") does not
 * have to be hand-written, while custom dashboards and non-CMS surfaces keep
 * full control by writing their own `authorize` or overriding the mapping.
 *
 * Scopes follow a `resource:action` convention and are an OPEN vocabulary. The
 * CMS ships the granular scopes below as well-known defaults, but a consumer
 * may grant its own namespaced scopes (e.g. `shipping:read`, `orders:write`)
 * and check them with {@link hasScope}. This mirrors `decap-cms-lib-pat`'s
 * scope primitives; the two should converge once that package is linked here.
 */
import type { AuthorizeContext, CmsDomain, CmsOperation } from './index.js';

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
 * `resource:action` pair (including a `resource:*` per-resource wildcard). The
 * template-literal arm keeps the vocabulary open to consumer namespaces.
 */
export type Scope =
  | GranularScope
  | typeof ADMIN_SCOPE
  | typeof WILDCARD_SCOPE
  | `${string}:${string}`;

/**
 * True if `value` is a syntactically valid scope: `admin`, `*`, or a
 * `resource:action` pair with non-empty resource and action. Validation is
 * structural, not membership, so a consumer's `shipping:read` is valid.
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
 * Canonicalize a scope set: dedupe, and collapse a global grant (`admin`/`*`)
 * to a single `admin`. Does not enumerate granular scopes (the vocabulary is
 * open); wildcard semantics are resolved at check time by {@link hasScope}.
 */
export function normalizeScopes(scopes: readonly Scope[]): Scope[] {
  if (scopes.includes(ADMIN_SCOPE) || scopes.includes(WILDCARD_SCOPE)) {
    return [ADMIN_SCOPE];
  }
  return Array.from(new Set(scopes));
}

/**
 * Default mapping from a decap-api request (`domain` + `operation`) to the
 * scope it requires. `session` is identity-only and requires nothing (any
 * authenticated principal may read it), so it returns `null`. Everything else
 * maps `documents`/`storage`/`locks` to the `content` resource and `assets` to
 * `media`, with `read` operations needing `:read` and every mutating operation
 * (`create`/`update`/`delete`/`publish`/`unpublish`) needing `:write`.
 */
export function requiredScopeFor(domain: CmsDomain, operation: CmsOperation): Scope | null {
  if (domain === 'session') {
    return null;
  }
  const resource = domain === 'assets' ? 'media' : 'content';
  const action = operation === 'read' ? 'read' : 'write';
  return `${resource}:${action}`;
}

export interface ScopePolicyOptions {
  /**
   * Override the request -> required-scope mapping. Return `null` to allow a
   * request without any scope check. Defaults to {@link requiredScopeFor}.
   */
  requiredScopeFor?: (ctx: AuthorizeContext) => Scope | null;
  /**
   * How to read the principal's granted scopes. Defaults to `ctx.user.scopes`
   * (empty when absent). Override to source scopes from elsewhere on the
   * augmented `User`.
   */
  scopesOf?: (ctx: AuthorizeContext) => readonly Scope[];
}

/**
 * Build an `authorize`-compatible policy that grants a request iff the
 * principal's scopes satisfy the required scope for that request. Drop it in
 * as `authorize`, or wrap it for finer control:
 *
 * @example Plain CMS, scopes carried on the session's user:
 * ```ts
 * decapApi({ ..., authorize: createScopePolicy() });
 * ```
 * @example Custom mapping for a shop dashboard's extra routes:
 * ```ts
 * const policy = createScopePolicy({
 *   requiredScopeFor: ctx =>
 *     ctx.collection === 'orders' ? `orders:${ctx.operation === 'read' ? 'read' : 'write'}` : null,
 * });
 * ```
 *
 * Fails closed: a principal with no scopes is denied everything except
 * requests the mapping returns `null` for (e.g. `session`). Populate
 * `user.scopes` in your `authenticateAccessToken` callback (typically from the
 * OAuth session's granted scope).
 */
export function createScopePolicy(
  options: ScopePolicyOptions = {},
): (ctx: AuthorizeContext) => boolean {
  const resolveRequired = options.requiredScopeFor
    ?? (ctx => requiredScopeFor(ctx.domain, ctx.operation));
  const resolveGranted = options.scopesOf
    ?? (ctx => ctx.user.scopes ?? []);
  return ctx => {
    const required = resolveRequired(ctx);
    if (required === null) {
      return true;
    }
    return hasScope(resolveGranted(ctx), required);
  };
}
