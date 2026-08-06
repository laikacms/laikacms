import { hasScope } from './scopes.js';

import type { Scope } from './scopes.js';
import type { AuthContext } from './types.js';

export class InsufficientScopeError extends Error {
  readonly required: Scope;

  constructor(required: Scope) {
    super(`Missing required scope: ${required}`);
    this.name = 'InsufficientScopeError';
    this.required = required;
  }
}

/**
 * Enforcement helper for backends/servers: throws `InsufficientScopeError`
 * unless `ctx.scopes` (from `resolveBearer`) satisfies `required`.
 *
 * @example
 *   const ctx = await resolveBearer(bearer, deps);
 *   if (!ctx) throw new UnauthorizedError();
 *   requireScope(ctx, 'content:write');
 */
export function requireScope(ctx: AuthContext, required: Scope): void {
  if (!hasScope(ctx.scopes, required)) {
    throw new InsufficientScopeError(required);
  }
}

export function hasRequiredScope(ctx: AuthContext, required: Scope): boolean {
  return hasScope(ctx.scopes, required);
}
