/**
 * Unit tests for packages/decap/src/decap-oauth2/oauth2.ts
 *
 * Covers:
 *  - handleAuthorize GET: 200 HTML login form, PKCE params preserved
 *  - handleAuthorize GET: TOTP session present (valid → TOTP page, unknown → login page fallthrough)
 *  - handleAuthorize POST: correct creds → redirect with code; bad creds → error page; TOTP required → TOTP page
 *  - handleAuthorize POST: TOTP verification (valid code → 302; invalid code → 401; replay → 401; expired session → 401)
 *  - handleToken authorization_code: valid PKCE → tokens; mismatched code_verifier → invalid_grant
 *  - handleRefreshTokenGrant: valid → new session + old invalidated; expired → invalid_grant; unknown → invalid_grant
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decapOauth2, handleAuthorize, handleToken } from './oauth2.js';
import type { AuthorizationCode, OAuthCallbacks, OAuthConfig, OAuthSession, User } from './oauth2.js';

// ---------------------------------------------------------------------------
// Mock laikacms/crypto so tests don't run bcrypt (slow) or timing delays
// ---------------------------------------------------------------------------

vi.mock('laikacms/crypto', () => ({
  addTimingJitter: vi.fn().mockResolvedValue(undefined),
  constantTimeEqual: vi.fn().mockImplementation((a: string, b: string) => Promise.resolve(a === b)),
  generateSecureRandomString: vi.fn().mockImplementation((len: number) => 'x'.repeat(len)),
  sha256: vi.fn().mockImplementation(async (plain: string) => {
    // Use real Web Crypto so PKCE verification actually works in tests.
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }),
  verifyPassword: vi.fn(),
  // Cost 12 — the same factor real hashes use. A cheaper dummy makes the
  // no-such-user branch measurably faster and reintroduces the enumeration
  // oracle this constant exists to close.
  PASSWORD_CONSTANTS: {
    MIN_ROUNDS: 12,
    MAX_PASSWORD_LENGTH: 1024,
    RECOMMENDED_ROUNDS: 14,
    DUMMY_HASH: '$2a$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  },
}));

vi.mock('./totp/totp.js', () => ({
  setupOAuthTOTP: vi.fn(),
  verifyOAuthTOTPSetup: vi.fn(),
  verifyOAuthTOTPWithReplayProtection: vi.fn(),
}));

// Import after mock registration so the mock is in place when the module loads.
import { verifyPassword } from 'laikacms/crypto';
import { verifyOAuthTOTPWithReplayProtection } from './totp/totp.js';

// ---------------------------------------------------------------------------
// PKCE helpers (S256)
// ---------------------------------------------------------------------------

async function sha256Base64url(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** Produces a 43-char code verifier and its S256 challenge. */
async function makePkce(): Promise<{ codeVerifier: string, codeChallenge: string }> {
  const codeVerifier = 'a'.repeat(43);
  const codeChallenge = await sha256Base64url(codeVerifier);
  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = 'test-client';
const REDIRECT_URI = 'https://example.com/callback';
const BASE_PATH = 'oauth2';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '$2a$10$placeholder',
    ...overrides,
  };
}

