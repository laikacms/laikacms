import { decrypt } from './lib/jwe-decrypt.js';
import type { AuthConfig, AuthResult, RequestContext } from './types.js';

/**
 * Sign out - revokes tokens and clears cookies
 * 
 * @param config - Auth configuration
 * @param request - Request context with URL, query params, and cookies
 * @returns AuthResult with redirect URL and cookies to delete
 */
export async function signout(config: AuthConfig, request: RequestContext): Promise<AuthResult> {
  const cookiePrefix = config.cookiePrefix ?? 'auth';
  const cookieSalt = config.salt ?? cookiePrefix;

  // Try to revoke refresh token if revocation endpoint is configured
  if (config.revocationEndpoint) {
    const encryptedRefreshToken = request.cookies[`${cookiePrefix}.refreshToken`];

    if (encryptedRefreshToken) {
      const decrypted = await decrypt(
        encryptedRefreshToken,
        config.secret,
        `${cookieSalt}.refreshToken`
      );

      if (decrypted?.token) {
        await revokeToken(
          config.revocationEndpoint,
          config.clientId,
          config.clientSecret,
          decrypted.token
        ).catch((error) => {
          console.error('Error revoking refresh token:', error);
        });
      }
    }
  }

  // Redirect to home or specified URL
  const returnTo = request.query.returnTo ?? '/';

  return {
    type: 'redirect',
    status: 302,
    redirectUrl: returnTo,
    cookies: [],
    deleteCookies: [
      `${cookiePrefix}.accessToken`,
      `${cookiePrefix}.refreshToken`,
    ],
  };
}

/**
 * Revoke a token at the OAuth2 revocation endpoint
 */
async function revokeToken(
  revocationEndpoint: string,
  clientId: string,
  clientSecret: string | undefined,
  token: string
): Promise<void> {
  const body = new URLSearchParams({
    client_id: clientId,
    token: token,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Add client secret if provided (confidential client)
  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch(revocationEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token revocation failed: ${response.status} - ${errorText}`);
  }
}