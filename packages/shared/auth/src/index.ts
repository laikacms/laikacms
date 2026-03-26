// Main factory function and Auth interface
export { createAuth, type Auth } from './auth.js';

// Individual functions (for tree-shaking)
export { signin } from './signin.js';
export { callback } from './callback.js';
export { signout } from './signout.js';
export { refresh } from './refresh.js';
export { extractJwt, getTokenFromCookies, getTokenFromHeader } from './extract-jwt.js';

// Types
export type {
  AuthConfig,
  CookieConfig,
  TokenResponse,
  CookieToSet,
  CookieOptions,
  RequestContext,
  AuthResult,
  ExtractJwtResult,
} from './types.js';
