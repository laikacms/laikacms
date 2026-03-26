import { signin } from './signin.js';
import { callback } from './callback.js';
import { signout } from './signout.js';
import { refresh } from './refresh.js';
import { extractAccessToken, extractIdToken, extractRefreshToken } from './extract-jwt.js';
import type {
  AuthConfig,
  AuthResult,
  ExtractJwtResult,
  RequestContext,
} from './types.js';

/**
 * Auth instance with all handlers configured
 */
export interface Auth {
  /** Initiate sign-in - returns redirect to OAuth2 authorization endpoint */
  signin: (request: RequestContext) => AuthResult;
  /** Handle OAuth2 callback - exchanges code for tokens */
  callback: (request: RequestContext) => Promise<AuthResult>;
  /** Sign out - revokes tokens and clears cookies */
  signout: (request: RequestContext) => Promise<AuthResult>;
  /** Refresh tokens using refresh token */
  refresh: (request: RequestContext) => Promise<AuthResult>;
  /** 
   * Extract JWT from request (Authorization header or cookies)
   * Returns raw tokens - user is responsible for validation
   */
  extractAccessToken: (request: RequestContext) => Promise<ExtractJwtResult<'accessToken'>>;
  extractRefreshToken: (request: RequestContext) => Promise<ExtractJwtResult<'refreshToken'>>;
  extractIdToken: (request: RequestContext) => Promise<ExtractJwtResult<'idToken'>>;
  /** The auth configuration */
  config: AuthConfig;
}

/**
 * Creates an auth instance with all handlers configured
 *
 * Usage:
 * ```ts
 * import { createAuth } from 'cookie-auth';
 *
 * const auth = createAuth({
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   authorizationEndpoint: 'https://auth.example.com/authorize',
 *   tokenEndpoint: 'https://auth.example.com/token',
 *   jwksUri: 'https://auth.example.com/.well-known/jwks.json',
 *   cookieSecret: 'your-32-char-secret-key-here!!!',
 *   csrfSecret: 'another-secret-for-csrf-tokens!',
 * });
 *
 * // In your request handler:
 * const request = {
 *   url: 'https://example.com/api/data',
 *   method: 'GET',
 *   cookies: parseCookies(req.headers.cookie),
 *   query: parseQuery(req.url),
 *   authorization: req.headers.authorization,
 * };
 *
 * // Extract JWT (from header or cookies)
 * const result = await auth.extractJwt(request);
 * 
 * if (result.found) {
 *   // Validate the token using your preferred library
 *   console.log('Token source:', result.source);
 *   console.log('Access token:', result.tokens.accessToken);
 * } else {
 *   // No tokens found - return 401 or redirect to signin
 * }
 * ```
 */
export function createAuth(config: AuthConfig): Auth {
  return {
    signin: (request) => signin(config, request),
    callback: (request) => callback(config, request),
    signout: (request) => signout(config, request),
    refresh: (request) => refresh(config, request),
    extractAccessToken: (request) => extractAccessToken(config, request),
    extractRefreshToken: (request) => extractRefreshToken(config, request),
    extractIdToken: (request) => extractIdToken(config, request),
    config,
  };
}