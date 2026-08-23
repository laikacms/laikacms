/**
 * Unit tests for oauth2 HTML templates (LCMS-167)
 *
 * All functions are pure HTML generators — no DOM, no network.
 */

import { describe, expect, it } from 'vitest';
import { defaultMessages } from '../i18n/index.js';
import { generatePasskeyScript, getAuthorizationPageHTML } from './authorization-page.js';
import { oauthErrorResponse, renderErrorPage } from './error.js';
import {
  buildCspWithLogo,
  escapeHtml,
  escapeHtmlAttribute,
  html,
  jsonForInlineScript,
  processCustomLogo,
  templateVars,
} from './html.js';
import { generateWebAuthnScript, renderEnhancedLoginPage } from './login-page.js';
import { renderLogoutAllSuccessPage, renderLogoutSuccessPage } from './logout-page.js';
import { renderPasskeySetupPage } from './passkey-setup-page.js';
import {
  renderForgotPasswordPage,
  renderForgotPasswordSuccessPage,
  renderResetPasswordPage,
  renderResetPasswordSuccessPage,
} from './password-reset-pages.js';
import { renderTotpSetupPage } from './totp-setup-page.js';
import { renderTotpVerificationPage } from './totp-verification-page.js';

// ---------------------------------------------------------------------------
// html.ts helpers
// ---------------------------------------------------------------------------

describe('templateVars', () => {
  it('has distinct symbol entries for each slot', () => {
    const keys = Object.keys(templateVars) as Array<keyof typeof templateVars>;
    const symbols = keys.map(k => templateVars[k]);
    const unique = new Set(symbols);
    expect(unique.size).toBe(keys.length);
  });
});

describe('html tagged template', () => {
  it('returns a function that substitutes symbol values', () => {
    const mySlot = Symbol('mySlot');
    const template = html`Hello ${mySlot}!`;
    expect(typeof template).toBe('function');
    expect(template({ [mySlot]: 'world' })).toBe('Hello world!');
  });

  it('uses empty string for unset symbol', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    const template = html`${a}|${b}`;
    expect(template({ [a]: 'X' })).toBe('X|');
  });

  it('passes through static string values', () => {
    const s = Symbol('s');
    const template = html`<div>${s}</div>`;
    expect(template({ [s]: '<b>safe</b>' })).toBe('<div><b>safe</b></div>');
  });
});

describe('processCustomLogo', () => {
  it('returns default decap logo when customLogo is undefined', () => {
    const result = processCustomLogo(undefined);
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.imgSrc).toHaveLength(0);
  });

  it('returns default decap logo when customLogo is empty string', () => {
    const result = processCustomLogo('');
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.imgSrc).toHaveLength(0);
  });

  it('wraps an absolute URL in an img tag and returns the origin for CSP', () => {
    const result = processCustomLogo('https://cdn.example.com/logo.png');
    expect(result.html).toContain('<img');
    expect(result.html).toContain('cdn.example.com/logo.png');
    expect(result.imgSrc).toContain('https://cdn.example.com');
  });

  it('uses custom alt text in the img tag', () => {
    const result = processCustomLogo('https://cdn.example.com/logo.png', 'My Brand');
    expect(result.html).toContain('My Brand');
  });

  it('returns inline HTML as-is and no imgSrc for non-URL logos', () => {
    const svgLogo = '<svg><circle/></svg>';
    const result = processCustomLogo(svgLogo);
    expect(result.html).toBe(svgLogo);
    expect(result.imgSrc).toHaveLength(0);
  });

  it('escapes special chars in URL attributes', () => {
    // A valid absolute URL with no special chars should not be escaped
    const result = processCustomLogo('https://example.com/logo.png');
    expect(result.html).not.toContain('&amp;');
  });
});

describe('buildCspWithLogo', () => {
  const base = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";

  it('returns the base policy unchanged when no additional img-src', () => {
    expect(buildCspWithLogo(base, [])).toBe(base);
  });

  it('appends origins to existing img-src directive', () => {
    const result = buildCspWithLogo(base, ['https://cdn.example.com']);
    expect(result).toContain("img-src 'self' data: https://cdn.example.com");
  });

  it('appends multiple origins', () => {
    const result = buildCspWithLogo(base, ['https://a.com', 'https://b.com']);
    expect(result).toContain('https://a.com');
    expect(result).toContain('https://b.com');
  });

  it('adds img-src directive when none exists in base policy', () => {
    const noImgSrc = "default-src 'self'";
    const result = buildCspWithLogo(noImgSrc, ['https://cdn.example.com']);
    expect(result).toContain('img-src');
    expect(result).toContain('https://cdn.example.com');
  });
});

