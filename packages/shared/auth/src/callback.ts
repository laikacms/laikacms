import { encrypt } from './lib/jwe-encrypt.js';
import {
  validateCSRFTokens,
  parseState,
  NONCE_COOKIE_NAME_SUFFIX,
  NONCE_HMAC_COOKIE_NAME_SUFFIX,
  PKCE_COOKIE_NAME_SUFFIX,
} from './lib/csrf.js';
import { getCookieOptions } from './types.js';
import type { AuthConfig, AuthResult, RequestContext, TokenResponse } from './types.js';

/**
 * Handle OAuth2 callback - exchanges authorization code for tokens
 * Validates CSRF tokens and returns encrypted token cookies
 * 
 * @param config - Auth configuration
 * @param request - Request context with URL, query params, and cookies
 * @returns AuthResult with redirect URL and cookies to set
 */
export async function callback(config: AuthConfig, request: RequestContext): Promise<AuthResult> {
  const cookiePrefix = config.cookiePrefix ?? 'auth';
  const cookieSalt = config.salt ?? cookiePrefix;
  const url = new URL(request.url);

  // Get authorization code and state from query params
  const code = request.query.code;
  const state = request.query.state;
  const error = request.query.error;
  const errorDescription = request.query.error_description;

  // Handle OAuth errors
  if (error) {
    return {
      type: 'error',
      status: 400,
      error: `OAuth error: ${error} - ${errorDescription ?? 'Unknown error'}`,
      cookies: [],
      deleteCookies: [],
    };
  }

  if (!code) {
    return {
      type: 'error',
      status: 400,
      error: 'Missing authorization code',
      cookies: [],
      deleteCookies: [],
    };
  }

  if (!state) {
    return {
      type: 'error',
      status: 400,
      error: 'Missing state parameter',
      cookies: [],
      deleteCookies: [],
    };
  }

  // Get CSRF cookies
  const nonce = request.cookies[`${cookiePrefix}.${NONCE_COOKIE_NAME_SUFFIX}`];
  const nonceHmac = request.cookies[`${cookiePrefix}.${NONCE_HMAC_COOKIE_NAME_SUFFIX}`];
  const pkce = request.cookies[`${cookiePrefix}.${PKCE_COOKIE_NAME_SUFFIX}`];

  // Validate CSRF tokens
  try {
    validateCSRFTokens(state, nonce, nonceHmac, pkce, config.csrfSecret);
  } catch (err) {
    return {
      type: 'error',
      status: 400,
      error: `CSRF validation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      cookies: [],
      deleteCookies: [],
    };
  }

  // Parse state to get redirect URI
  const parsedState = parseState(state);
  const returnTo = parsedState.redirect_uri;

  // Build callback URL (must match the one used in signin)
  const callbackPath = config.callbackPath ?? '/auth/v1/callback';
  const redirectUri = `${url.protocol}//${url.host}${callbackPath}`;

  // Exchange code for tokens (with PKCE verifier)
  let tokenResponse: TokenResponse;
  try {
    tokenResponse = await exchangeCodeForTokens(
      config.tokenEndpoint,
      config.clientId,
      config.clientSecret,
      code,
      redirectUri,
      pkce! // PKCE verifier
    );
  } catch (err) {
    return {
      type: 'error',
      status: 500,
      error: `Token exchange failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      cookies: [],
      deleteCookies: [],
    };
  }

  // Cookie options for token cookies (strict defaults)
  const maxAge = config.cookie?.maxAge ?? 60 * 60 * 24 * 365; // 1 year default
  const tokenCookieOptions = getCookieOptions(config, url, { maxAge });

  const cookies = [];
  const deleteCookies = [
    `${cookiePrefix}.${NONCE_COOKIE_NAME_SUFFIX}`,
    `${cookiePrefix}.${NONCE_HMAC_COOKIE_NAME_SUFFIX}`,
    `${cookiePrefix}.${PKCE_COOKIE_NAME_SUFFIX}`,
  ];

  // Encrypt and set access token cookie
  if (tokenResponse.access_token) {
    const encryptedAccessToken = await encrypt(
      { token: tokenResponse.access_token },
      config.secret,
      `${cookieSalt}.accessToken`
    );
    cookies.push({
      name: `${cookiePrefix}.accessToken`,
      value: encryptedAccessToken,
      options: tokenCookieOptions,
    });
  }

  // Note: We don't store the ID token in a cookie as we only need the access token

  // Encrypt and set refresh token cookie
  // Refresh token should only be sent to /auth/v1/refresh for security
  if (tokenResponse.refresh_token) {
    const encryptedRefreshToken = await encrypt(
      { token: tokenResponse.refresh_token },
      config.secret,
      `${cookieSalt}.refreshToken`
    );
    const refreshTokenPath = config.refreshTokenPath ?? '/auth/v1/refresh';
    cookies.push({
      name: `${cookiePrefix}.refreshToken`,
      value: encryptedRefreshToken,
      options: {
        ...tokenCookieOptions,
        path: refreshTokenPath,
      },
    });
  }

  return {
    type: 'redirect',
    status: 302,
    redirectUrl: returnTo,
    cookies,
    deleteCookies,
  };
}

/**
 * Exchange authorization code for tokens (with PKCE)
 */
async function exchangeCodeForTokens(
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string | undefined,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Add client secret if provided (confidential client)
  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} - ${errorText}`);
  }

  return response.json() as Promise<TokenResponse>;
}