/**
 * Authenticated identity surfaced by `verifyToken`. The shape matches what
 * Netlify's git-gateway exposes via the `/settings` endpoint: at minimum a
 * stable id, optionally an email + role list for authorization.
 */
export interface GatewayUser {
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
  readonly roles?: ReadonlyArray<string>;
}

/**
 * Caller-supplied Bearer-token verifier. Receives the raw token (no `Bearer`
 * prefix) and returns the resolved user, or throws/returns null to reject.
 */
export type VerifyToken = (token: string) => Promise<GatewayUser | null>;

/**
 * GitHub App credentials used to mint installation tokens. Same shape as
 * `@laikacms/github`'s `GithubStorageRepository` — newline-escaped PEMs from
 * env vars are accepted and normalized.
 */
export interface GitHubAppCreds {
  readonly appId: string;
  readonly privateKey: string;
  readonly installationId: string | number;
}

export interface GitHubTarget {
  readonly owner: string;
  readonly repo: string;
  /** Defaults to `https://api.github.com`. */
  readonly apiBase?: string;
}

export interface GitGatewayOptions {
  /** Validates the incoming Bearer token. Throw or return null to reject. */
  readonly verifyToken: VerifyToken;
  /** GitHub App credentials for minting installation tokens. */
  readonly github: GitHubAppCreds & GitHubTarget;
  /**
   * If set, the user returned from `verifyToken` must have at least one of
   * these roles. Empty/undefined disables the check.
   */
  readonly allowedRoles?: ReadonlyArray<string>;
  /** Optional logger; defaults to a `console`-shaped no-op. */
  readonly logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
  /** User-Agent for outgoing GitHub requests. */
  readonly userAgent?: string;
}
