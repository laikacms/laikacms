/**
 * Unit tests for CAPTCHA feature on login (POST /authorize) and
 * forgot-password (POST /forgot-password) handlers, plus HTML injection
 * into getAuthorizationPageHTML and renderForgotPasswordPage.
 *
 * LCMS-355
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above imports
// ---------------------------------------------------------------------------

vi.mock('laikacms/crypto', () => ({
  addTimingJitter: vi.fn().mockResolvedValue(undefined),
  constantTimeEqual: vi.fn().mockImplementation((a: string, b: string) => Promise.resolve(a === b)),
  generateSecureRandomString: vi.fn().mockImplementation((len: number) => 'x'.repeat(len)),
  sha256: vi.fn().mockImplementation(async (plain: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }),
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
import { verifyPassword } from 'laikacms/crypto';
import { decapOauth2, handleAuthorize } from './oauth2.js';
import type { CaptchaConfig, OAuthCallbacks, OAuthConfig, User } from './oauth2.js';
import { getAuthorizationPageHTML } from './templates/authorization-page.js';
import { renderForgotPasswordPage } from './templates/password-reset-pages.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_PATH = 'oauth2';
const ORIGIN = 'https://auth.example.com';
const CLIENT_ID = 'test-client';
const REDIRECT_URI = 'https://example.com/callback';

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

function makePasswordResetCallbacks() {
  return {
    storeResetToken: vi.fn().mockResolvedValue(undefined),
    getResetToken: vi.fn().mockResolvedValue(null),
    deleteResetToken: vi.fn().mockResolvedValue(undefined),
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCaptchaConfig(overrides: Partial<CaptchaConfig> = {}): CaptchaConfig {
  return {
    enabled: true,
    widgetHtml: '<div class="h-captcha" data-sitekey="test-key"></div>',
    scriptHtml: '<script src="https://js.hcaptcha.com/1/api.js" async defer></script>',
    responseFieldName: 'h-captcha-response',
    verify: vi.fn().mockResolvedValue(true),
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

function makePasswordResetConfig(prCbs: ReturnType<typeof makePasswordResetCallbacks>) {
  return {
    resetTokenExpirySeconds: 3600,
    fromEmail: 'noreply@example.com',
    callbacks: prCbs,
  };
}

/** Build the authorize URL with required PKCE and OAuth params. */
async function makeAuthorizeUrl(): Promise<{ url: string, codeVerifier: string }> {
  const codeVerifier = 'a'.repeat(43);
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return {
    url: `${ORIGIN}/${BASE_PATH}/authorize?${params}`,
    codeVerifier,
  };
}

/** Build a URL under the configured basePath. */
function makeUrl(subpath: string): string {
  return `${ORIGIN}/${BASE_PATH}/${subpath}`;
}

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Login (POST /authorize) — CAPTCHA verification
// ===========================================================================

