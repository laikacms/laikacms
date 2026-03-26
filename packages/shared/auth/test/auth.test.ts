import { describe, it, expect } from 'vitest';
import { createAuth, signin, signout, extractJwt, getTokenFromHeader } from '../src/index.js';
import type { AuthConfig, RequestContext, CookieToSet } from '../src/types.js';

describe('Auth handlers', () => {
  const config: AuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    jwksUri: 'https://auth.example.com/.well-known/jwks.json',
    cookieSecret: 'test-cookie-secret-32-chars!!!!',
    csrfSecret: 'test-csrf-secret-32-characters!',
    callbackPath: '/auth/v1/callback/cognito',
    cookiePrefix: 'test',
  };

  describe('createAuth', () => {
    it('should create auth instance with all methods', () => {
      const auth = createAuth(config);
      
      expect(auth.signin).toBeDefined();
      expect(auth.callback).toBeDefined();
      expect(auth.signout).toBeDefined();
      expect(auth.refresh).toBeDefined();
      expect(auth.extractJwt).toBeDefined();
      expect(auth.getTokensFromCookies).toBeDefined();
      expect(auth.getTokenFromHeader).toBeDefined();
      expect(auth.config).toBe(config);
    });
  });

  describe('signin', () => {
    it('should return redirect to authorization endpoint', () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/signin',
        method: 'GET',
        cookies: {},
        query: {},
      };
      
      const result = signin(config, request);
      
      expect(result.type).toBe('redirect');
      expect(result.status).toBe(302);
      expect(result.redirectUrl).toBeDefined();
      expect(result.redirectUrl).toContain('https://auth.example.com/authorize');
      expect(result.redirectUrl).toContain('client_id=test-client-id');
      expect(result.redirectUrl).toContain('response_type=code');
      expect(result.redirectUrl).toContain('code_challenge=');
      expect(result.redirectUrl).toContain('code_challenge_method=S256');
    });

    it('should return CSRF cookies', () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/signin',
        method: 'GET',
        cookies: {},
        query: {},
      };
      
      const result = signin(config, request);
      
      expect(result.cookies.length).toBe(3);
      
      const cookieNames = result.cookies.map((c: CookieToSet) => c.name);
      expect(cookieNames).toContain('test.nonce');
      expect(cookieNames).toContain('test.nonceHmac');
      expect(cookieNames).toContain('test.pkce');
    });

    it('should include returnTo in state', () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/signin?returnTo=/dashboard',
        method: 'GET',
        cookies: {},
        query: { returnTo: '/dashboard' },
      };
      
      const result = signin(config, request);
      
      expect(result.redirectUrl).toContain('state=');
    });
  });

  describe('extractJwt', () => {
    it('should return found: false when no tokens', async () => {
      const request: RequestContext = {
        url: 'http://localhost/protected/page',
        method: 'GET',
        cookies: {},
        query: {},
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
      expect(result.tokens.accessToken).toBeUndefined();
    });

    it('should extract token from Authorization header', async () => {
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {},
        query: {},
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(true);
      expect(result.source).toBe('header');
      expect(result.tokens.accessToken).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    });
  });

  describe('getTokenFromHeader', () => {
    it('should extract Bearer token', () => {
      const token = getTokenFromHeader('Bearer eyJhbGciOiJIUzI1NiJ9.test');
      expect(token).toBe('eyJhbGciOiJIUzI1NiJ9.test');
    });

    it('should handle case-insensitive Bearer', () => {
      const token = getTokenFromHeader('bearer eyJhbGciOiJIUzI1NiJ9.test');
      expect(token).toBe('eyJhbGciOiJIUzI1NiJ9.test');
    });

    it('should return undefined for invalid format', () => {
      expect(getTokenFromHeader('Basic abc123')).toBeUndefined();
      expect(getTokenFromHeader('')).toBeUndefined();
      expect(getTokenFromHeader(undefined)).toBeUndefined();
    });
  });

  describe('signout', () => {
    it('should return redirect and delete cookies', async () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/signout',
        method: 'GET',
        cookies: {},
        query: {},
      };
      
      const result = await signout(config, request);
      
      expect(result.type).toBe('redirect');
      expect(result.status).toBe(302);
      expect(result.redirectUrl).toBe('/');
      expect(result.deleteCookies.length).toBe(2);
      expect(result.deleteCookies).toContain('test.accessToken');
      expect(result.deleteCookies).toContain('test.refreshToken');
    });

    it('should redirect to returnTo', async () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/signout?returnTo=/goodbye',
        method: 'GET',
        cookies: {},
        query: { returnTo: '/goodbye' },
      };
      
      const result = await signout(config, request);
      
      expect(result.type).toBe('redirect');
      expect(result.status).toBe(302);
      expect(result.redirectUrl).toBe('/goodbye');
    });
  });
});