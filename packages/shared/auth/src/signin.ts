import {
  generateCSRFTokens,
  NONCE_COOKIE_NAME_SUFFIX,
  NONCE_HMAC_COOKIE_NAME_SUFFIX,
  PKCE_COOKIE_NAME_SUFFIX,
  CSRF_CONFIG,
} from './lib/csrf.js';
import { getCookieOptions } from './types.js';
import type { AuthConfig, AuthResult, RequestContext } from './types.js';

/**
 * Initiate sign-in - generates authorization URL and CSRF cookies
 * 
 * @param config - Auth configuration
 * @param request - Request context with URL and query params
 * @returns AuthResult with redirect URL and cookies to set
 */
export function signin(config: AuthConfig, request: RequestContext): AuthResult {
  // Build callback URL
  const url = new URL(request.url);
  const callbackPath = config.callbackPath ?? '/auth/v1/callback';
  const redirectUri = `${url.protocol}//${url.host}${callbackPath}`;

  // Get the original URL the user wanted to visit (for redirect after login)
  const returnTo = request.query.returnTo ?? '/';

  // Generate CSRF tokens
  const csrfTokens = generateCSRFTokens(returnTo, config.csrfSecret);

  // CSRF cookie options (short-lived, for the OAuth flow only)
  // Note: CSRF cookies use 'Lax' sameSite to allow the OAuth redirect flow
  const cookiePrefix = config.cookiePrefix ?? 'auth';
  const csrfCookieOptions = getCookieOptions(config, url, {
    sameSite: 'Lax', // Required for OAuth redirect flow
    maxAge: CSRF_CONFIG.nonceMaxAge, // 24 hours
  });

  // Build authorization URL with PKCE
  const scopes = config.scopes ?? 'openid profile email';

  const authUrl = new URL(config.authorizationEndpoint);
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', csrfTokens.state!);
  authUrl.searchParams.set('code_challenge', csrfTokens.pkceHash!);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return {
    type: 'redirect',
    status: 302,
    redirectUrl: authUrl.toString(),
    cookies: [
      {
        name: `${cookiePrefix}.${NONCE_COOKIE_NAME_SUFFIX}`,
        value: csrfTokens.nonce!,
        options: csrfCookieOptions,
      },
      {
        name: `${cookiePrefix}.${NONCE_HMAC_COOKIE_NAME_SUFFIX}`,
        value: csrfTokens.nonceHmac!,
        options: csrfCookieOptions,
      },
      {
        name: `${cookiePrefix}.${PKCE_COOKIE_NAME_SUFFIX}`,
        value: csrfTokens.pkce!,
        options: csrfCookieOptions,
      },
    ],
    deleteCookies: [],
  };
}