function makeCallbacks(overrides: Partial<OAuthCallbacks> = {}): OAuthCallbacks {
  return {
    getUserByEmail: vi.fn().mockResolvedValue(null),
    getUserById: vi.fn().mockResolvedValue(null),
    storeAuthorizationCode: vi.fn().mockResolvedValue(undefined),
    getAuthorizationCode: vi.fn().mockResolvedValue(null),
    deleteAuthorizationCode: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    getSessionByAccessToken: vi.fn().mockResolvedValue(null),
    getSessionByRefreshToken: vi.fn().mockResolvedValue(null),
    logoutSession: vi.fn().mockResolvedValue(undefined),
    logoutAll: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeConfig(callbacks: OAuthCallbacks, overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    callbacks,
    clientId: CLIENT_ID,
    basePath: BASE_PATH,
    allowedRedirectUris: [REDIRECT_URI],
    ...overrides,
  };
}

function makeTotpCallbacks() {
  return {
    hasTotp: vi.fn().mockResolvedValue(false),
    getTotpSecret: vi.fn().mockResolvedValue(null),
    storeTotpSecret: vi.fn().mockResolvedValue(undefined),
    storePendingTotpSession: vi.fn().mockResolvedValue(undefined),
    getPendingTotpSession: vi.fn().mockResolvedValue(null),
    deletePendingTotpSession: vi.fn().mockResolvedValue(undefined),
    getLastTotpStep: vi.fn().mockResolvedValue(null),
    setLastTotpStep: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build the authorize URL with required PKCE and OAuth params. */
function authorizeUrl(codeChallenge: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `https://auth.example.com/${BASE_PATH}/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// handleAuthorize — GET
// ---------------------------------------------------------------------------

describe('handleAuthorize GET', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
  });

  it('returns 200 with HTML login form for a valid GET request', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'GET' });

    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<form');
    expect(body).toContain('email');
    expect(body).toContain('password');
  });

  it('preserves PKCE params in the login form (action URL contains code_challenge)', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'GET' });

    const response = await handleAuthorize(request, config);
    const body = await response.text();
    // The form action or page must encode the original PKCE code_challenge so a
    // subsequent POST can carry it forward.
    expect(body).toContain(pkce.codeChallenge);
  });

  it('returns 400 when response_type is missing', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
    });
    const request = new Request(
      `https://auth.example.com/${BASE_PATH}/authorize?${params}`,
      { method: 'GET' },
    );

    const response = await handleAuthorize(request, config);
    expect(response.status).toBe(400);
  });

  it('returns 401 when client_id is wrong', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'wrong-client',
      redirect_uri: REDIRECT_URI,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
    });
    const request = new Request(
      `https://auth.example.com/${BASE_PATH}/authorize?${params}`,
      { method: 'GET' },
    );

    const response = await handleAuthorize(request, config);
    expect(response.status).toBe(401);
  });

  it('returns 400 when code_challenge is missing', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
    });
    const request = new Request(
      `https://auth.example.com/${BASE_PATH}/authorize?${params}`,
      { method: 'GET' },
    );

    const response = await handleAuthorize(request, config);
    expect(response.status).toBe(400);
  });

  it('returns 400 when code_challenge_method is not S256', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'plain',
    });
    const request = new Request(
      `https://auth.example.com/${BASE_PATH}/authorize?${params}`,
      { method: 'GET' },
    );

    const response = await handleAuthorize(request, config);
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// handleAuthorize GET — CAPTCHA CSP (LCMS-354)
// ---------------------------------------------------------------------------

describe('handleAuthorize GET — CAPTCHA CSP', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
  });

  function makeCaptchaConfig(
    overrides: Partial<import('./oauth2.js').CaptchaConfig> = {},
  ): import('./oauth2.js').CaptchaConfig {
    return {
      enabled: true,
      widgetHtml: '<div class="captcha-widget"></div>',
      scriptHtml: '<script src="https://example-captcha.com/api.js"></script>',
      responseFieldName: 'captcha-response',
      verify: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  it('CSP uses captchaCspAdditions when provided (not hardcoded Cloudflare domains)', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks, {
      captcha: makeCaptchaConfig({
        captchaCspAdditions: ' https://example-captcha.com; frame-src https://example-captcha.com',
      }),
    });
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'GET' });

    const response = await handleAuthorize(request, config);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('https://example-captcha.com');
    expect(csp).not.toContain('challenges.cloudflare.com');
  });

  it('CSP contains no external CAPTCHA domains when captchaCspAdditions is omitted', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks, {
      captcha: makeCaptchaConfig(), // no captchaCspAdditions
    });
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'GET' });

    const response = await handleAuthorize(request, config);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).not.toContain('challenges.cloudflare.com');
    // script-src still present because CAPTCHA scripts are inline
    expect(csp).toContain("script-src 'unsafe-inline'");
  });

  it('CSP contains no captcha domains when captcha is disabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks); // no captcha
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'GET' });

    const response = await handleAuthorize(request, config);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).not.toContain('challenges.cloudflare.com');
  });

  it('passkey + captcha: CSP script-src includes captchaCspAdditions', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks, {
      captcha: makeCaptchaConfig({
        captchaCspAdditions: ' https://js.hcaptcha.com; frame-src https://newassets.hcaptcha.com',
      }),
      passkey: {
        rpName: 'Test',
        rpId: 'auth.example.com',
        origin: 'https://auth.example.com',
        callbacks: {
          storeCredential: vi.fn(),
          getCredentialById: vi.fn().mockResolvedValue(null),
          getCredentialsByUserId: vi.fn().mockResolvedValue([]),
          updateCredential: vi.fn(),
          deleteCredential: vi.fn(),
          storeChallenge: vi.fn(),
          consumeChallenge: vi.fn().mockResolvedValue(null),
          getUserById: vi.fn().mockResolvedValue(null),
          getUserByEmail: vi.fn().mockResolvedValue(null),
          storePendingPasskeySetupSession: vi.fn(),
          getPendingPasskeySetupSession: vi.fn().mockResolvedValue(null),
        },
      },
    });
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'GET' });

    const response = await handleAuthorize(request, config);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('https://js.hcaptcha.com');
    expect(csp).not.toContain('challenges.cloudflare.com');
  });
});

