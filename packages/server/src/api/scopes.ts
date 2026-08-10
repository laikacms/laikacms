/**
 * Default authorization policy over the shared scope mechanism.
 *
 * The scope primitives (open `resource:action` vocabulary, `hasScope` with
 * wildcards, `normalizeScopes`, PAT minting, `resolveBearer`) live once in
 * `laikacms/auth` and are re-exported here for convenience. This module adds
 * only the api-specific pieces: the `domain`+`operation` -> scope mapping
 * and `createScopePolicy()`, an opt-in `authorize()`.
 *
 * `authorize(ctx)` stays the single, consumer-owned access decision (see
 * {@link LaikaApiOptions.authorize}); this is a convenience so the common case is
 * not hand-written, while custom dashboards / non-CMS surfaces override
 * `requiredScopeFor` or write their own policy.
 */
import {
  ADMIN_SCOPE,
  ALL_SCOPES,
  GRANULAR_SCOPES,
  hasScope,
  isScope,
  normalizeScopes,
  WILDCARD_SCOPE,
} from 'laikacms/auth';

import type { GranularScope, Scope } from 'laikacms/auth';
import type { AuthorizeContext, CmsDomain, CmsOperation } from './index.js';

// Re-export the shared scope mechanism so api consumers reach it from one
// import surface. Implementation lives in laikacms/auth.
export { ADMIN_SCOPE, ALL_SCOPES, GRANULAR_SCOPES, hasScope, isScope, normalizeScopes, WILDCARD_SCOPE };
export type { GranularScope, Scope };

/**
 * Default mapping from a api request (`domain` + `operation`) to the
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
 * principal's scopes satisfy the required scope for that request. Drop it in as
 * `authorize`, or wrap it for finer control.
 *
 * @example Plain CMS, scopes carried on the session's user:
 * ```ts
 * laikaApi({ ..., authorize: createScopePolicy() });
 * ```
 *
 * Fails closed: a principal with no scopes is denied everything except requests
 * the mapping returns `null` for (e.g. `session`). Populate `user.scopes` in
 * your `authenticateAccessToken` callback, typically via `resolveBearer` from
 * the OAuth session's granted scope.
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
