import { decrypt } from './lib/jwe-decrypt.js';
import type { AuthConfig, RequestContext, ExtractJwtResult } from './types.js';

/**
 * Get tokens from encrypted cookies
 * 
 * @param config - Auth configuration
 * @param cookies - Cookies from the request (name -> value)
 * @returns Decrypted tokens
 */
export async function getTokenFromCookies<T extends 'accessToken' | 'refreshToken' | 'idToken'>(config: AuthConfig, type: T, cookies: Record<string, string | undefined>): Promise<string | undefined> {
  const cookiePrefix = config.cookiePrefix ?? 'auth';
  const cookieSalt = config.salt ?? cookiePrefix;
  
  // Decrypt access token
  const encryptedAccessToken = cookies[`${cookiePrefix}.${type}`];
  if (encryptedAccessToken) {
    const decrypted = await decrypt(
      encryptedAccessToken,
      config.secret,
      `${cookieSalt}.${type}`
    );
    if (decrypted?.token) {
      return decrypted.token;
    }
  }

  return undefined;
}

/**
 * Extract JWT from Authorization header
 * 
 * @param authorization - Authorization header value (e.g., "Bearer eyJ...")
 * @returns Access token if present, undefined otherwise
 */
export async function getTokenFromHeader(config: AuthConfig, type: 'accessToken' | 'refreshToken' | 'idToken', authorization: string | undefined): Promise<string | undefined> {
  const cookiePrefix = config.cookiePrefix ?? 'auth';
  const cookieSalt = config.salt ?? cookiePrefix;
  
  if (!authorization) return undefined;
  
  // Support "Bearer <token>" format
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const encryptedAccessToken = match[1];
    const decrypted = await decrypt(
      encryptedAccessToken,
      config.secret,
      `${cookieSalt}.${type}`
    );
    if (decrypted?.token) {
      return decrypted.token;
    }
  }
  
  return undefined;
}

/**
 * Extract JWT tokens from request - checks Authorization header first, then cookies
 * 
 * This function extracts tokens without validating them. The user is responsible
 * for validating the JWT using their preferred library (e.g., aws-jwt-verify, jose).
 * 
 * Priority:
 * 1. Authorization header (Bearer token) - returns raw token
 * 2. Encrypted cookies - decrypts and returns tokens
 * 
 * @param config - Auth configuration
 * @param request - Request context with cookies and authorization header
 * @returns ExtractJwtResult with source, tokens, and whether any were found
 */
export async function extractJwt<T extends 'accessToken' | 'refreshToken' | 'idToken'>(
  config: AuthConfig,
  type: T,
  request: RequestContext
): Promise<ExtractJwtResult<T>> {
  // First, check Authorization header
  const headerToken = await getTokenFromHeader(config, type, request.authorization);
  if (headerToken) {
    return {
      source: 'header',
      token: headerToken,
      type,
      found: true,
    };
  }

  // Fall back to cookies
  const token = await getTokenFromCookies(config, type, request.cookies);
  
  if (token) {
    return {
      source: 'cookie',
      token,
      type,
      found: true,
    };
  }

  return {
    source: 'none',
    token: '',
    type,
    found: false,
  };
}

export const extractAccessToken = async (config: AuthConfig, request: RequestContext) => {
  return extractJwt(config, 'accessToken', request);
}

export const extractRefreshToken = async (config: AuthConfig, request: RequestContext) => {
  return extractJwt(config, 'refreshToken', request);
}

export const extractIdToken = async (config: AuthConfig, request: RequestContext) => {
  return extractJwt(config, 'idToken', request);
}
