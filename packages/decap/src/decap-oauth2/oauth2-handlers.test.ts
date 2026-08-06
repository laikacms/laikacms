/**
 * Unit tests for oauth2.ts — handlers not covered by oauth2.test.ts:
 *  handleTotpSetupPage, handleTotpSetupVerify,
 *  handlePasskeySetupPage, handlePasskeyRegister, handlePasskeyAuthenticateVerify,
 *  handleForgotPassword, handleResetPassword,
 *  handleLogout, handleLogoutAll,
 *  decapOauth2() router dispatch.
 *
 * LCMS-166
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above imports
// ---------------------------------------------------------------------------

vi.mock('laikacms/crypto', () => ({
  addTimingJitter: vi.fn().mockResolvedValue(undefined),
  constantTimeEqual: vi.fn().mockImplementation((a: string, b: string) => Promise.resolve(a === b)),
  generateSecureRandomString: vi.fn().mockImplementation((len: number) => 'x'.repeat(len)),
  sha256: vi.fn().mockResolvedValue('mocked-sha256'),
  verifyPassword: vi.fn(),
}));

vi.mock('./totp/totp.js', () => ({
  setupOAuthTOTP: vi.fn(),
  verifyOAuthTOTPSetup: vi.fn(),
  verifyOAuthTOTPWithReplayProtection: vi.fn(),
}));

vi.mock('./passkey/passkey.js', () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthentication: vi.fn(),
  verifyRegistration: vi.fn(),
}));

vi.mock('./email/email.js', () => ({
  requestPasswordReset: vi.fn().mockResolvedValue({ success: true }),
  resetPassword: vi.fn(),
}));

// Imports after mock registration
import { requestPasswordReset, resetPassword } from './email/email.js';
import { decapOauth2, handleLogout, handleLogoutAll } from './oauth2.js';
import type { OAuthCallbacks, OAuthConfig, OAuthSession, User } from './oauth2.js';
import { generateRegistrationOptions, verifyAuthentication, verifyRegistration } from './passkey/passkey.js';
import { setupOAuthTOTP, verifyOAuthTOTPSetup } from './totp/totp.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_PATH = 'oauth2';
const ORIGIN = 'https://auth.example.com';

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
    clientId: 'test-client',
    basePath: BASE_PATH,
    allowedRedirectUris: ['https://auth.example.com/oauth2/authorize', 'https://example.com/callback'],
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
  };
}

function makePasskeyCallbacks() {
  return {
    storeCredential: vi.fn().mockResolvedValue(undefined),
    getCredentialById: vi.fn().mockResolvedValue(null),
    getCredentialsByUserId: vi.fn().mockResolvedValue([]),
    updateCredential: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    storeChallenge: vi.fn().mockResolvedValue(undefined),
    consumeChallenge: vi.fn().mockResolvedValue(null),
    getUserById: vi.fn().mockResolvedValue(null),
    getUserByEmail: vi.fn().mockResolvedValue(null),
    storePendingPasskeySetupSession: vi.fn().mockResolvedValue(undefined),
    getPendingPasskeySetupSession: vi.fn().mockResolvedValue(null),
  };
}

function makePasswordResetCallbacks() {
  return {
    storeResetToken: vi.fn().mockResolvedValue(undefined),
    getResetToken: vi.fn().mockResolvedValue(null),
    deleteResetToken: vi.fn().mockResolvedValue(undefined),
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSession(overrides: Partial<OAuthSession> = {}): OAuthSession {
  return {
    id: 'session-1',
    accessToken: 'access-token-xxx',
    accessTokenExpiresAt: Date.now() + 3600_000,
    refreshToken: 'refresh-token-xxx',
    refreshTokenExpiresAt: Date.now() + 30 * 24 * 3600_000,
    scope: ['repo'],
    userId: 'user-1',
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Build a URL under the configured basePath. */
function makeUrl(subpath: string, params: Record<string, string> = {}): string {
  const url = new URL(`${ORIGIN}/${BASE_PATH}/${subpath}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// handleTotpSetupPage — GET /oauth2/setup/totp
// ===========================================================================

describe('handleTotpSetupPage', () => {
  const totpConfig = (totpCbs: ReturnType<typeof makeTotpCallbacks>) => ({
    enabled: true as const,
    issuer: 'Test CMS',
    callbacks: totpCbs,
  });

  beforeEach(() => {
    vi.mocked(setupOAuthTOTP).mockResolvedValue({
      secret: 'BASE32SECRET',
      qrCode: 'data:image/png;base64,abc123',
      otpauth: 'otpauth://totp/Test%20CMS:user@example.com?secret=BASE32SECRET&issuer=Test%20CMS',
    });
  });

  it('returns 400 when redirect_uri is missing', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/totp', { setup_token: 'tok' }), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when TOTP is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks); // no totp config
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/totp', { redirect_uri: 'https://auth.example.com/oauth2/authorize', setup_token: 'tok' }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when setup_token is missing', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/totp', { redirect_uri: 'https://auth.example.com/oauth2/authorize' }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 401 when setup_token is invalid', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue(null);
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/totp', {
        redirect_uri: 'https://auth.example.com/oauth2/authorize',
        setup_token: 'invalid-token',
      }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 401 when user is not found', async () => {
    const callbacks = makeCallbacks({ getUserById: vi.fn().mockResolvedValue(null) });
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/totp', {
        redirect_uri: 'https://auth.example.com/oauth2/authorize',
        setup_token: 'valid-token',
      }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 200 HTML TOTP setup page on happy path', async () => {
    const user = makeUser();
    const callbacks = makeCallbacks({ getUserById: vi.fn().mockResolvedValue(user) });
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: user.id, purpose: 'setup' });
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/totp', {
        redirect_uri: 'https://auth.example.com/oauth2/authorize',
        setup_token: 'valid-token',
      }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// handleTotpSetupVerify — POST /oauth2/setup/totp/verify
// ===========================================================================

describe('handleTotpSetupVerify', () => {
  const totpConfig = (totpCbs: ReturnType<typeof makeTotpCallbacks>) => ({
    enabled: true as const,
    issuer: 'Test CMS',
    callbacks: totpCbs,
  });

  it('returns 400 when setup_token is missing', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('totp_code', '123456');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when totp_code is missing', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'tok');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when TOTP is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks); // no totp config
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'tok');
    body.set('totp_code', '123456');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 401 when setup_token is invalid', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue(null);
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'bad-token');
    body.set('totp_code', '123456');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 401 when TOTP secret is not found', async () => {
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    totpCbs.getTotpSecret.mockResolvedValue(null);
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'valid-token');
    body.set('totp_code', '123456');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 401 when TOTP code is invalid', async () => {
    vi.mocked(verifyOAuthTOTPSetup).mockResolvedValue({ success: false });
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    totpCbs.getTotpSecret.mockResolvedValue('BASE32SECRET');
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'valid-token');
    body.set('totp_code', '000000');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('redirects 302 with totp_session when code is valid and redirect_uri is same-origin', async () => {
    vi.mocked(verifyOAuthTOTPSetup).mockResolvedValue({ success: true });
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    totpCbs.getTotpSecret.mockResolvedValue('BASE32SECRET');
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const redirectUri = `${ORIGIN}/${BASE_PATH}/authorize`;
    const body = new FormData();
    body.set('setup_token', 'valid-token');
    body.set('totp_code', '123456');
    const requestUrl = makeUrl('setup/totp/verify', { redirect_uri: redirectUri });
    const request = new Request(requestUrl, { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(302);
    const location = response.headers.get('Location')!;
    expect(new URL(location).searchParams.has('totp_session')).toBe(true);
  });

  it('returns 400 when redirect_uri is cross-origin', async () => {
    vi.mocked(verifyOAuthTOTPSetup).mockResolvedValue({ success: true });
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    totpCbs.getTotpSecret.mockResolvedValue('BASE32SECRET');
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'valid-token');
    body.set('totp_code', '123456');
    const requestUrl = makeUrl('setup/totp/verify', {
      redirect_uri: 'https://evil.example.com/callback',
    });
    const request = new Request(requestUrl, { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 200 plain text when no redirect_uri is provided', async () => {
    vi.mocked(verifyOAuthTOTPSetup).mockResolvedValue({ success: true });
    const callbacks = makeCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.getPendingTotpSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    totpCbs.getTotpSecret.mockResolvedValue('BASE32SECRET');
    const config = makeConfig(callbacks, { totp: totpConfig(totpCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('setup_token', 'valid-token');
    body.set('totp_code', '123456');
    const request = new Request(makeUrl('setup/totp/verify'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).toContain('totp');
  });
});

// ===========================================================================
// handlePasskeySetupPage — GET /oauth2/setup/passkey
// ===========================================================================

describe('handlePasskeySetupPage', () => {
  const passkeyConfig = (passkeyCbs: ReturnType<typeof makePasskeyCallbacks>) => ({
    enabled: true as const,
    rpId: 'auth.example.com',
    rpName: 'Test CMS',
    origin: ORIGIN,
    callbacks: passkeyCbs,
  });

  beforeEach(() => {
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      publicKey: {
        challenge: 'base64challenge',
        rp: { id: 'auth.example.com', name: 'Test CMS' },
        user: { id: 'user-1', name: 'user@example.com', displayName: 'user@example.com' },
        pubKeyCredParams: [],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: {},
        excludeCredentials: [],
        extensions: {},
      },
    });
  });

  it('returns 400 when redirect_uri is missing', async () => {
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/passkey', { setup_token: 'tok' }), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when passkey is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks); // no passkey config
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/passkey', { redirect_uri: `${ORIGIN}/callback`, setup_token: 'tok' }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when setup_token is missing', async () => {
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/passkey', { redirect_uri: `${ORIGIN}/callback` }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 401 when setup_token is invalid', async () => {
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    passkeyCbs.getPendingPasskeySetupSession.mockResolvedValue(null);
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/passkey', { redirect_uri: `${ORIGIN}/callback`, setup_token: 'bad-token' }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 401 when user is not found', async () => {
    const callbacks = makeCallbacks({ getUserById: vi.fn().mockResolvedValue(null) });
    const passkeyCbs = makePasskeyCallbacks();
    passkeyCbs.getPendingPasskeySetupSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/passkey', { redirect_uri: `${ORIGIN}/callback`, setup_token: 'valid-token' }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 200 HTML passkey setup page on happy path', async () => {
    const user = makeUser();
    const callbacks = makeCallbacks({ getUserById: vi.fn().mockResolvedValue(user) });
    const passkeyCbs = makePasskeyCallbacks();
    passkeyCbs.getPendingPasskeySetupSession.mockResolvedValue({ userId: user.id, purpose: 'setup' });
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(
      makeUrl('setup/passkey', { redirect_uri: `${ORIGIN}/callback`, setup_token: 'valid-token' }),
      { method: 'GET' },
    );
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });
});

// ===========================================================================
// handlePasskeyRegister — POST /oauth2/setup/passkey/register
// ===========================================================================

describe('handlePasskeyRegister', () => {
  const passkeyConfig = (passkeyCbs: ReturnType<typeof makePasskeyCallbacks>) => ({
    enabled: true as const,
    rpId: 'auth.example.com',
    rpName: 'Test CMS',
    origin: ORIGIN,
    callbacks: passkeyCbs,
  });

  const validCredential = {
    id: 'cred-id',
    rawId: 'cred-raw-id',
    response: {
      clientDataJSON: 'base64data',
      attestationObject: 'base64attestation',
    },
    type: 'public-key',
  };

  it('returns 400 when passkey is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks); // no passkey config
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/passkey/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: 'tok', credential: validCredential }),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('error');
  });

  it('returns 400 when setup_token or credential is missing', async () => {
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/passkey/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: 'tok' }), // missing credential
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 401 when setup_token is invalid', async () => {
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    passkeyCbs.getPendingPasskeySetupSession.mockResolvedValue(null);
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/passkey/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: 'bad', credential: validCredential }),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 400 when credential verification fails', async () => {
    vi.mocked(verifyRegistration).mockResolvedValue({ success: false, error: 'Bad attestation' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    passkeyCbs.getPendingPasskeySetupSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/passkey/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: 'valid-tok', credential: validCredential }),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toHaveProperty('error');
  });

  it('returns 200 JSON success on happy path', async () => {
    vi.mocked(verifyRegistration).mockResolvedValue({ success: true });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    passkeyCbs.getPendingPasskeySetupSession.mockResolvedValue({ userId: 'user-1', purpose: 'setup' });
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('setup/passkey/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: 'valid-tok', credential: validCredential }),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
  });
});

// ===========================================================================
// handlePasskeyAuthenticateVerify — POST /oauth2/passkey/authenticate/verify
// ===========================================================================

describe('handlePasskeyAuthenticateVerify', () => {
  const passkeyConfig = (passkeyCbs: ReturnType<typeof makePasskeyCallbacks>) => ({
    enabled: true as const,
    rpId: 'auth.example.com',
    rpName: 'Test CMS',
    origin: ORIGIN,
    callbacks: passkeyCbs,
  });

  const validAuthCredential = {
    id: 'cred-id',
    rawId: 'cred-raw-id',
    response: {
      clientDataJSON: 'base64data',
      authenticatorData: 'base64auth',
      signature: 'base64sig',
    },
    type: 'public-key',
  };

  it('returns 400 when passkey is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const router = decapOauth2(config);

    const request = new Request(makeUrl('passkey/authenticate/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when credential body is missing id or response', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: false, error: 'missing' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('passkey/authenticate/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '', response: null }), // invalid — no id
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 401 when authentication verification fails', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: false, error: 'Bad signature' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('passkey/authenticate/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(401);
  });

  it('returns 200 JSON with redirect_uri on successful authentication', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: true, userId: 'user-1' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const url = makeUrl('passkey/authenticate/verify', {
      client_id: 'test-client',
      redirect_uri: 'https://example.com/callback',
      code_challenge: 'abc123',
      code_challenge_method: 'S256',
    });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(typeof json.redirect_uri).toBe('string');
  });

  it('returns requires_totp when user has TOTP configured', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: true, userId: 'user-1' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const totpCbs = makeTotpCallbacks();
    totpCbs.hasTotp.mockResolvedValue(true);
    const config = makeConfig(callbacks, {
      passkey: passkeyConfig(passkeyCbs),
      totp: { enabled: true, issuer: 'Test CMS', callbacks: totpCbs },
    });
    const router = decapOauth2(config);

    const url = makeUrl('passkey/authenticate/verify', {
      redirect_uri: 'https://example.com/callback',
      code_challenge: 'abc123',
    });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json.requires_totp).toBe(true);
    expect(json.totp_session).toBeTruthy();
  });

  it('returns 400 with Missing OAuth parameters when redirect_uri is absent', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: true, userId: 'user-1' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    // code_challenge present but redirect_uri missing
    const url = makeUrl('passkey/authenticate/verify', { code_challenge: 'abc123' });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('Missing OAuth parameters');
  });

  it('returns 400 with Missing OAuth parameters when code_challenge is absent', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: true, userId: 'user-1' });
    const callbacks = makeCallbacks();
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    // redirect_uri present but code_challenge missing
    const url = makeUrl('passkey/authenticate/verify', {
      redirect_uri: 'https://example.com/callback',
    });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('Missing OAuth parameters');
  });

  it('returns 500 when storeAuthorizationCode callback throws', async () => {
    vi.mocked(verifyAuthentication).mockResolvedValue({ success: true, userId: 'user-1' });
    const callbacks = makeCallbacks({
      storeAuthorizationCode: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    });
    const passkeyCbs = makePasskeyCallbacks();
    const config = makeConfig(callbacks, { passkey: passkeyConfig(passkeyCbs) });
    const router = decapOauth2(config);

    const url = makeUrl('passkey/authenticate/verify', {
      client_id: 'test-client',
      redirect_uri: 'https://example.com/callback',
      code_challenge: 'abc123',
      code_challenge_method: 'S256',
    });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAuthCredential),
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(500);
    const json = await response.json() as Record<string, unknown>;
    expect(json.error).toBe('Authentication failed');
  });
});

// ===========================================================================
// handleForgotPassword — GET + POST /oauth2/forgot-password
// ===========================================================================

describe('handleForgotPassword', () => {
  const passwordResetConfig = (prCbs: ReturnType<typeof makePasswordResetCallbacks>) => ({
    emailProvider: {
      sendEmail: vi.fn().mockResolvedValue({ success: true }),
    },
    callbacks: prCbs,
    resetBaseUrl: undefined,
    fromEmail: 'noreply@example.com',
    appName: 'Test CMS',
  });

  it('returns 404 when password reset is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks); // no passwordReset config
    const router = decapOauth2(config);

    const request = new Request(makeUrl('forgot-password'), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(404);
  });

  it('returns 200 HTML form on GET', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('forgot-password'), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 400 on POST when email is missing', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData(); // no email field
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 200 success page on POST with valid email (user found)', async () => {
    const user = makeUser();
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(user) });
    const prCbs = makePasswordResetCallbacks();
    vi.mocked(requestPasswordReset).mockResolvedValue({ success: true });
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('email', 'user@example.com');
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 200 success page on POST even when user is not found (anti-enumeration)', async () => {
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(null) });
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    vi.useFakeTimers();
    const body = new FormData();
    body.set('email', 'nobody@example.com');
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const responsePromise = router.fetch(request);
    await vi.runAllTimersAsync();
    const response = await responsePromise;
    vi.useRealTimers();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('does not call requestPasswordReset when user is not found (anti-enumeration)', async () => {
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(null) });
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    vi.useFakeTimers();
    const body = new FormData();
    body.set('email', 'nobody@example.com');
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const responsePromise = router.fetch(request);
    await vi.runAllTimersAsync();
    await responsePromise;
    vi.useRealTimers();

    expect(vi.mocked(requestPasswordReset)).not.toHaveBeenCalled();
  });

  it('returns 405 for non-GET/POST methods', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('forgot-password'), { method: 'PUT' });
    const response = await router.fetch(request);

    expect(response.status).toBe(405);
  });
});

// ===========================================================================
// handleForgotPassword — CAPTCHA CSP (LCMS-354)
// ===========================================================================

describe('handleForgotPassword — CAPTCHA CSP', () => {
  const passwordResetConfig = (prCbs: ReturnType<typeof makePasswordResetCallbacks>) => ({
    emailProvider: { sendEmail: vi.fn().mockResolvedValue({ success: true }) },
    callbacks: prCbs,
    resetBaseUrl: undefined,
    fromEmail: 'noreply@example.com',
    appName: 'Test CMS',
  });

  function makeCaptchaConfig(extra?: string) {
    return {
      enabled: true,
      widgetHtml: '<div class="captcha-widget"></div>',
      scriptHtml: '<script src="https://example-captcha.com/api.js"></script>',
      responseFieldName: 'captcha-response',
      verify: vi.fn().mockResolvedValue(true),
      ...(extra !== undefined ? { captchaCspAdditions: extra } : {}),
    };
  }

  it('CSP includes captchaCspAdditions on forgot-password GET when captcha enabled', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      passwordReset: passwordResetConfig(prCbs),
      captcha: makeCaptchaConfig(' https://example-captcha.com; frame-src https://example-captcha.com'),
    });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('forgot-password'), { method: 'GET' });
    const response = await router.fetch(request);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('https://example-captcha.com');
    expect(csp).not.toContain('challenges.cloudflare.com');
  });

  it('CSP has script-src but no external domains when captchaCspAdditions omitted', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      passwordReset: passwordResetConfig(prCbs),
      captcha: makeCaptchaConfig(), // enabled, no captchaCspAdditions
    });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('forgot-password'), { method: 'GET' });
    const response = await router.fetch(request);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain('challenges.cloudflare.com');
  });

  it('CSP has no script-src when captcha is not enabled', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      passwordReset: passwordResetConfig(prCbs),
      // no captcha config
    });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('forgot-password'), { method: 'GET' });
    const response = await router.fetch(request);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('challenges.cloudflare.com');
  });

  it('POST missing email also applies CAPTCHA CSP', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      passwordReset: passwordResetConfig(prCbs),
      captcha: makeCaptchaConfig(' https://example-captcha.com'),
    });
    const router = decapOauth2(config);

    const body = new FormData(); // no email
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('https://example-captcha.com');
  });
});

// ===========================================================================
// handleResetPassword — GET + POST /oauth2/reset-password
// ===========================================================================

describe('handleResetPassword', () => {
  const passwordResetConfig = (prCbs: ReturnType<typeof makePasswordResetCallbacks>) => ({
    emailProvider: { sendEmail: vi.fn().mockResolvedValue({ success: true }) },
    callbacks: prCbs,
    resetBaseUrl: undefined,
    fromEmail: 'noreply@example.com',
    appName: 'Test CMS',
  });

  it('returns 404 when password reset is not enabled', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const router = decapOauth2(config);

    const request = new Request(makeUrl('reset-password', { token: 'tok' }), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(404);
  });

  it('returns 400 on GET when token is missing', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('reset-password'), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 on GET when token is expired or invalid', async () => {
    const prCbs = makePasswordResetCallbacks();
    prCbs.getResetToken.mockResolvedValue(null); // token not found
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('reset-password', { token: 'expired-token' }), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 200 HTML reset form on GET with valid token', async () => {
    const prCbs = makePasswordResetCallbacks();
    prCbs.getResetToken.mockResolvedValue({
      token: 'valid-token',
      userId: 'user-1',
      email: 'user@example.com',
      expiresAt: Date.now() + 3600_000,
      createdAt: Date.now(),
    });
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('reset-password', { token: 'valid-token' }), { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 400 on POST when token is missing', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('password', 'newpassword123');
    body.set('confirm_password', 'newpassword123');
    const request = new Request(makeUrl('reset-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 on POST when password is too short', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('token', 'valid-token');
    body.set('password', 'short');
    body.set('confirm_password', 'short');
    const request = new Request(makeUrl('reset-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('8');
  });

  it('returns 400 on POST when passwords do not match', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('token', 'valid-token');
    body.set('password', 'newpassword123');
    body.set('confirm_password', 'differentpassword');
    const request = new Request(makeUrl('reset-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html.toLowerCase()).toContain('match');
  });

  it('returns 400 on POST when resetPassword returns failure', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ success: false, error: 'Invalid or expired token' });
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('token', 'bad-token');
    body.set('password', 'newpassword123');
    body.set('confirm_password', 'newpassword123');
    const request = new Request(makeUrl('reset-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
  });

  it('returns 200 success page on POST with correct data', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ success: true, userId: 'user-1' });
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('token', 'valid-token');
    body.set('password', 'newpassword123');
    body.set('confirm_password', 'newpassword123');
    const request = new Request(makeUrl('reset-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('calls logoutAll after successful password reset', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ success: true, userId: 'user-1' });
    const logoutAllFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({ logoutAll: logoutAllFn });
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('token', 'valid-token');
    body.set('password', 'newpassword123');
    body.set('confirm_password', 'newpassword123');
    const request = new Request(makeUrl('reset-password'), { method: 'POST', body });
    await router.fetch(request);

    expect(logoutAllFn).toHaveBeenCalledWith('user-1');
  });

  it('returns 405 for non-GET/POST methods', async () => {
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, { passwordReset: passwordResetConfig(prCbs) });
    const router = decapOauth2(config);

    const request = new Request(makeUrl('reset-password'), { method: 'DELETE' });
    const response = await router.fetch(request);

    expect(response.status).toBe(405);
  });
});

// ===========================================================================
// handleLogout — GET /oauth2/logout
// ===========================================================================

describe('handleLogout', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout'), { method: 'GET' });
    const response = await handleLogout(request, config);

    expect(response.status).toBe(401);
  });

  it('returns 401 when access token is invalid (not found in session store)', async () => {
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(null),
    });
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout'), {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid-token' },
    });
    const response = await handleLogout(request, config);

    expect(response.status).toBe(401);
  });

  it('returns 200 HTML success and calls logoutSession on happy path', async () => {
    const session = makeSession();
    const logoutFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(session),
      logoutSession: logoutFn,
    });
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const response = await handleLogout(request, config);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(logoutFn).toHaveBeenCalledWith(session.id);
  });

  it('also works via POST', async () => {
    const session = makeSession();
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(session),
    });
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const response = await handleLogout(request, config);

    expect(response.status).toBe(200);
  });

  it('returns 405 for unsupported methods', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout'), { method: 'DELETE' });
    const response = await handleLogout(request, config);

    expect(response.status).toBe(405);
  });

  it('also dispatches through decapOauth2() router', async () => {
    const session = makeSession();
    const logoutFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(session),
      logoutSession: logoutFn,
    });
    const config = makeConfig(callbacks);
    const router = decapOauth2(config);
    const request = new Request(makeUrl('logout'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(logoutFn).toHaveBeenCalledWith(session.id);
  });
});

// ===========================================================================
// handleLogoutAll — GET /oauth2/logout-all
// ===========================================================================

describe('handleLogoutAll', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout-all'), { method: 'GET' });
    const response = await handleLogoutAll(request, config);

    expect(response.status).toBe(401);
  });

  it('returns 401 when access token is invalid', async () => {
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(null),
    });
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout-all'), {
      method: 'GET',
      headers: { Authorization: 'Bearer bad-token' },
    });
    const response = await handleLogoutAll(request, config);

    expect(response.status).toBe(401);
  });

  it('returns 200 HTML and calls logoutAll on happy path', async () => {
    const session = makeSession();
    const logoutAllFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(session),
      logoutAll: logoutAllFn,
    });
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout-all'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const response = await handleLogoutAll(request, config);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(logoutAllFn).toHaveBeenCalledWith(session.userId);
  });

  it('also works via POST', async () => {
    const session = makeSession();
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(session),
    });
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout-all'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const response = await handleLogoutAll(request, config);

    expect(response.status).toBe(200);
  });

  it('returns 405 for unsupported methods', async () => {
    const callbacks = makeCallbacks();
    const config = makeConfig(callbacks);
    const request = new Request(makeUrl('logout-all'), { method: 'DELETE' });
    const response = await handleLogoutAll(request, config);

    expect(response.status).toBe(405);
  });

  it('also dispatches through decapOauth2() router', async () => {
    const session = makeSession();
    const logoutAllFn = vi.fn().mockResolvedValue(undefined);
    const callbacks = makeCallbacks({
      getSessionByAccessToken: vi.fn().mockResolvedValue(session),
      logoutAll: logoutAllFn,
    });
    const config = makeConfig(callbacks);
    const router = decapOauth2(config);
    const request = new Request(makeUrl('logout-all'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const response = await router.fetch(request);

    expect(response.status).toBe(200);
    expect(logoutAllFn).toHaveBeenCalledWith(session.userId);
  });
});

// ===========================================================================
// decapOauth2() router — path dispatch
// ===========================================================================

describe('decapOauth2() router dispatch', () => {
  it('returns 404 for unknown routes', async () => {
    const config = makeConfig(makeCallbacks());
    const router = decapOauth2(config);

    const request = new Request(`${ORIGIN}/${BASE_PATH}/nonexistent`, { method: 'GET' });
    const response = await router.fetch(request);

    expect(response.status).toBe(404);
  });

  it('dispatches GET /authorize to handleAuthorize', async () => {
    const config = makeConfig(makeCallbacks());
    const router = decapOauth2(config);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'test-client',
      redirect_uri: 'https://example.com/callback',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
    const request = new Request(`${ORIGIN}/${BASE_PATH}/authorize?${params}`, { method: 'GET' });
    const response = await router.fetch(request);

    // handleAuthorize returns 200 HTML form for valid GET
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('dispatches POST /token to handleToken', async () => {
    const config = makeConfig(makeCallbacks());
    const router = decapOauth2(config);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'wrong-client', // will get invalid_client back
      code: 'any',
      redirect_uri: 'https://example.com/callback',
      code_verifier: 'a'.repeat(43),
    });
    const request = new Request(`${ORIGIN}/${BASE_PATH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const response = await router.fetch(request);

    // handleToken returns JSON error response — confirms it reached the right handler
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