// ---------------------------------------------------------------------------
// handleAuthorize — POST (login flow)
// ---------------------------------------------------------------------------

describe('handleAuthorize POST — correct credentials → redirect with code', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
    vi.mocked(verifyPassword).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redirects 302 with a code when credentials are valid', async () => {
    const user = makeUser();
    const callbacks = makeCallbacks({
      getUserByEmail: vi.fn().mockResolvedValue(user),
    });
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'POST', body });

    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(302);
    const location = response.headers.get('Location')!;
    expect(location).toBeTruthy();
    const redirected = new URL(location);
    expect(redirected.searchParams.has('code')).toBe(true);
    expect(redirected.searchParams.get('code')!.length).toBeGreaterThan(0);
  });

  it('calls storeAuthorizationCode with correct PKCE data', async () => {
    const user = makeUser();
    const storedCodes: AuthorizationCode[] = [];
    const callbacks = makeCallbacks({
      getUserByEmail: vi.fn().mockResolvedValue(user),
      storeAuthorizationCode: vi.fn().mockImplementation(async (c: AuthorizationCode) => {
        storedCodes.push(c);
      }),
    });
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'POST', body });

    await handleAuthorize(request, config);

    expect(storedCodes).toHaveLength(1);
    expect(storedCodes[0].codeChallenge).toBe(pkce.codeChallenge);
    expect(storedCodes[0].codeChallengeMethod).toBe('S256');
    expect(storedCodes[0].redirectUri).toBe(REDIRECT_URI);
    expect(storedCodes[0].clientId).toBe(CLIENT_ID);
  });

  it('preserves state parameter in the redirect', async () => {
    const user = makeUser();
    const callbacks = makeCallbacks({
      getUserByEmail: vi.fn().mockResolvedValue(user),
    });
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    const request = new Request(
      authorizeUrl(pkce.codeChallenge, { state: 'my-state-xyz' }),
      { method: 'POST', body },
    );

    const response = await handleAuthorize(request, config);
    const location = response.headers.get('Location')!;
    const redirected = new URL(location);
    expect(redirected.searchParams.get('state')).toBe('my-state-xyz');
  });
});

describe('handleAuthorize POST — bad credentials → error page', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 HTML error page when user is not found', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const callbacks = makeCallbacks({
      getUserByEmail: vi.fn().mockResolvedValue(null),
    });
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('email', 'nobody@example.com');
    body.set('password', 'wrongpassword');
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'POST', body });

    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 401 HTML error page when password is wrong', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const user = makeUser();
    const callbacks = makeCallbacks({
      getUserByEmail: vi.fn().mockResolvedValue(user),
    });
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'wrongpassword');
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'POST', body });

    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain('access_denied');
  });

  it('returns 400 when email is missing', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('password', 'password123');
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'POST', body });

    const response = await handleAuthorize(request, config);
    expect(response.status).toBe(400);
  });
});

