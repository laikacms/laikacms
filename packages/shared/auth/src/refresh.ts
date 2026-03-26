import { decrypt } from './lib/jwe-decrypt.js';
import { encrypt } from './lib/jwe-encrypt.js';
import { getCookieOptions } from './types.js';
import type { AuthConfig, AuthResult, RequestContext, TokenResponse } from './types.js';

/**
 * Refresh tokens using refresh token
 * 
 * @param config - Auth configuration
 * @param request - Request context with URL and cookies
 * @returns AuthResult with new token cookies or error
 */
export async function refresh(config: AuthConfig, request: RequestContext): Promise<AuthResult> {
  const cookiePrefix = config.cookiePrefix ?? 'auth';
  const cookieSalt = config.salt ?? cookiePrefix;
  const url = new URL(request.url);

  // Get and decrypt refresh token from cookie
  const encryptedRefreshToken = request.cookies[`${cookiePrefix}.refreshToken`];
  
  if (!encryptedRefreshToken) {
    return {
      type: 'error',
      status: 401,
      error: 'No refresh token found',
      cookies: [],
      deleteCookies: [],
    };
  }

  const decrypted = await decrypt(
    encryptedRefreshToken,
    config.secret,
    `${cookieSalt}.refreshToken`
  );

  if (!decrypted?.token) {
    return {
      type: 'error',
      status: 401,
      error: 'Invalid refresh token',
      cookies: [],
      deleteCookies: [],
    };
  }

  // Exchange refresh token for new tokens
  let tokenResponse: TokenResponse;
  try {
    tokenResponse = await refreshTokens(
      config.tokenEndpoint,
      config.clientId,
      config.clientSecret,
      decrypted.token
    );
  } catch (err) {
    return {
      type: 'error',
      status: 500,
      error: `Token refresh failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      cookies: [],
      deleteCookies: [],
    };
  }

  // Cookie options for token cookies (strict defaults)
  const maxAge = config.cookie?.maxAge ?? 60 * 60 * 24 * 365; // 1 year default
  const tokenCookieOptions = getCookieOptions(config, url, { maxAge });

  const cookies = [];

  // Encrypt and set new access token cookie
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

  // Update refresh token if a new one was returned
  // Refresh token should only be sent to /auth/v1/refresh for security
  if (tokenResponse.refresh_token) {
    const newEncryptedRefreshToken = await encrypt(
      { token: tokenResponse.refresh_token },
      config.secret,
      `${cookieSalt}.refreshToken`
    );
    const refreshTokenPath = config.refreshTokenPath ?? '/auth/v1/refresh';
    cookies.push({
      name: `${cookiePrefix}.refreshToken`,
      value: newEncryptedRefreshToken,
      options: {
        ...tokenCookieOptions,
        path: refreshTokenPath,
      },
    });
  }

  return {
    type: 'json',
    status: 200,
    body: { success: true },
    cookies,
    deleteCookies: [],
  };
}

/**
 * Exchange refresh token for new tokens
 */
async function refreshTokens(
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
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