// ---------------------------------------------------------------------------
// login-page.ts
// ---------------------------------------------------------------------------

describe('renderEnhancedLoginPage', () => {
  const base = { authorizeUrl: '/oauth2/authorize' };

  it('renders without throwing with minimal options', () => {
    const { html } = renderEnhancedLoginPage(base);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes the form action URL', () => {
    const { html } = renderEnhancedLoginPage(base);
    expect(html).toContain('action="/oauth2/authorize"');
  });

  it('includes the escaped error string when error is set', () => {
    const { html } = renderEnhancedLoginPage({ ...base, error: 'Invalid credentials' });
    expect(html).toContain('Invalid credentials');
  });

  it('escapes XSS in error string (escapeHtml path)', () => {
    const { html } = renderEnhancedLoginPage({ ...base, error: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes passkey script and challenge when passkeyOptions is non-null', () => {
    const { html } = renderEnhancedLoginPage({
      ...base,
      passkeyOptions: {
        challenge: 'challenge-base64url',
        rpId: 'example.com',
        timeout: 60000,
        userVerification: 'required',
      },
      passkeyVerifyUrl: '/auth/passkey/verify',
    });
    expect(html).toContain('<script>');
    expect(html).toContain('challenge-base64url');
  });

  it('omits forgot-password anchor when forgotPasswordUrl is absent', () => {
    const { html } = renderEnhancedLoginPage(base);
    expect(html).not.toContain('<a href');
  });

  it('includes forgot-password link when forgotPasswordUrl is provided', () => {
    const { html } = renderEnhancedLoginPage({
      ...base,
      forgotPasswordUrl: '/auth/forgot-password',
    });
    expect(html).toContain('forgot-password');
  });

  it('returns empty imgSrc without custom logo', () => {
    const { imgSrc } = renderEnhancedLoginPage(base);
    expect(imgSrc).toHaveLength(0);
  });

  it('returns imgSrc for external logo', () => {
    const { imgSrc } = renderEnhancedLoginPage({
      ...base,
      customLogo: 'https://cdn.example.com/logo.png',
    });
    expect(imgSrc).toContain('https://cdn.example.com');
  });
});

describe('generateWebAuthnScript', () => {
  const opts = {
    challenge: 'challenge-base64url',
    rpId: 'example.com',
    timeout: 60000,
    userVerification: 'required' as const,
  };

  it('returns a string containing <script> with non-null options', () => {
    const result = generateWebAuthnScript(opts, '/auth/passkey/verify');
    expect(typeof result).toBe('string');
    expect(result).toContain('<script>');
  });

  it('serializes the challenge JSON into the output', () => {
    const result = generateWebAuthnScript(opts, '/auth/passkey/verify');
    expect(result).toContain('challenge-base64url');
    expect(result).toContain('example.com');
  });

  it('embeds the verify URL in the script', () => {
    const result = generateWebAuthnScript(opts, '/my-verify-url');
    expect(result).toContain('/my-verify-url');
  });

  it('returns a script tag even when passkeyOptions is null', () => {
    const result = generateWebAuthnScript(null, '/auth/passkey/verify');
    expect(result).toContain('<script>');
    expect(result).toContain('null');
  });
});

// ---------------------------------------------------------------------------
// authorization-page.ts
// ---------------------------------------------------------------------------

describe('getAuthorizationPageHTML', () => {
  it('returns non-empty html', () => {
    const { html } = getAuthorizationPageHTML('/oauth2/authorize');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes the form action URL', () => {
    const { html } = getAuthorizationPageHTML('/my-auth-url');
    expect(html).toContain('action="/my-auth-url"');
  });

  it('includes email and password input fields', () => {
    const { html } = getAuthorizationPageHTML('/auth');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
  });

  it('has empty imgSrc when no custom logo', () => {
    const { imgSrc } = getAuthorizationPageHTML('/auth');
    expect(imgSrc).toHaveLength(0);
  });

  it('injects passkey section when passkeyEnabled', () => {
    const { html } = getAuthorizationPageHTML('/auth', {
      passkeyEnabled: true,
      passkeyVerifyUrl: '/auth/passkey/verify',
    });
    expect(html).toContain('passkey-button');
  });

  it('does not include passkey section when passkeyEnabled is false', () => {
    const { html } = getAuthorizationPageHTML('/auth', { passkeyEnabled: false });
    expect(html).not.toContain('id="passkey-button"');
  });

  it('includes forgot-password link when forgotPasswordUrl is provided', () => {
    const { html } = getAuthorizationPageHTML('/auth', {
      forgotPasswordUrl: '/auth/forgot-password',
    });
    expect(html).toContain('forgot-password');
  });

  it('injects external logo URL and returns imgSrc for CSP', () => {
    const { html, imgSrc } = getAuthorizationPageHTML('/auth', {
      customLogo: 'https://brand.example.com/logo.png',
    });
    expect(html).toContain('brand.example.com/logo.png');
    expect(imgSrc).toContain('https://brand.example.com');
  });

  it('injects inline SVG logo without adding to imgSrc', () => {
    const svgLogo = '<svg><text>Brand</text></svg>';
    const { html, imgSrc } = getAuthorizationPageHTML('/auth', { customLogo: svgLogo });
    expect(html).toContain('Brand');
    expect(imgSrc).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// error.ts
// ---------------------------------------------------------------------------

describe('renderErrorPage', () => {
  it('returns non-empty html', () => {
    const { html } = renderErrorPage({ error: 'access_denied' });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes the error code in the html', () => {
    const { html } = renderErrorPage({ error: 'invalid_request' });
    expect(html).toContain('invalid_request');
  });

  it('formats the error code as a title', () => {
    const { html } = renderErrorPage({ error: 'access_denied' });
    expect(html).toContain('Access Denied');
  });

  it('includes custom error description when provided', () => {
    const { html } = renderErrorPage({
      error: 'invalid_client',
      errorDescription: 'Client not found',
    });
    expect(html).toContain('Client not found');
  });

  it('escapes HTML in the error code', () => {
    const { html } = renderErrorPage({ error: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('returns imgSrc for external custom logo', () => {
    const { imgSrc } = renderErrorPage({
      error: 'access_denied',
      customLogo: 'https://cdn.example.com/logo.svg',
    });
    expect(imgSrc).toContain('https://cdn.example.com');
  });

  it('has empty imgSrc when no custom logo', () => {
    const { imgSrc } = renderErrorPage({ error: 'access_denied' });
    expect(imgSrc).toHaveLength(0);
  });
});

describe('oauthErrorResponse', () => {
  it('returns a Response with default status 400', () => {
    const response = oauthErrorResponse('invalid_request');
    expect(response.status).toBe(400);
  });

  it('returns a Response with the specified status', () => {
    const response = oauthErrorResponse('access_denied', undefined, 401);
    expect(response.status).toBe(401);
  });

  it('sets Content-Type to text/html', () => {
    const response = oauthErrorResponse('invalid_request');
    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  it('sets Content-Security-Policy header', () => {
    const response = oauthErrorResponse('invalid_request');
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// totp-verification-page.ts
// ---------------------------------------------------------------------------

describe('renderTotpVerificationPage', () => {
  const base = {
    authorizeUrl: '/oauth2/authorize',
    sessionId: 'sess-abc-123',
  };

  it('returns non-empty html', () => {
    const { html } = renderTotpVerificationPage(base);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes the form action URL', () => {
    const { html } = renderTotpVerificationPage(base);
    expect(html).toContain('action="/oauth2/authorize"');
  });

  it('includes the session id as a hidden field', () => {
    const { html } = renderTotpVerificationPage(base);
    expect(html).toContain('sess-abc-123');
  });

  it('includes a totp_code input', () => {
    const { html } = renderTotpVerificationPage(base);
    expect(html).toContain('name="totp_code"');
  });

  it('includes error message when provided', () => {
    const { html } = renderTotpVerificationPage({ ...base, error: 'Invalid code' });
    expect(html).toContain('Invalid code');
  });

  it('escapes HTML in error message', () => {
    const { html } = renderTotpVerificationPage({ ...base, error: '<b>xss</b>' });
    expect(html).not.toContain('<b>xss</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('returns empty imgSrc without custom logo', () => {
    const { imgSrc } = renderTotpVerificationPage(base);
    expect(imgSrc).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// totp-setup-page.ts
// ---------------------------------------------------------------------------

describe('renderTotpSetupPage', () => {
  const base = {
    qrCodeDataUrl: 'data:image/png;base64,abc',
    secret: 'ABCDEFGHIJKLMNOP',
    issuer: 'TestApp',
    email: 'user@example.com',
    setupToken: 'tok-xyz',
    redirectUri: '/admin',
  };

  it('returns non-empty html string', () => {
    const result = renderTotpSetupPage(base);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('<!DOCTYPE html>');
  });

  it('includes the QR code data URL', () => {
    const result = renderTotpSetupPage(base);
    expect(result).toContain('data:image/png;base64,abc');
  });

  it('includes the setup token', () => {
    const result = renderTotpSetupPage(base);
    expect(result).toContain('tok-xyz');
  });

  it('formats secret in groups of 4', () => {
    const result = renderTotpSetupPage(base);
    expect(result).toContain('ABCD EFGH IJKL MNOP');
  });
});

// ---------------------------------------------------------------------------
// passkey-setup-page.ts
// ---------------------------------------------------------------------------

describe('renderPasskeySetupPage', () => {
  const base = {
    setupToken: 'setup-tok-1',
    redirectUri: '/admin',
    userId: 'user-42',
    registrationOptions: {
      challenge: 'base64challenge==',
      rpId: 'example.com',
      rpName: 'Test App',
      userId: 'user-42',
      userName: 'user@example.com',
      timeout: 60000,
      attestation: 'none' as const,
      authenticatorSelection: {
        authenticatorAttachment: 'platform' as const,
        residentKey: 'required' as const,
        requireResidentKey: true,
        userVerification: 'required' as const,
      },
      excludeCredentials: [],
    },
  };

  it('returns non-empty html string', () => {
    const result = renderPasskeySetupPage(base);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('<!DOCTYPE html>');
  });

  it('includes the setup token', () => {
    const result = renderPasskeySetupPage(base);
    expect(result).toContain('setup-tok-1');
  });

  it('includes the redirect URI', () => {
    const result = renderPasskeySetupPage(base);
    expect(result).toContain('/admin');
  });

  it('includes a skip link when required is not set', () => {
    const result = renderPasskeySetupPage(base);
    // skip link links to redirectUri
    expect(result).toContain('href="/admin"');
  });

  it('omits the skip link anchor when required is true', () => {
    const result = renderPasskeySetupPage({ ...base, required: true });
    // When required, no <a class="skip-link"> should appear; class may still be in CSS
    expect(result).not.toContain('<a href="/admin" class="skip-link"');
    expect(result).not.toContain('class="skip-link"');
  });
});

// ---------------------------------------------------------------------------
// password-reset-pages.ts
// ---------------------------------------------------------------------------

describe('renderForgotPasswordPage', () => {
  const base = { baseUrl: 'https://api.example.com/cms' };

  it('returns non-empty html', () => {
    const { html } = renderForgotPasswordPage(base);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes the forgot-password form action URL', () => {
    const { html } = renderForgotPasswordPage(base);
    expect(html).toContain('https://api.example.com/cms/forgot-password');
  });

  it('defaults back-link to authorize endpoint (not javascript:)', () => {
    const { html } = renderForgotPasswordPage(base);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://api.example.com/cms/authorize');
  });

  it('uses provided loginUrl as back-link', () => {
    const { html } = renderForgotPasswordPage({ ...base, loginUrl: '/admin/login' });
    expect(html).toContain('href="/admin/login"');
  });

  it('includes error message when provided', () => {
    const { html } = renderForgotPasswordPage({ ...base, error: 'Email not found' });
    expect(html).toContain('Email not found');
  });

  it('returns empty imgSrc without custom logo', () => {
    const { imgSrc } = renderForgotPasswordPage(base);
    expect(imgSrc).toHaveLength(0);
  });

  it('returns imgSrc for external logo', () => {
    const { imgSrc } = renderForgotPasswordPage({
      ...base,
      customLogo: 'https://cdn.example.com/logo.png',
    });
    expect(imgSrc).toContain('https://cdn.example.com');
  });
});

describe('renderForgotPasswordSuccessPage', () => {
  it('returns non-empty html', () => {
    const { html } = renderForgotPasswordSuccessPage({ baseUrl: 'https://api.example.com/cms' });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('defaults back-link to authorize endpoint (not javascript:)', () => {
    const { html } = renderForgotPasswordSuccessPage({ baseUrl: 'https://api.example.com/cms' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://api.example.com/cms/authorize');
  });
});

describe('renderResetPasswordPage', () => {
  const base = { baseUrl: 'https://api.example.com/cms', token: 'reset-tok-999' };

  it('returns non-empty html', () => {
    const { html } = renderResetPasswordPage(base);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes the reset-password form action URL', () => {
    const { html } = renderResetPasswordPage(base);
    expect(html).toContain('https://api.example.com/cms/reset-password');
  });

  it('includes the reset token as a hidden field', () => {
    const { html } = renderResetPasswordPage(base);
    expect(html).toContain('reset-tok-999');
  });

  it('includes password input fields', () => {
    const { html } = renderResetPasswordPage(base);
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirm_password"');
  });
});

describe('renderResetPasswordSuccessPage', () => {
  it('returns non-empty html', () => {
    const { html } = renderResetPasswordSuccessPage({ baseUrl: 'https://api.example.com/cms' });
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('defaults sign-in link to authorize endpoint (not javascript:)', () => {
    const { html } = renderResetPasswordSuccessPage({ baseUrl: 'https://api.example.com/cms' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://api.example.com/cms/authorize');
  });
});

// ---------------------------------------------------------------------------
// logout-page.ts
// ---------------------------------------------------------------------------

describe('renderLogoutSuccessPage', () => {
  it('returns non-empty html', () => {
    const { html } = renderLogoutSuccessPage({});
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('uses the provided loginUrl in the back link', () => {
    const { html } = renderLogoutSuccessPage({ loginUrl: '/admin/login' });
    expect(html).toContain('href="/admin/login"');
  });

  it('returns empty imgSrc without custom logo', () => {
    const { imgSrc } = renderLogoutSuccessPage({});
    expect(imgSrc).toHaveLength(0);
  });

  it('returns imgSrc for external logo', () => {
    const { imgSrc } = renderLogoutSuccessPage({
      customLogo: 'https://cdn.example.com/logo.png',
    });
    expect(imgSrc).toContain('https://cdn.example.com');
  });
});

describe('renderLogoutAllSuccessPage', () => {
  it('returns non-empty html', () => {
    const { html } = renderLogoutAllSuccessPage({});
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('uses the provided loginUrl in the back link', () => {
    const { html } = renderLogoutAllSuccessPage({ loginUrl: '/auth/login' });
    expect(html).toContain('href="/auth/login"');
  });
});

// ---------------------------------------------------------------------------
// Reflected HTML-injection regression tests
//
// The html() tag performs no escaping, so every request-derived or
// consumer-supplied value must be escaped at the point of interpolation.
// These tests feed attribute-breakout payloads into the slots that were
// previously interpolated raw and assert they are neutralised.
// ---------------------------------------------------------------------------

const SCRIPT_PAYLOAD = '"><script>alert(1)</script>';
const FORM_PAYLOAD = '"><form action=https://evil.tld>';
const INJECTION_PAYLOADS = [SCRIPT_PAYLOAD, FORM_PAYLOAD];

/** Assert neither attribute-breakout payload survives unescaped. */
function expectNeutralised(rendered: string): void {
  expect(rendered).not.toContain('"><script>');
  expect(rendered).not.toContain('<script>alert(1)</script>');
  expect(rendered).not.toContain('"><form');
  expect(rendered).not.toContain('<form action=https://evil.tld>');
}

describe('escapeHtml / escapeHtmlAttribute', () => {
  it('escapes &, <, >, " and \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#039;');
  });

  it('escapeHtmlAttribute uses the same implementation', () => {
    expect(escapeHtmlAttribute(SCRIPT_PAYLOAD)).toBe(escapeHtml(SCRIPT_PAYLOAD));
  });
});

describe('jsonForInlineScript', () => {
  it('escapes < so </script> cannot terminate the script element', () => {
    const out = jsonForInlineScript('</script><script>alert(1)</script>');
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003C');
  });

  it('escapes U+2028 and U+2029 line terminators', () => {
    const out = jsonForInlineScript('a\u2028b\u2029c');
    expect(out).toBe('"a\\u2028b\\u2029c"');
  });

  it('round-trips through JSON.parse', () => {
    const value = { challenge: '</script>', name: 'a\u2028b' };
    expect(JSON.parse(jsonForInlineScript(value))).toEqual(value);
  });
});

describe('reset token injection (renderResetPasswordPage)', () => {
  it.each(INJECTION_PAYLOADS)('neutralises %s in the hidden token field', payload => {
    const { html } = renderResetPasswordPage({
      baseUrl: 'https://api.example.com/cms',
      token: payload,
      error: 'This reset link has expired or is invalid. Please request a new one.',
    });
    expectNeutralised(html);
    // Page still renders with the escaped token in the hidden input
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(`name="token" value="${escapeHtmlAttribute(payload)}"`);
    expect(html).toContain('name="password"');
  });
});

describe('authorize URL injection', () => {
  it.each(INJECTION_PAYLOADS)('getAuthorizationPageHTML neutralises %s', payload => {
    const { html } = getAuthorizationPageHTML(payload);
    expectNeutralised(html);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(`action="${escapeHtmlAttribute(payload)}"`);
  });

  it.each(INJECTION_PAYLOADS)('renderEnhancedLoginPage neutralises %s', payload => {
    const { html } = renderEnhancedLoginPage({ authorizeUrl: payload });
    expectNeutralised(html);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(`action="${escapeHtmlAttribute(payload)}"`);
  });

  it.each(INJECTION_PAYLOADS)('renderTotpVerificationPage neutralises %s', payload => {
    const { html } = renderTotpVerificationPage({ authorizeUrl: payload, sessionId: 'sess-1' });
    expectNeutralised(html);
    expect(html).toContain('<!DOCTYPE html>');
  });
});

describe('setup token injection', () => {
  it.each(INJECTION_PAYLOADS)('renderTotpSetupPage neutralises %s', payload => {
    const result = renderTotpSetupPage({
      qrCodeDataUrl: 'data:image/png;base64,abc',
      secret: 'ABCDEFGHIJKLMNOP',
      issuer: 'TestApp',
      email: 'user@example.com',
      setupToken: payload,
      redirectUri: '/admin',
    });
    expectNeutralised(result);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain(`name="setup_token" value="${escapeHtmlAttribute(payload)}"`);
  });

  it.each(INJECTION_PAYLOADS)('renderPasskeySetupPage neutralises %s', payload => {
    const result = renderPasskeySetupPage({
      setupToken: payload,
      redirectUri: '/admin',
      userId: 'user-42',
      registrationOptions: {
        challenge: 'base64challenge',
        rp: { id: 'example.com', name: 'Test App' },
        user: { id: 'dXNlci00Mg', name: 'user@example.com', displayName: 'User' },
        pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
        timeout: 60000,
        attestation: 'none' as const,
        authenticatorSelection: {
          residentKey: 'required' as const,
          userVerification: 'required' as const,
        },
        excludeCredentials: [],
      },
    });
    expectNeutralised(result);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain(`name="setup_token" value="${escapeHtmlAttribute(payload)}"`);
  });
});

describe('translation string injection', () => {
  it('neutralises a hostile translation in the authorization page passkey button', () => {
    const { html } = getAuthorizationPageHTML('/auth', {
      passkeyEnabled: true,
      passkeyVerifyUrl: '/auth/passkey/verify',
      messages: {
        ...defaultMessages,
        auth: { ...defaultMessages.auth, signInWithPasskey: SCRIPT_PAYLOAD },
      },
    });
    expectNeutralised(html);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="passkey-button"');
  });

  it('neutralises a hostile translation embedded in inline-script i18n JSON', () => {
    const script = generatePasskeyScript(
      { challenge: 'c', rpId: 'example.com', timeout: 60000, userVerification: 'required' },
      '/auth/passkey/verify',
      { ...defaultMessages.auth, authenticating: '</script><script>alert(1)</script>' },
    );
    expect(script).not.toContain('</script><script>');
    expect(script).toContain('\\u003C/script');
  });

  it('neutralises a hostile translation in generateWebAuthnScript i18n JSON', () => {
    const script = generateWebAuthnScript(
      { challenge: 'c', rpId: 'example.com', timeout: 60000, userVerification: 'required' },
      '/auth/passkey/verify',
      { ...defaultMessages.auth, authenticating: '</script><script>alert(1)</script>' },
    );
    expect(script).not.toContain('</script><script>');
    expect(script).toContain('\\u003C/script');
  });
});

describe('inline-script JSON injection (passkey options)', () => {
  it('cannot break out of the script element via a </script> in the challenge', () => {
    const { html } = renderEnhancedLoginPage({
      authorizeUrl: '/auth',
      passkeyOptions: {
        challenge: '</script><script>alert(1)</script>',
        rpId: 'example.com',
        timeout: 60000,
        userVerification: 'required',
      },
      passkeyVerifyUrl: '/auth/passkey/verify',
    });
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('\\u003C/script');
  });
});
