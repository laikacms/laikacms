

import { AssetsRepository } from '@laikacms/assets';
import { buildAssetsApi } from '@laikacms/assets-api';
import { AuthenticationError, Header, Logger, NotFoundError, TemplateLiteral as TL, Url } from '@laikacms/core';
import { addTimingJitter } from '@laikacms/crypto';
import { DocumentsRepository } from '@laikacms/documents';
import { buildJsonApi as buildDocumentsApi } from '@laikacms/documents-api';
import { errorToJsonApiMapper, isLaikaError } from '@laikacms/json-api';
import { StorageRepository } from '@laikacms/storage';
import { buildJsonApi as buildStorageApi } from '@laikacms/storage-api';

/**
 * Security constants for the API
 * These can be used by consumers to configure their implementations
 */
export const SECURITY_DEFAULTS = {
  /** Maximum length for access tokens in requests */
  MAX_TOKEN_LENGTH: 2048,
  /** Maximum length for API keys */
  MAX_API_KEY_LENGTH: 512,
  /** Minimum token entropy bits for post-quantum security */
  MIN_TOKEN_ENTROPY_BITS: 256,
} as const;

/**
 * Default user interface with required fields.
 * Consumers can extend this by declaring the module:
 *
 * @example
 * ```typescript
 * declare module '@laikacms/decap-api' {
 *   interface User {
 *     role: 'admin' | 'editor';
 *     organizationId: string;
 *   }
 * }
 * ```
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  passwordHash?: string;
}

export interface DecapOptions {
  documents: DocumentsRepository;
  storage: StorageRepository;
  /**
   * Optional assets repository for binary file storage (images, videos, etc.)
   * If provided, an /assets endpoint will be available using the assets-api.
   */
  assets?: AssetsRepository;
  basePath?: string | undefined;
  /**
   * Authenticate a Bearer access token and return the user.
   * This is the primary authentication method for API requests.
   */
  authenticateAccessToken: (rawToken: string) => Promise<User>;
  /**
   * Optional: Authenticate an API key and return the user.
   * API keys can be passed via X-API-Key header or Authorization: ApiKey <key>
   */
  authenticateApiToken?: (token: string) => Promise<User>;
  logger?: Logger | undefined;
}

export interface DecapApi {
  fetch(request: Request): Promise<Response>;
  authenticateRequest(request: Request): Promise<Response | User>;
}

/**
 * Validate token input length to prevent DoS attacks
 */
function validateTokenInput(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') {
    return null;
  }
  if (token.length > SECURITY_DEFAULTS.MAX_TOKEN_LENGTH) {
    return null;
  }
  return token;
}

/**
 * Security headers for API responses
 */
const SECURITY_HEADERS = {
  'Content-Type': 'application/vnd.api+json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
} as const;

export const decapApi = (options: DecapOptions): DecapApi => {
  const { documents, storage, assets, authenticateAccessToken, authenticateApiToken, basePath } = options;

  const base = Url.normalize(basePath ?? '');

  const healthEndpoint = TL.url`${base}/health`;
  const storageEndpoint = TL.url`${base}/storage`;
  const documentsEndpoint = TL.url`${base}/documents`;
  const assetsEndpoint = TL.url`${base}/assets`;
  const sessionEndpoint = TL.url`${base}/session`;

  const authenticateRequest = async (request: Request): Promise<Response | User> => {
    const authHeader = request.headers.get('Authorization') || undefined;
    const apiKeyHeader = request.headers.get('X-API-Key') || undefined;
    const apiKeyAuth = authHeader ? Header.ExtractAuthorizationApiKey(authHeader) : undefined;
    const urlApiKey = new URL(request.url).searchParams.get('api_key') || undefined;

    try {
      // Validate and extract API key with length limits
      const rawApiKey = apiKeyHeader || apiKeyAuth || urlApiKey;
      const apiKey = rawApiKey ? validateTokenInput(rawApiKey) : null;
      
      if (rawApiKey && !apiKey) {
        // API key was provided but failed validation
        throw new AuthenticationError('Invalid API key format');
      }
      
      if (apiKey) {
        // If an API key is provided, only try API key authentication
        if (!authenticateApiToken) {
          options.logger?.error('API key authentication not configured');
          throw new AuthenticationError('API key authentication not configured');
        }
        return await authenticateApiToken(apiKey);
      } else {
        // Regular Bearer token authentication
        const rawToken = Header.ExtractAuthorizationBearerToken(authHeader);
        const token = validateTokenInput(rawToken);
        
        if (!token) {
          throw new AuthenticationError('Invalid or missing authentication token');
        }
        
        // Authenticate the token
        return  await authenticateAccessToken(token);
      }
    } catch (e) {
      options.logger?.error('Authentication failed:', e);
      const error = isLaikaError(e) ? e : new AuthenticationError('Authentication failed');
      await addTimingJitter();
      return new Response(
        JSON.stringify(errorToJsonApiMapper(error)),
        { status: 401, headers: SECURITY_HEADERS },
      );
    }
  };
  
  return {
    authenticateRequest,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = Url.normalize(url.pathname);

      // Health endpoint (no authentication required)
      if (pathname === healthEndpoint) {
        options.logger?.debug('Health check endpoint');
        return new Response(
          JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
          { status: 200, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' } },
        );
      }

      // All other endpoints require authentication
      const authHeader = request.headers.get('Authorization') || undefined;
      const apiKeyHeader = request.headers.get('X-API-Key') || undefined;
      const apiKeyAuth = authHeader ? Header.ExtractAuthorizationApiKey(authHeader) : undefined;

      const authenticated = await authenticateRequest(request);
      if (authenticated instanceof Response) {
        return authenticated;
      }
      const user = authenticated;

      if (pathname.startsWith(sessionEndpoint)) {
        options.logger?.debug('Session endpoint for user:', user.id);
        
        // Return user data (excluding sensitive fields like passwordHash)
        // The user is responsible for not passing in sensitive data, except for the passwordHash
        const { passwordHash, ...safeUserData } = user;
        
        return new Response(
          JSON.stringify({
            data: {
              type: 'session',
              id: user.id || user.email,
              attributes: {
                ...safeUserData,
              },
            },
          }),
          { status: 200, headers: SECURITY_HEADERS },
        );
      }

      else if (pathname.startsWith(storageEndpoint)) {
        const storageApi = buildStorageApi({ repo: storage, basePath: `${base}/storage`, logger: options.logger });
        return storageApi.fetch(request);
      }
      else if (pathname.startsWith(documentsEndpoint)) {
        const documentsApi = buildDocumentsApi({ repo: documents, basePath: `${base}/documents`, logger: options.logger });
        return documentsApi.fetch(request);
      }
      else if (assets && pathname.startsWith(assetsEndpoint)) {
        const assetsApi = buildAssetsApi({ repository: assets, basePath: `${base}/assets` });
        return assetsApi.fetch(request);
      }
      else {
        options.logger?.debug('Endpoint not found:', pathname);
        return new Response(
          JSON.stringify(errorToJsonApiMapper(new NotFoundError('Endpoint not found'))),
          { status: 404, headers: SECURITY_HEADERS },
        );
      }
    }
  };
};