describe('handleAuthorize POST — TOTP required → TOTP page', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
    vi.mocked(verifyPassword).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 TOTP verification page when user has TOTP configured', async () => {
    const user = makeUser();
    const pendingSessionStore: Record<string, { userId: string, purpose: 'login' | 'setup' }> = {};

    const totpCallbacks = {
      hasTotp: vi.fn().mockResolvedValue(true),
      getTotpSecret: vi.fn().mockResolvedValue(null),
      storeTotpSecret: vi.fn().mockResolvedValue(undefined),
      deleteTotpSecret: vi.fn().mockResolvedValue(undefined),
      getPendingTotpSession: vi.fn().mockImplementation(async (id: string) => {
        return pendingSessionStore[id]
          ? { userId: pendingSessionStore[id].userId, purpose: pendingSessionStore[id].purpose }
          : null;
      }),
      storePendingTotpSession: vi.fn().mockImplementation(
        async (id: string, userId: string, _expiresAt: number, purpose: 'login' | 'setup') => {
          pendingSessionStore[id] = { userId, purpose };
        },
      ),
      deletePendingTotpSession: vi.fn().mockResolvedValue(undefined),
      getUsedTotpCode: vi.fn().mockResolvedValue(null),
      markTotpCodeUsed: vi.fn().mockResolvedValue(undefined),
    };

    const callbacks = makeCallbacks({
      getUserByEmail: vi.fn().mockResolvedValue(user),
    });
    const config = makeConfig(callbacks, {
      totp: {
        enabled: true,
        callbacks: totpCallbacks,
      },
    });

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    const request = new Request(authorizeUrl(pkce.codeChallenge), { method: 'POST', body });

    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    // Should render the TOTP verification page (contains totp input or session)
    expect(html).toContain('totp');
  });
});

// ---------------------------------------------------------------------------
// handleAuthorize GET — TOTP session (totp_session query param present)
// ---------------------------------------------------------------------------

describe('handleAuthorize GET — TOTP session', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 TOTP verification page when totp_session is valid', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'login' });
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    const request = new Request(
      authorizeUrl(pkce.codeChallenge, { totp_session: 'valid-session-id' }),
      { method: 'GET' },
    );
    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('totp_session');
  });

  it('falls through to the login page when totp_session is unknown', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue(null);
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    const request = new Request(
      authorizeUrl(pkce.codeChallenge, { totp_session: 'unknown-id' }),
      { method: 'GET' },
    );
    const response = await handleAuthorize(request, config);

    // Invalid session falls through to the standard login form
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('email');
    expect(html).toContain('password');
  });
});

// ---------------------------------------------------------------------------
// handleAuthorize POST — TOTP verification (totp_code + totp_session path)
// ---------------------------------------------------------------------------