describe('handleAuthorize POST — CAPTCHA verification', () => {
  let authorizeUrl: string;

  beforeEach(async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const result = await makeAuthorizeUrl();
    authorizeUrl = result.url;
  });

  it('returns 400 when CAPTCHA is enabled and token is absent', async () => {
    const captcha = makeCaptchaConfig();
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(makeUser()) });
    const config = makeConfig(callbacks, { captcha });

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    // no captcha token field
    const request = new Request(authorizeUrl, { method: 'POST', body });
    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('CAPTCHA verification required');
  });

  it('returns 400 when CAPTCHA is enabled and verify() returns false', async () => {
    const captcha = makeCaptchaConfig({ verify: vi.fn().mockResolvedValue(false) });
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(makeUser()) });
    const config = makeConfig(callbacks, { captcha });

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    body.set('h-captcha-response', 'bad-token');
    const request = new Request(authorizeUrl, { method: 'POST', body });
    const response = await handleAuthorize(request, config);

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('CAPTCHA verification failed');
  });

  it('proceeds to credential check when CAPTCHA verify() returns true', async () => {
    const captcha = makeCaptchaConfig({ verify: vi.fn().mockResolvedValue(true) });
    const getUserByEmail = vi.fn().mockResolvedValue(makeUser());
    const callbacks = makeCallbacks({ getUserByEmail });
    const config = makeConfig(callbacks, { captcha });

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    body.set('h-captcha-response', 'valid-token');
    const request = new Request(authorizeUrl, { method: 'POST', body });
    const response = await handleAuthorize(request, config);

    // Credential check ran — user was looked up
    expect(getUserByEmail).toHaveBeenCalled();
    // Valid creds → redirect with authorization code
    expect(response.status).toBe(302);
  });

  it('calls verify() with the value from formData.get(responseFieldName)', async () => {
    const verifyFn = vi.fn().mockResolvedValue(true);
    const captcha = makeCaptchaConfig({
      responseFieldName: 'cf-turnstile-response',
      verify: verifyFn,
    });
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(makeUser()) });
    const config = makeConfig(callbacks, { captcha });

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    body.set('cf-turnstile-response', 'turnstile-token-xyz');
    const request = new Request(authorizeUrl, { method: 'POST', body });
    await handleAuthorize(request, config);

    expect(verifyFn).toHaveBeenCalled();
    expect(vi.mocked(verifyFn).mock.calls[0][0]).toBe('turnstile-token-xyz');
  });

  it('does not call verify() when CAPTCHA is disabled', async () => {
    const verifyFn = vi.fn().mockResolvedValue(true);
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(makeUser()) });
    // No captcha config
    const config = makeConfig(callbacks);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('password', 'password123');
    const request = new Request(authorizeUrl, { method: 'POST', body });
    await handleAuthorize(request, config);

    expect(verifyFn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Forgot-password (POST /forgot-password via router) — CAPTCHA verification
// ===========================================================================

describe('decapOauth2() POST /forgot-password — CAPTCHA verification', () => {
  it('returns 400 with CAPTCHA error when token is absent', async () => {
    const captcha = makeCaptchaConfig();
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      captcha,
      passwordReset: makePasswordResetConfig(prCbs),
    });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('email', 'user@example.com');
    // no captcha token
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('CAPTCHA verification required');
  });

  it('returns 400 with CAPTCHA error when verify() returns false', async () => {
    const captcha = makeCaptchaConfig({ verify: vi.fn().mockResolvedValue(false) });
    const callbacks = makeCallbacks();
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      captcha,
      passwordReset: makePasswordResetConfig(prCbs),
    });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('h-captcha-response', 'invalid-token');
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('CAPTCHA verification failed');
  });

  it('proceeds to requestPasswordReset when verify() returns true', async () => {
    const { requestPasswordReset } = await import('./email/email.js');
    vi.mocked(requestPasswordReset).mockResolvedValue({ success: true });

    const captcha = makeCaptchaConfig({ verify: vi.fn().mockResolvedValue(true) });
    const getUserByEmail = vi.fn().mockResolvedValue(makeUser());
    const callbacks = makeCallbacks({ getUserByEmail });
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      captcha,
      passwordReset: makePasswordResetConfig(prCbs),
    });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('h-captcha-response', 'valid-token');
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    const response = await router.fetch(request);

    // Success path renders 200 HTML (email-sent page)
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('calls verify() with the value from formData.get(responseFieldName) (custom field)', async () => {
    const verifyFn = vi.fn().mockResolvedValue(true);
    const captcha = makeCaptchaConfig({
      responseFieldName: 'g-recaptcha-response',
      verify: verifyFn,
    });
    const callbacks = makeCallbacks({ getUserByEmail: vi.fn().mockResolvedValue(makeUser()) });
    const prCbs = makePasswordResetCallbacks();
    const config = makeConfig(callbacks, {
      captcha,
      passwordReset: makePasswordResetConfig(prCbs),
    });
    const router = decapOauth2(config);

    const body = new FormData();
    body.set('email', 'user@example.com');
    body.set('g-recaptcha-response', 'recaptcha-token-abc');
    const request = new Request(makeUrl('forgot-password'), { method: 'POST', body });
    await router.fetch(request);

    expect(verifyFn).toHaveBeenCalled();
    expect(vi.mocked(verifyFn).mock.calls[0][0]).toBe('recaptcha-token-abc');
  });
});

// ===========================================================================
// Template HTML injection — getAuthorizationPageHTML
// ===========================================================================

describe('getAuthorizationPageHTML — CAPTCHA HTML injection', () => {
  it('injects captchaWidgetHtml into rendered HTML', () => {
    const widgetHtml = '<div class="h-captcha" data-sitekey="site-key-123"></div>';
    const result = getAuthorizationPageHTML(`${ORIGIN}/${BASE_PATH}/authorize?response_type=code`, {
      captchaWidgetHtml: widgetHtml,
    });
    expect(result.html).toContain(widgetHtml);
  });

  it('injects captchaScriptHtml into rendered HTML', () => {
    const scriptHtml = '<script src="https://js.hcaptcha.com/1/api.js" async defer></script>';
    const result = getAuthorizationPageHTML(`${ORIGIN}/${BASE_PATH}/authorize?response_type=code`, {
      captchaScriptHtml: scriptHtml,
    });
    expect(result.html).toContain(scriptHtml);
  });

  it('omits captcha HTML when not provided', () => {
    const result = getAuthorizationPageHTML(`${ORIGIN}/${BASE_PATH}/authorize?response_type=code`, {});
    expect(result.html).not.toContain('h-captcha');
    expect(result.html).not.toContain('hcaptcha.com');
  });
});

// ===========================================================================
// Template HTML injection — renderForgotPasswordPage
// ===========================================================================

describe('renderForgotPasswordPage — CAPTCHA HTML injection', () => {
  it('injects captchaWidget into rendered HTML', () => {
    const widgetHtml = '<div class="g-recaptcha" data-sitekey="site-key-456"></div>';
    const result = renderForgotPasswordPage({
      baseUrl: `${ORIGIN}/${BASE_PATH}`,
      captchaWidget: widgetHtml,
    });
    expect(result.html).toContain(widgetHtml);
  });

  it('injects captchaScript into rendered HTML', () => {
    const scriptHtml = '<script src="https://www.google.com/recaptcha/api.js" async defer></script>';
    const result = renderForgotPasswordPage({
      baseUrl: `${ORIGIN}/${BASE_PATH}`,
      captchaScript: scriptHtml,
    });
    expect(result.html).toContain(scriptHtml);
  });

  it('omits captcha HTML when not provided', () => {
    const result = renderForgotPasswordPage({
      baseUrl: `${ORIGIN}/${BASE_PATH}`,
    });
    expect(result.html).not.toContain('g-recaptcha');
    expect(result.html).not.toContain('hcaptcha');
  });
});
