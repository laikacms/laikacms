/**
 * Cookie configuration options
 */
export interface CookieConfig {
  /** SameSite attribute (default: 'Strict') */
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** HttpOnly attribute (default: true) */
  httpOnly?: boolean;
  /** Secure attribute (default: auto-detect from request URL) */
  secure?: boolean;
  /** Cookie path (default: '/') */
  path?: string;
  /** Cookie domain (optional) */
  domain?: string;
  /** Max age for token cookies in seconds (default: 1 year) */
  maxAge?: number;
}

/**
 * OAuth2/OIDC configuration
 */
export interface AuthConfig {
  /** OAuth2/OIDC client ID */
  clientId: string;
  /** OAuth2/OIDC client secret (for confidential clients) */
  clientSecret?: string;
  /** Authorization endpoint URL */
  authorizationEndpoint: string;
  /** Token endpoint URL */
  tokenEndpoint: string;
  /** JWKS URI for token verification */
  jwksUri: string;
  /** Token revocation endpoint (optional) */
  revocationEndpoint?: string;
  /** OAuth2 scopes (default: 'openid profile email') */
  scopes?: string;
  /** Callback URL path (default: '/auth/v1/callback') */
  callbackPath?: string;
  /** Refresh token cookie path (default: '/auth/v1/refresh') - restricts refresh token to only be sent to this path */
  refreshTokenPath?: string;
  /** Cookie secret for encrypted cookies (or array for rotation) */
  secret: string | string[];
  /** Salt for JWE key derivation (default: cookiePrefix or 'auth') */
  salt?: string;
  /** Cookie name prefix (default: 'auth') */
  cookiePrefix?: string;
  /** CSRF protection secret (required for security) */
  csrfSecret: string;
  /**
   * Cookie configuration options
   * Defaults are as strict as possible:
   * - sameSite: 'Strict'
   * - httpOnly: true
   * - secure: auto-detect (true for HTTPS)
   * - path: '/'
   */
  cookie?: CookieConfig;
  /** @deprecated Use cookie.secure instead */
  secureCookies?: boolean;
}

/**
 * Token response from OAuth2 token endpoint
 */
export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Tokens stored in cookies or from Authorization header
 */

/**
 * Cookie to be set in the response
 */
export interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * Cookie options
 */
export interface CookieOptions {
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  maxAge?: number;
  expires?: Date;
  domain?: string;
}

/**
 * Request context - framework-agnostic representation of an HTTP request
 */
export interface RequestContext {
  /** Full request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Cookies from the request (name -> value) */
  cookies: Record<string, string | undefined>;
  /** Query parameters (name -> value) */
  query: Record<string, string | undefined>;
  /** Authorization header value (optional) */
  authorization?: string;
}

/**
 * Auth result - returned by auth handlers
 */
export interface AuthResult {
  /** Type of result */
  type: 'redirect' | 'json' | 'error';
  /** HTTP status code */
  status: number;
  /** Redirect URL (for type: 'redirect') */
  redirectUrl?: string;
  /** JSON body (for type: 'json') */
  body?: unknown;
  /** Error message (for type: 'error') */
  error?: string;
  /** Cookies to set in the response */
  cookies: CookieToSet[];
  /** Cookies to delete from the response */
  deleteCookies: string[];
}

/**
 * Result from extractJwt function
 */
export interface ExtractJwtResult<T extends 'accessToken' | 'refreshToken' | 'idToken'> {
  /** Source of the token: 'cookie' (encrypted), 'header' (Bearer token), or 'none' */
  source: 'cookie' | 'header' | 'none';
  /** Extracted tokens (decrypted from cookies or raw from header) */
  token: string;
  /** Token type */
  type: T;
  /** Whether any tokens were found */
  found: boolean;
}

/**
 * Get cookie options with strict defaults
 */
export function getCookieOptions(config: AuthConfig, url: URL, overrides?: Partial<CookieOptions>): CookieOptions {
  const cookieConfig = config.cookie ?? {};
  const isSecure = cookieConfig.secure ?? config.secureCookies ?? (url.protocol === 'https:');
  
  return {
    path: cookieConfig.path ?? '/',
    secure: isSecure,
    httpOnly: cookieConfig.httpOnly ?? true,
    sameSite: cookieConfig.sameSite ?? 'Strict',
    domain: cookieConfig.domain,
    ...overrides,
  };
}

export interface DecryptedToken {
  token: string;
  iat: number;
  exp: number;
  jti: string;
}