describe('handleAuthorize POST — TOTP verification', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };

  beforeEach(async () => {
    pkce = await makePkce();
    vi.mocked(verifyOAuthTOTPWithReplayProtection).mockResolvedValue({ valid: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeTotpPostRequest(codeChallenge: string, totpCode: string, totpSession: string) {
    const body = new FormData();
    body.set('totp_code', totpCode);
    body.set('totp_session', totpSession);
    return new Request(authorizeUrl(codeChallenge), { method: 'POST', body });
  }

  it('redirects 302 with code when totp_code and totp_session are valid', async () => {
    const callbacks = makeCallbacks({ storeAuthorizationCode: vi.fn().mockResolvedValue(undefined) });
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'login' });
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    const response = await handleAuthorize(
      makeTotpPostRequest(pkce.codeChallenge, '123456', 'session-abc'),
      config,
    );

    expect(response.status).toBe(302);
    const location = response.headers.get('Location')!;
    const redirected = new URL(location);
    expect(redirected.searchParams.has('code')).toBe(true);
    expect(redirected.searchParams.get('code')!.length).toBeGreaterThan(0);
  });

  it('calls deletePendingTotpSession after successful verification', async () => {
    const callbacks = makeCallbacks({ storeAuthorizationCode: vi.fn().mockResolvedValue(undefined) });
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'login' });
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    await handleAuthorize(
      makeTotpPostRequest(pkce.codeChallenge, '123456', 'session-abc'),
      config,
    );

    expect(totpCbs.deletePendingTotpSession).toHaveBeenCalledWith('session-abc');
  });

  it('returns 401 HTML when totp_code is invalid', async () => {
    vi.mocked(verifyOAuthTOTPWithReplayProtection).mockResolvedValue({ valid: false });
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'login' });
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    const response = await handleAuthorize(
      makeTotpPostRequest(pkce.codeChallenge, '000000', 'session-abc'),
      config,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Invalid TOTP code');
  });

  it('returns 401 HTML with replay message when totp_code has been used before', async () => {
    vi.mocked(verifyOAuthTOTPWithReplayProtection).mockResolvedValue({ valid: false, replay: true });
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'login' });
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    const response = await handleAuthorize(
      makeTotpPostRequest(pkce.codeChallenge, '123456', 'session-abc'),
      config,
    );

    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain('TOTP code already used');
  });

  it('returns 401 HTML when totp_session is expired or unknown', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue(null);
    const config = makeConfig(callbacks, {
      totp: { enabled: true, callbacks: totpCbs },
    });

    const response = await handleAuthorize(
      makeTotpPostRequest(pkce.codeChallenge, '123456', 'expired-session'),
      config,
    );

    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain('Invalid or expired TOTP session');
  });
});

// ---------------------------------------------------------------------------
// handleToken — authorization_code grant
// ---------------------------------------------------------------------------

