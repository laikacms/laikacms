import { ForbiddenError, type LaikaError } from 'laikacms/core';

/**
 * The verdict an authorization callback returns for a single API action:
 *
 * - `true` — allow the action.
 * - `false` — deny it with a generic {@link ForbiddenError} (HTTP 403).
 * - a {@link LaikaError} — deny it with that specific error, so callers can
 *   customise the status/message (e.g. return an `AuthenticationError` for a
 *   missing token → 401, or a bespoke `ForbiddenError` with a reason).
 *
 * Callbacks may return the decision synchronously or as a `Promise` (e.g. when
 * they need to look up a token in a database).
 */
export type AuthorizeDecision = boolean | LaikaError;

/**
 * Normalise an {@link AuthorizeDecision} into either `null` (allowed) or the
 * {@link LaikaError} that should be returned to the client. A bare `false`
 * becomes a generic {@link ForbiddenError}; a returned error is passed through
 * unchanged so its own `code`/`status` drive the HTTP response.
 */
export function resolveAuthorization(decision: AuthorizeDecision): LaikaError | null {
  if (decision === true) return null;
  if (decision === false) {
    return new ForbiddenError('Forbidden: you are not allowed to perform this action');
  }
  return decision;
}

/**
 * An authorization policy that permits **every action for every caller**.
 *
 * Every `build*Api` requires an `authorize` callback — there is no implicit
 * default, because an API that silently defaults to open is the failure mode
 * this option exists to prevent. `allowAll` is the explicit way to say "this
 * surface is intentionally unauthenticated":
 *
 * ```typescript
 * const api = buildJsonApi({ repo, authorize: allowAll });
 * ```
 *
 * Only safe when something *else* guarantees the handler is unreachable by
 * untrusted callers — a dev server bound to localhost, a test harness, or an
 * outer middleware that has already authenticated the request. Naming it
 * rather than inlining `() => true` means every deliberately-open surface in a
 * deployment is one `rg 'authorize: allowAll'` away during an audit.
 */
export const allowAll = (): true => true;