describe('handleToken — authorization_code grant', () => {
  let pkce: { codeVerifier: string, codeChallenge: string };
  const AUTH_CODE = 'valid-auth-code-xxxx';

  beforeEach(async () => {
    pkce = await makePkce();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeAuthCode(overrides: Partial<AuthorizationCode> = {}): AuthorizationCode {
    return {
      code: AUTH_CODE,
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: 'S256',
      redirectUri: REDIRECT_URI,
      clientId: CLIENT_ID,
      scope: ['repo'],
      userId: 'user-1',
      expiresAt: Date.now() + 600_000, // 10 minutes from now
      ...overrides,
    };
  }

  function tokenRequest(fields: Record<string, string>): Request {
    const body = new URLSearchParams(fields);
    return new Request(`https://auth.example.com/${BASE_PATH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  it('returns access and refresh tokens when PKCE code_verifier is valid', async () => {
    const callbacks = makeCallbacks({
      getAuthorizationCode: vi.fn().mockResolvedValue(makeAuthCode()),
    });
    const config = makeConfig(callbacks);

    const request = tokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: AUTH_CODE,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.codeVerifier,
    });

    const response = await handleToken(request, config);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('access_token');
    expect(json).toHaveProperty('refresh_token');
    expect(json).toHaveProperty('token_type', 'Bearer');
    expect(json).toHaveProperty('expires_in');
  });

  it('deletes the authorization code after successful exchange (one-time use)', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getAuthorizationCode: vi.fn().mockResolvedValue(makeAuthCode()),
      deleteAuthorizationCode: deleteFn,
    });
    const config = makeConfig(callbacks);

    const request = tokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: AUTH_CODE,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.codeVerifier,
    });

    await handleToken(request, config);

    expect(deleteFn).toHaveBeenCalledWith(AUTH_CODE);
  });

  it('returns invalid_grant when code_verifier does not match', async () => {
    const callbacks = makeCallbacks({
      getAuthorizationCode: vi.fn().mockResolvedValue(makeAuthCode()),
    });
    const config = makeConfig(callbacks);

    const wrongVerifier = 'b'.repeat(43); // won't produce the correct challenge
    const request = tokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: AUTH_CODE,
      redirect_uri: REDIRECT_URI,
      code_verifier: wrongVerifier,
    });

    const response = await handleToken(request, config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('invalid_grant');
  });

  it('returns invalid_grant for an unknown authorization code', async () => {
    const callbacks = makeCallbacks({
      getAuthorizationCode: vi.fn().mockResolvedValue(null),
    });
    const config = makeConfig(callbacks);

    const request = tokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: 'nonexistent-code',
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.codeVerifier,
    });

    const response = await handleToken(request, config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('invalid_grant');
  });

  it('returns invalid_grant for an expired authorization code', async () => {
    const expiredCode = makeAuthCode({ expiresAt: Date.now() - 1000 });
    const callbacks = makeCallbacks({
      getAuthorizationCode: vi.fn().mockResolvedValue(expiredCode),
    });
    const config = makeConfig(callbacks);

    const request = tokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: AUTH_CODE,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.codeVerifier,
    });

    const response = await handleToken(request, config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('invalid_grant');
  });

  it('returns invalid_client when client_id is wrong', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);

    const request = tokenRequest({
      grant_type: 'authorization_code',
      client_id: 'wrong-client',
      code: AUTH_CODE,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.codeVerifier,
    });

    const response = await handleToken(request, config);

    expect(response.status).toBe(401);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('invalid_client');
  });
});

// ---------------------------------------------------------------------------
// handleToken — refresh_token grant
// ---------------------------------------------------------------------------

describe('handleToken — refresh_token grant', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeSession(overrides: Partial<OAuthSession> = {}): OAuthSession {
    return {
      id: 'session-1',
      accessToken: 'access-token-xxx',
      accessTokenExpiresAt: Date.now() + 3600_000,
      refreshToken: 'refresh-token-xxx',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 3600_000, // 30 days
      scope: ['repo'],
      userId: 'user-1',
      createdAt: Date.now(),
      ...overrides,
    };
  }

  function refreshRequest(refreshToken: string): Request {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });
    return new Request(`https://auth.example.com/${BASE_PATH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  it('returns new access and refresh tokens for a valid refresh token', async () => {
    const existingSession = makeSession();
    const callbacks = makeCallbacks({
      getSessionByRefreshToken: vi.fn().mockResolvedValue(existingSession),
    });
    const config = makeConfig(callbacks);

    const response = await handleToken(refreshRequest(existingSession.refreshToken), config);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('access_token');
    expect(json).toHaveProperty('refresh_token');
  });

  it('invalidates the old session after a successful refresh', async () => {
    const existingSession = makeSession();
    const logoutFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByRefreshToken: vi.fn().mockResolvedValue(existingSession),
      logoutSession: logoutFn,
    });
    const config = makeConfig(callbacks);

    await handleToken(refreshRequest(existingSession.refreshToken), config);

    expect(logoutFn).toHaveBeenCalledWith(existingSession.id);
  });

  it('creates a new session after refreshing', async () => {
    const existingSession = makeSession();
    const createFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByRefreshToken: vi.fn().mockResolvedValue(existingSession),
      createSession: createFn,
    });
    const config = makeConfig(callbacks);

    await handleToken(refreshRequest(existingSession.refreshToken), config);

    expect(createFn).toHaveBeenCalledOnce();
    const newSession: OAuthSession = createFn.mock.calls[0][0];
    // New session must have fresh tokens (different from old ones)
    // generateSecureRandomString is mocked, but verify createSession was called
    expect(newSession.userId).toBe(existingSession.userId);
    expect(newSession.scope).toEqual(existingSession.scope);
  });

  it('returns invalid_grant for an expired refresh token', async () => {
    const expiredSession = makeSession({
      refreshTokenExpiresAt: Date.now() - 1000,
    });
    const callbacks = makeCallbacks({
      getSessionByRefreshToken: vi.fn().mockResolvedValue(expiredSession),
    });
    const config = makeConfig(callbacks);

    const response = await handleToken(refreshRequest(expiredSession.refreshToken), config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('invalid_grant');
  });

  it('returns invalid_grant for an unknown refresh token', async () => {
    const callbacks = makeCallbacks({
      getSessionByRefreshToken: vi.fn().mockResolvedValue(null),
    });
    const config = makeConfig(callbacks);

    const response = await handleToken(refreshRequest('unknown-refresh-token'), config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('invalid_grant');
  });

  it('logs out the expired session before returning invalid_grant', async () => {
    const expiredSession = makeSession({
      refreshTokenExpiresAt: Date.now() - 1000,
    });
    const logoutFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByRefreshToken: vi.fn().mockResolvedValue(expiredSession),
      logoutSession: logoutFn,
    });
    const config = makeConfig(callbacks);

    await handleToken(refreshRequest(expiredSession.refreshToken), config);

    expect(logoutFn).toHaveBeenCalledWith(expiredSession.id);
  });
});

// ---------------------------------------------------------------------------
// handleToken — grant_type validation and non-POST method (LCMS-394)
// ---------------------------------------------------------------------------

describe('handleToken — grant_type validation and method guard (LCMS-394)', () => {
  function tokenRequest(fields: Record<string, string>, method = 'POST'): Request {
    const body = new URLSearchParams(fields);
    return new Request(`https://auth.example.com/${BASE_PATH}/token`, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  it('returns invalid_request when grant_type is absent (RFC 6749 §5.2)', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = tokenRequest({ client_id: CLIENT_ID });

    const response = await handleToken(request, config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('error', 'invalid_request');
    expect(json).toHaveProperty('error_description', 'Missing required parameter: grant_type');
  });

  it('returns unsupported_grant_type when grant_type is present but unrecognized (RFC 6749 §5.2)', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = tokenRequest({ client_id: CLIENT_ID, grant_type: 'client_credentials' });

    const response = await handleToken(request, config);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('error', 'unsupported_grant_type');
  });

  it('returns 405 invalid_request for non-POST method', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(`https://auth.example.com/${BASE_PATH}/token`, { method: 'GET' });

    const response = await handleToken(request, config);

    expect(response.status).toBe(405);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('error', 'invalid_request');
  });
});

// ---------------------------------------------------------------------------
// decapOauth2 — custom authorizeEndpoint / tokenEndpoint routing (LCMS-280)
// ---------------------------------------------------------------------------

describe('decapOauth2 custom endpoint routing', () => {
  it('routes to default <basePath>/authorize when authorizeEndpoint is not set', async () => {
    const callbacks = makeCallbacks();
    const handler = decapOauth2(makeConfig(callbacks));
    const request = new Request(
      `https://auth.example.com/${BASE_PATH}/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=https://app.example.com/cb&code_challenge=abc&code_challenge_method=S256`,
      { method: 'GET' },
    );
    const response = await handler.fetch(request);
    // handleAuthorize is invoked — it returns 200 HTML, not a 404
    expect(response.status).not.toBe(404);
  });

  it('routes to custom authorizeEndpoint when provided', async () => {
    const callbacks = makeCallbacks();
    const handler = decapOauth2(makeConfig(callbacks, { authorizeEndpoint: '/custom/auth' }));

    // A request to the default basePath/authorize path should now 404
    const defaultRequest = new Request(
      `https://auth.example.com/${BASE_PATH}/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=https://app.example.com/cb&code_challenge=abc&code_challenge_method=S256`,
    );
    const defaultResponse = await handler.fetch(defaultRequest);
    expect(defaultResponse.status).toBe(404);

    // A request to the custom path should be handled (200 HTML login form)
    const customRequest = new Request(
      `https://auth.example.com/custom/auth?response_type=code&client_id=${CLIENT_ID}&redirect_uri=https://app.example.com/cb&code_challenge=abc&code_challenge_method=S256`,
    );
    const customResponse = await handler.fetch(customRequest);
    expect(customResponse.status).not.toBe(404);
  });

  it('routes to custom tokenEndpoint when provided', async () => {
    const callbacks = makeCallbacks();
    const handler = decapOauth2(makeConfig(callbacks, { tokenEndpoint: '/custom/token' }));

    // A POST to the default basePath/token should now 404
    const defaultRequest = new Request(`https://auth.example.com/${BASE_PATH}/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const defaultResponse = await handler.fetch(defaultRequest);
    expect(defaultResponse.status).toBe(404);

    // A POST to the custom path should be handled (token error, not 404)
    const customRequest = new Request('https://auth.example.com/custom/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const customResponse = await handler.fetch(customRequest);
    expect(customResponse.status).not.toBe(404);
  });
});
