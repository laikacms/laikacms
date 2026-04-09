// PKCE OAuth 2.0 implementation for Decap CMS
// Security hardened for post-quantum computing resistance
import { TemplateLiteral as TL, Url } from '@laikacms/core';
import {
  addTimingJitter,
  constantTimeEqual,
  generateSecureRandomString,
  sha256,
  verifyPassword,
} from '@laikacms/crypto';
import { type PasswordResetConfig, requestPasswordReset, resetPassword } from './email/email.js';
import { type OAuthMessages } from './i18n/index.js';
import { type OAuthTotpConfig, setupOAuthTOTP, verifyOAuthTOTPSetup, verifyTOTP } from './totp/totp.js';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  PasskeyConfig,
  verifyAuthentication,
  verifyRegistration,
} from './passkey/passkey.js';
import { AuthorizationPageOptions, getAuthorizationPageHTML } from './templates/authorization-page.js';
import { renderErrorPage } from './templates/error.js';
import { renderLogoutAllSuccessPage, renderLogoutSuccessPage } from './templates/logout-page.js';
import { renderPasskeySetupPage } from './templates/passkey-setup-page.js';
import {
  renderForgotPasswordPage,
  renderForgotPasswordSuccessPage,
  renderResetPasswordPage,
  renderResetPasswordSuccessPage,
} from './templates/password-reset-pages.js';
import { renderTotpSetupPage } from './templates/totp-setup-page.js';
import { renderTotpVerificationPage } from './templates/totp-verification-page.js';
export type { AuthorizationPageOptions } from './templates/authorization-page.js';

interface Logger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  fatal(...args: any[]): void;
}

export {
  authorizeUrl,
  buildCspWithLogo,
  forgotPasswordSection,
  getMessages,
  html,
  logoHtml,
  messages,
  passkeyScript,
  passkeySection,
  passkeyStyles,
  processCustomLogo,
  templateVars,
} from './templates/html.js';
export type { HtmlTemplate, ProcessedLogo, TemplateVariables, TemplateVarsType } from './templates/html.js';

import { info } from 'effect/Console';
import { buildCspWithLogo, processCustomLogo } from './templates/html.js';

// Security constants for post-quantum resistance
const SECURITY_CONSTANTS = {
  // Minimum token lengths for post-quantum security (256+ bits of entropy)
  MIN_AUTH_CODE_LENGTH: 64, // 384 bits with base62
  MIN_ACCESS_TOKEN_LENGTH: 128, // 768 bits with base62
  MIN_REFRESH_TOKEN_LENGTH: 128, // 768 bits with base62
  MIN_SESSION_ID_LENGTH: 64, // 384 bits with base62
  MIN_SETUP_TOKEN_LENGTH: 64, // 384 bits with base62
  // Maximum input lengths to prevent DoS
  MAX_EMAIL_LENGTH: 254, // RFC 5321
  MAX_PASSWORD_LENGTH: 1024, // Reasonable limit for bcrypt
  MAX_TOKEN_LENGTH: 2048, // Prevent memory exhaustion
  MAX_URI_LENGTH: 8192, // Reasonable URI limit
  MAX_SCOPE_LENGTH: 1024, // Reasonable scope limit
  // Timing attack protection delay (microseconds variance)
  TIMING_JITTER_MS: 50,
} as const;

export interface AuthorizationCode {
  code: string;
  codeChallenge: string;
  codeChallengeMethod: string; // Only 'S256' is supported
  redirectUri: string;
  clientId: string;
  scope: string[];
  userId: string;
  expiresAt: number;
}

/**
 * Default user interface with required fields for OAuth authentication.
 * Consumers can extend this by declaring the module:
 *
 * @example
 * ```typescript
 * declare module '@laikacms/decap-oauth2' {
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
  passwordHash: string;
}

/**
 * OAuth Session - stores access and refresh tokens together
 * This ensures atomic operations: when a session is deleted, both tokens are removed
 * When refreshing, the old session is deleted and a new one is created
 */
export interface OAuthSession {
  id: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  scope: string[];
  userId: string;
  createdAt: number;
}

export interface OAuthCallbacks {
  // Retrieve user by email (used during login)
  getUserByEmail(email: string): Promise<User | null>;

  // Retrieve user by ID (used for token validation)
  getUserById(id: string): Promise<User | null>;

  // Store authorization code with PKCE challenge
  storeAuthorizationCode(code: AuthorizationCode): Promise<void>;

  // Retrieve and validate authorization code
  getAuthorizationCode(code: string): Promise<AuthorizationCode | null>;

  // Delete authorization code after use (one-time use)
  deleteAuthorizationCode(code: string): Promise<void>;

  // Create a new OAuth session with both access and refresh tokens
  createSession(session: OAuthSession): Promise<void>;

  // Get session by access token (for validating requests)
  getSessionByAccessToken(accessToken: string): Promise<OAuthSession | null>;

  // Get session by refresh token (for token refresh)
  getSessionByRefreshToken(refreshToken: string): Promise<OAuthSession | null>;

  // Logout from a single session (by session ID)
  // Used during token refresh to invalidate the old session
  logoutSession(sessionId: string): Promise<void>;

  // Logout from all sessions for a user
  // Useful for "logout everywhere" functionality or when user changes password
  logoutAll(userId: string): Promise<void>;
}

/**
 * Passkey (WebAuthn) configuration options.
 * Uses PasskeyCallbacks from the passkey module for storage operations.
 */
export interface PasskeyOptions extends PasskeyConfig {
  /** Enable passkey authentication */
  enabled: boolean;
  /** Require users to set up a passkey (forces enrollment if not configured) */
  required?: boolean;
}

/**
 * Generic CAPTCHA configuration.
 * Supports any CAPTCHA provider (reCAPTCHA, hCaptcha, Cloudflare Turnstile, etc.)
 * by allowing custom HTML/scripts and a verification callback.
 */
export interface CaptchaConfig {
  /** Enable CAPTCHA on login and forgot password forms */
  enabled: boolean;

  /**
   * HTML to render the CAPTCHA widget in the form.
   * This is inserted before the submit button.
   *
   * Examples:
   * - reCAPTCHA v2: `<div class="g-recaptcha" data-sitekey="YOUR_SITE_KEY"></div>`
   * - hCaptcha: `<div class="h-captcha" data-sitekey="YOUR_SITE_KEY"></div>`
   * - Turnstile: `<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>`
   */
  widgetHtml: string;

  /**
   * Script tag(s) to load the CAPTCHA library.
   * This is inserted in the <head> section.
   *
   * Examples:
   * - reCAPTCHA: `<script src="https://www.google.com/recaptcha/api.js" async defer></script>`
   * - hCaptcha: `<script src="https://js.hcaptcha.com/1/api.js" async defer></script>`
   * - Turnstile: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
   */
  scriptHtml: string;

  /**
   * Name of the form field that contains the CAPTCHA response token.
   * Default field names by provider:
   * - reCAPTCHA: 'g-recaptcha-response'
   * - hCaptcha: 'h-captcha-response'
   * - Turnstile: 'cf-turnstile-response'
   */
  responseFieldName: string;

  /**
   * Verify the CAPTCHA response token.
   * This callback should call your CAPTCHA provider's verification API.
   *
   * @param token - The CAPTCHA response token from the form submission
   * @param remoteIp - The client's IP address (optional, some providers require this)
   * @returns Promise resolving to true if verification passed, false otherwise
   *
   * Example implementation for Cloudflare Turnstile:
   * ```typescript
   * async verify(token, remoteIp) {
   *   const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
   *     body: new URLSearchParams({
   *       secret: TURNSTILE_SECRET_KEY,
   *       response: token,
   *       remoteip: remoteIp || '',
   *     }),
   *   });
   *   const result = await response.json();
   *   return result.success === true;
   * }
   * ```
   */
  verify(token: string, remoteIp?: string): Promise<boolean>;
}

export interface OAuthConfig {
  callbacks: OAuthCallbacks;
  clientId: string;
  // Access token expiration in seconds (default: 3600 = 1 hour)
  accessTokenExpiration?: number;
  // Refresh token expiration in seconds (default: 2592000 = 30 days)
  refreshTokenExpiration?: number;
  // Authorization code expiration in seconds (default: 600 = 10 minutes)
  authCodeExpiration?: number;
  authorizeEndpoint?: string; // default: /oauth2/authorize
  tokenEndpoint?: string; // default: /oauth2/token

  // Optional security features
  /** Passkey (WebAuthn) configuration - if provided, enables passkey authentication */
  passkey?: PasskeyOptions;
  /** TOTP 2FA configuration - if provided, enables TOTP verification */
  totp?: OAuthTotpConfig;
  /** Password reset configuration - if provided, enables forgot password flow on login page */
  passwordReset?: PasswordResetConfig;
  /** CAPTCHA configuration - if provided, enables CAPTCHA on login and forgot password forms */
  captcha?: CaptchaConfig;

  // UI customization
  /** Custom logo HTML to replace the default Decap CMS logo */
  customLogo?: string;
  /** Custom CSS styles to append to the default styles */
  customStyles?: string;
  /** URL to redirect users to after password reset (e.g., frontend CMS admin page) */
  loginRedirectUrl?: string;
  /**
   * Localized messages for user-facing strings.
   * If not provided, defaults to English messages.
   * Import translations from '@laikacms/decap-oauth2/i18n' or provide custom messages.
   * @example
   * ```typescript
   * import { nl } from '@laikacms/decap-oauth2/i18n';
   * const config: OAuthConfig = {
   *   messages: nl,
   *   // ... other options
   * };
   * ```
   */
  translations?: OAuthMessages;
  logger?: Logger;
  basePath: string;
}

/**
 * Validate input length to prevent DoS attacks and buffer overflows.
 * Returns sanitized input or null if invalid.
 */
function validateInputLength(input: string | null | undefined, maxLength: number): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }
  if (input.length > maxLength) {
    return null;
  }
  return input;
}

/**
 * Validate email format with length check.
 * Uses a simple but effective regex that covers most valid emails.
 */
function validateEmail(email: string | null | undefined): string | null {
  const validated = validateInputLength(email, SECURITY_CONSTANTS.MAX_EMAIL_LENGTH);
  if (!validated) return null;

  // Basic email validation - not too strict to avoid rejecting valid emails
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(validated)) {
    return null;
  }

  return validated.toLowerCase().trim();
}

/**
 * Validate URI format and length.
 */
function validateUri(uri: string | null | undefined): string | null {
  const validated = validateInputLength(uri, SECURITY_CONSTANTS.MAX_URI_LENGTH);
  if (!validated) return null;

  try {
    // Attempt to parse as URL to validate format
    new URL(validated);
    return validated;
  } catch {
    return null;
  }
}

/**
 * Verify PKCE code challenge using constant-time comparison.
 *
 * @param codeVerifier - The code verifier from the token request
 * @param codeChallenge - The code challenge from the authorization request
 * @param method - Challenge method (only S256 supported)
 * @returns true if verification passes
 */
async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: 'S256',
): Promise<boolean> {
  // Validate input lengths
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  if (!codeChallenge || codeChallenge.length < 43 || codeChallenge.length > 128) {
    return false;
  }

  const hash = await sha256(codeVerifier);
  // Use constant-time comparison to prevent timing attacks
  return await constantTimeEqual(hash, codeChallenge);
}

// OAuth 2.0 standardized error response (RFC 6749)
// Returns HTML for browser requests, JSON for API requests
function oauthError(
  error: string,
  errorDescription?: string,
  errorUri?: string,
  status: number = 400,
): Response {
  // For API requests, return JSON per RFC 6749
  const body: {
    error: string,
    error_description?: string,
    error_uri?: string,
  } = { error };

  if (errorDescription) {
    body.error_description = errorDescription;
  }

  if (errorUri) {
    body.error_uri = errorUri;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    },
  });
}

interface OnAuthErrorHtmlOptions {
  error: string;
  errorDescription?: string;
  status: number;
  messages?: OAuthMessages;
  customLogo?: string;
  goBackHref: string;
}

// HTML error page for OAuth errors (browser-facing) - uses template from templates folder
function oauthErrorHtml(options: OnAuthErrorHtmlOptions): Response {
  const errorPage = renderErrorPage(options);

  // Build CSP with logo origins if needed
  const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";
  const csp = buildCspWithLogo(baseCsp, errorPage.imgSrc);

  return new Response(errorPage.html, {
    status: options.status,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
    },
  });
}

// Re-export defaultAuthorizationPageTemplate from templates for backward compatibility
export { defaultAuthorizationPageTemplate } from './templates/authorization-page.js';

// Helper function to render the TOTP verification page
// Uses the template from templates/totp-verification-page.ts
// Returns object with html and imgSrc for CSP
function getTotpVerificationPage(authUrl: string, sessionId: string, messages?: OAuthMessages, customLogo?: string) {
  return renderTotpVerificationPage({
    authorizeUrl: authUrl,
    sessionId,
    messages,
    customLogo,
  });
}

// Handle OAuth authorization endpoint
// Security hardened with input validation and timing attack protection
export async function handleAuthorize(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    config.logger?.debug('Invalid method for authorize endpoint:', request.method);
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Method not allowed',
      status: 405,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  // Extract and validate OAuth parameters with length limits
  const responseType = validateInputLength(params.get('response_type'), 32);
  const clientId = validateInputLength(params.get('client_id'), 256);
  const redirectUri = validateUri(params.get('redirect_uri'));
  const codeChallenge = validateInputLength(params.get('code_challenge'), 128);
  const codeChallengeMethod = validateInputLength(params.get('code_challenge_method'), 16) as 'S256' | null;
  const scopeRaw = validateInputLength(params.get('scope'), SECURITY_CONSTANTS.MAX_SCOPE_LENGTH);
  const scope = scopeRaw?.split(' ').filter(s => s.length > 0 && s.length <= 64) || [];
  const state = validateInputLength(params.get('state'), 256);

  // Validate required parameters
  if (responseType !== 'code') {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'unsupported_response_type',
      errorDescription: 'Only "code" response type is supported',
      status: 400,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // Use constant-time comparison for client_id to prevent timing attacks
  if (!clientId || !(await constantTimeEqual(clientId, config.clientId))) {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'invalid_client',
      errorDescription: 'Invalid or missing client_id',
      status: 401,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  if (!redirectUri) {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Missing or invalid redirect_uri',
      status: 400,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  if (!codeChallenge || codeChallenge.length < 43) {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Missing or invalid code_challenge (PKCE required)',
      status: 400,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  if (!codeChallengeMethod || codeChallengeMethod !== 'S256') {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Invalid code_challenge_method. Must be "S256"',
      status: 400,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // For GET requests, return authorization page HTML
  if (request.method === 'GET') {
    // Check if this is a TOTP verification request (after passkey authentication)
    const totpSessionParam = params.get('totp_session');
    if (totpSessionParam && config.totp?.enabled) {
      // Verify the TOTP session exists
      const pendingSession = await config.totp.callbacks.getPendingTotpSession(totpSessionParam);
      if (pendingSession) {
        // Show TOTP verification page
        const totpPage = getTotpVerificationPage(
          url.toString(),
          totpSessionParam,
          config.translations,
          config.customLogo,
        );
        const baseCsp =
          "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:";
        const csp = buildCspWithLogo(baseCsp, totpPage.imgSrc);

        return new Response(totpPage.html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': csp,
          },
        });
      }
      // If session is invalid, fall through to show login page
    }

    const passkeyEnabled = !!config.passkey?.enabled;
    const passwordResetEnabled = !!config.passwordReset;

    // Generate passkey options if passkey is enabled
    let passkeyOptions: AuthorizationPageOptions['passkeyOptions'] = null;
    let passkeyVerifyUrl = '';

    if (passkeyEnabled && config.passkey) {
      try {
        config.logger?.debug('Generating passkey authentication options...');

        // Generate authentication options (without userId for discoverable credentials)
        const authOptions = await generateAuthenticationOptions(config.passkey);
        config.logger?.debug('Generated passkey options:', JSON.stringify(authOptions.publicKey));

        // Extract the publicKey options for embedding
        passkeyOptions = {
          challenge: authOptions.publicKey.challenge,
          rpId: authOptions.publicKey.rpId,
          timeout: authOptions.publicKey.timeout,
          userVerification: authOptions.publicKey.userVerification,
          allowCredentials: authOptions.publicKey.allowCredentials?.map(c => ({
            type: c.type,
            id: c.id,
            transports: c.transports,
          })),
        };

        // Build the verify URL (same base path as authorize)
        passkeyVerifyUrl = TL.url`${url.origin}/${config.basePath}/passkey/authenticate/verify${url.search}`;
        config.logger?.debug('Passkey verify URL:', passkeyVerifyUrl);
      } catch (err) {
        // Log error but continue - passkey will just not auto-login
        config.logger?.error('Failed to generate passkey options', err);
      }
    }

    // Build forgot password URL if password reset is enabled
    const forgotPasswordUrl = passwordResetEnabled
      ? TL.url`${url.origin}/${config.basePath}/forgot-password`
      : undefined;

    config.logger?.debug(
      `Rendering authorization page with passkey: ${passkeyEnabled}, options: ${!!passkeyOptions}, passwordReset: ${passwordResetEnabled}`,
    );

    // Get CAPTCHA config if enabled
    const captchaEnabled = !!config.captcha?.enabled;
    const captchaWidgetHtml = captchaEnabled ? config.captcha!.widgetHtml : undefined;
    const captchaScriptHtml = captchaEnabled ? config.captcha!.scriptHtml : undefined;

    // Render the authorization page with custom logo support
    const authPage = getAuthorizationPageHTML(url.toString(), {
      passkeyEnabled,
      passkeyOptions,
      passkeyVerifyUrl,
      forgotPasswordUrl,
      captchaWidgetHtml,
      captchaScriptHtml,
      customLogo: config.customLogo,
      messages: config.translations,
    });

    // Build CSP with logo origins if needed
    // Include Cloudflare Turnstile domains if CAPTCHA is enabled
    const captchaCspAdditions = captchaEnabled
      ? ' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com'
      : '';
    const baseCsp = passkeyEnabled
      ? `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${captchaCspAdditions}; img-src 'self' data:; connect-src 'self'`
      : `default-src 'self'; style-src 'unsafe-inline'${
        captchaEnabled
          ? "; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com"
          : ''
      }; img-src 'self' data:`;
    const csp = buildCspWithLogo(baseCsp, authPage.imgSrc);

    return new Response(authPage.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': csp,
      },
    });
  }

  // For POST requests, validate credentials and issue authorization code
  const formData = await request.formData();

  // Check if this is a TOTP verification request (has totp_session but no email/password)
  const totpCode = formData.get('totp_code')?.toString();
  const totpSession = formData.get('totp_session')?.toString();

  if (totpCode && totpSession && config.totp?.enabled) {
    // This is a TOTP verification request - get userId from the pending session
    const pendingSession = await config.totp.callbacks.getPendingTotpSession(totpSession);
    if (!pendingSession) {
      await addTimingJitter();
      return oauthErrorHtml({
        error: 'access_denied',
        errorDescription: 'Invalid or expired TOTP session',
        status: 401,
        messages: config.translations,
        goBackHref: config.loginRedirectUrl || '/',
      });
    }

    const userId = pendingSession.userId;

    const secret = await config.totp.callbacks.getTotpSecret(userId);
    if (!secret) {
      await addTimingJitter();
      return oauthErrorHtml({
        error: 'server_error',
        errorDescription: 'TOTP configuration error',
        status: 500,
        messages: config.translations,
        goBackHref: config.loginRedirectUrl || '/',
      });
    }

    // Import TOTP verification from totp module
    const isValidTotp = await verifyTOTP(secret, totpCode);

    if (!isValidTotp) {
      await addTimingJitter();
      return oauthErrorHtml({
        error: 'access_denied',
        errorDescription: 'Invalid TOTP code',
        status: 401,
        messages: config.translations,
        goBackHref: config.loginRedirectUrl || '/',
      });
    }

    // TOTP verified - generate authorization code
    const code = generateSecureRandomString(SECURITY_CONSTANTS.MIN_AUTH_CODE_LENGTH);
    const authCodeExpiration = config.authCodeExpiration ?? 600; // 10 minutes default

    const authCode: AuthorizationCode = {
      code,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod!,
      redirectUri: redirectUri!,
      clientId: clientId!,
      scope: scope,
      userId,
      expiresAt: Date.now() + authCodeExpiration * 1000,
    };

    await config.callbacks.storeAuthorizationCode(authCode);

    // Redirect back to client with authorization code
    const redirectUrl = new URL(redirectUri!);
    redirectUrl.searchParams.set('code', code);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl.toString() },
    });
  }

  // Regular login flow - validate email/password
  const emailRaw = formData.get('email')?.toString();
  const passwordRaw = formData.get('password')?.toString();

  // Validate and sanitize email
  const email = validateEmail(emailRaw);
  // Validate password length (don't sanitize - preserve exact input)
  const password = validateInputLength(passwordRaw, SECURITY_CONSTANTS.MAX_PASSWORD_LENGTH);

  if (!email || !password) {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Missing or invalid email/password',
      status: 400,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // Verify CAPTCHA if enabled
  if (config.captcha?.enabled) {
    const captchaToken = formData.get(config.captcha.responseFieldName)?.toString();
    if (!captchaToken) {
      await addTimingJitter();
      return oauthErrorHtml({
        error: 'invalid_request',
        errorDescription: 'CAPTCHA verification required',
        status: 400,
        messages: config.translations,
        goBackHref: config.loginRedirectUrl || '/',
      });
    }

    // Get client IP from request headers (common headers used by proxies/CDNs)
    const clientIp = request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
      || request.headers.get('X-Real-IP')
      || undefined;

    const captchaValid = await config.captcha.verify(captchaToken, clientIp);
    if (!captchaValid) {
      await addTimingJitter();
      return oauthErrorHtml({
        error: 'invalid_request',
        errorDescription: 'CAPTCHA verification failed',
        status: 400,
        messages: config.translations,
        goBackHref: config.loginRedirectUrl || '/',
      });
    }
  }

  // Get user by email - always perform password check to prevent user enumeration
  const user = await config.callbacks.getUserByEmail(email);

  // Always verify password (even with dummy hash) to prevent timing-based user enumeration
  const isValidPassword = await verifyPassword(
    password,
    user?.passwordHash ?? '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  );

  if (!user || !isValidPassword) {
    await addTimingJitter();
    return oauthErrorHtml({
      error: 'access_denied',
      errorDescription: 'Invalid email or password',
      status: 401,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  const userId = user.id || user.email;

  // Check if TOTP is required and user needs to set it up
  if (config.totp?.enabled && config.totp.required) {
    const hasTotp = await config.totp.callbacks.hasTotp(userId);
    if (!hasTotp) {
      // Redirect to TOTP setup page
      const setupUrl = new URL(TL.url`${config.basePath}/setup/totp`, url.origin);
      setupUrl.searchParams.set('redirect_uri', url.toString());
      setupUrl.searchParams.set('user_id', userId);
      // Store a setup session token
      const setupToken = generateSecureRandomString(SECURITY_CONSTANTS.MIN_SETUP_TOKEN_LENGTH);
      await config.totp.callbacks.storePendingTotpSession(setupToken, userId, Date.now() + 600000); // 10 min
      setupUrl.searchParams.set('setup_token', setupToken);
      return new Response(null, {
        status: 302,
        headers: { 'Location': setupUrl.toString() },
      });
    }
  }

  // Check if passkey is required and user needs to set it up
  if (config.passkey?.enabled && config.passkey.required) {
    const credentials = await config.passkey.callbacks.getCredentialsByUserId(userId);
    const hasPasskey = credentials.length > 0;
    if (!hasPasskey) {
      // Redirect to passkey setup page
      const setupUrl = new URL(TL.url`${config.basePath}/setup/passkey`, url.origin);
      setupUrl.searchParams.set('redirect_uri', url.toString());
      setupUrl.searchParams.set('user_id', userId);
      // Store a setup session token using passkey's own session callbacks
      const setupToken = generateSecureRandomString(SECURITY_CONSTANTS.MIN_SETUP_TOKEN_LENGTH);
      await config.passkey.callbacks.storePendingPasskeySetupSession(setupToken, userId, Date.now() + 600000); // 10 min
      setupUrl.searchParams.set('setup_token', setupToken);
      return new Response(null, {
        status: 302,
        headers: { 'Location': setupUrl.toString() },
      });
    }
  }

  // Check if TOTP verification is needed
  if (config.totp?.enabled) {
    const hasTotp = await config.totp.callbacks.hasTotp(userId);
    if (hasTotp) {
      // Need to show TOTP verification form
      // Create a pending TOTP session
      const sessionId = generateSecureRandomString(SECURITY_CONSTANTS.MIN_SESSION_ID_LENGTH);
      await config.totp.callbacks.storePendingTotpSession(sessionId, userId, Date.now() + 300000); // 5 min

      // Return TOTP verification page
      const totpPage = getTotpVerificationPage(url.toString(), sessionId, config.translations, config.customLogo);
      const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:";
      const csp = buildCspWithLogo(baseCsp, totpPage.imgSrc);

      return new Response(totpPage.html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': csp,
        },
      });
    }
  }

  // Generate authorization code with post-quantum secure length
  const code = generateSecureRandomString(SECURITY_CONSTANTS.MIN_AUTH_CODE_LENGTH);
  const authCodeExpiration = config.authCodeExpiration ?? 600; // 10 minutes default

  const authCode: AuthorizationCode = {
    code,
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    clientId,
    scope: scope,
    userId,
    expiresAt: Date.now() + authCodeExpiration * 1000,
  };

  await config.callbacks.storeAuthorizationCode(authCode);

  // Redirect back to client with authorization code
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }

  return new Response(null, {
    status: 302,
    headers: { 'Location': redirectUrl.toString() },
  });
}

// Helper function to create a new OAuth session with both tokens
// Uses post-quantum secure token lengths
async function createOAuthSession(
  config: OAuthConfig,
  userId: string,
  scope: string[],
): Promise<OAuthSession> {
  const sessionId = generateSecureRandomString(SECURITY_CONSTANTS.MIN_SESSION_ID_LENGTH);
  const accessToken = generateSecureRandomString(SECURITY_CONSTANTS.MIN_ACCESS_TOKEN_LENGTH);
  const refreshToken = generateSecureRandomString(SECURITY_CONSTANTS.MIN_REFRESH_TOKEN_LENGTH);
  const accessTokenExpiration = config.accessTokenExpiration ?? 3600; // 1 hour default
  const refreshTokenExpiration = config.refreshTokenExpiration ?? 2592000; // 30 days default
  const now = Date.now();

  const session: OAuthSession = {
    id: sessionId,
    accessToken,
    accessTokenExpiresAt: now + accessTokenExpiration * 1000,
    refreshToken,
    refreshTokenExpiresAt: now + refreshTokenExpiration * 1000,
    scope,
    userId,
    createdAt: now,
  };

  await config.callbacks.createSession(session);
  return session;
}

// Helper function to build token response
function buildTokenResponse(
  session: OAuthSession,
  accessTokenExpiration: number,
  refreshTokenExpiration: number,
): Response {
  return new Response(
    JSON.stringify({
      access_token: session.accessToken,
      token_type: 'Bearer',
      expires_in: accessTokenExpiration,
      refresh_token: session.refreshToken,
      refresh_token_expires_in: refreshTokenExpiration,
      scope: session.scope.join(' '),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    },
  );
}

// Handle OAuth token endpoint
// Security hardened with input validation and constant-time comparisons
export async function handleToken(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  if (request.method !== 'POST') {
    return oauthError('invalid_request', 'Method not allowed', undefined, 405);
  }

  const formData = await request.formData();

  // Validate and sanitize inputs
  const grantType = validateInputLength(formData.get('grant_type')?.toString(), 32);
  const clientId = validateInputLength(formData.get('client_id')?.toString(), 256);

  // Use constant-time comparison for client_id to prevent timing attacks
  if (!clientId || !(await constantTimeEqual(clientId, config.clientId))) {
    await addTimingJitter();
    return oauthError('invalid_client', 'Invalid or missing client_id', undefined, 401);
  }

  // Handle different grant types
  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(config, formData);
  } else if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(config, formData);
  } else {
    await addTimingJitter();
    return oauthError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token');
  }
}

// Handle authorization_code grant type
// Security hardened with input validation and constant-time comparisons
async function handleAuthorizationCodeGrant(
  config: OAuthConfig,
  formData: FormData,
): Promise<Response> {
  // Validate and sanitize all inputs
  const code = validateInputLength(formData.get('code')?.toString(), SECURITY_CONSTANTS.MAX_TOKEN_LENGTH);
  const redirectUri = validateUri(formData.get('redirect_uri')?.toString());
  const codeVerifier = validateInputLength(formData.get('code_verifier')?.toString(), 128);
  const clientId = validateInputLength(formData.get('client_id')?.toString(), 256);

  // Validate required parameters
  if (!code) {
    await addTimingJitter();
    return oauthError('invalid_request', 'Missing or invalid code');
  }

  if (!redirectUri) {
    await addTimingJitter();
    return oauthError('invalid_request', 'Missing or invalid redirect_uri');
  }

  if (!codeVerifier || codeVerifier.length < 43) {
    await addTimingJitter();
    return oauthError('invalid_request', 'Missing or invalid code_verifier (PKCE required)');
  }

  // Retrieve authorization code
  const authCode = await config.callbacks.getAuthorizationCode(code);
  if (!authCode) {
    await addTimingJitter();
    return oauthError('invalid_grant', 'Invalid or expired authorization code');
  }

  // Validate authorization code expiration
  if (authCode.expiresAt < Date.now()) {
    await config.callbacks.deleteAuthorizationCode(code);
    await addTimingJitter();
    return oauthError('invalid_grant', 'Authorization code has expired');
  }

  // Use constant-time comparison for redirect_uri to prevent timing attacks
  if (!(await constantTimeEqual(authCode.redirectUri, redirectUri))) {
    await addTimingJitter();
    return oauthError('invalid_grant', 'redirect_uri does not match');
  }

  // Use constant-time comparison for client_id
  if (!clientId || !(await constantTimeEqual(authCode.clientId, clientId))) {
    await addTimingJitter();
    return oauthError('invalid_grant', 'client_id does not match');
  }

  if (authCode.codeChallengeMethod !== 'S256') {
    await addTimingJitter();
    return oauthError('invalid_grant', 'Unsupported code_challenge_method');
  }

  // Verify PKCE code challenge (already uses constant-time comparison internally)
  const isValid = await verifyCodeChallenge(
    codeVerifier,
    authCode.codeChallenge,
    authCode.codeChallengeMethod,
  );

  if (!isValid) {
    await config.callbacks.deleteAuthorizationCode(code);
    await addTimingJitter();
    return oauthError('invalid_grant', 'Invalid code_verifier');
  }

  // Delete authorization code (one-time use)
  await config.callbacks.deleteAuthorizationCode(code);

  // Create new OAuth session with both access and refresh tokens
  const session = await createOAuthSession(config, authCode.userId, authCode.scope);

  const accessTokenExpiration = config.accessTokenExpiration ?? 3600;
  const refreshTokenExpiration = config.refreshTokenExpiration ?? 2592000;

  return buildTokenResponse(session, accessTokenExpiration, refreshTokenExpiration);
}

// Handle refresh_token grant type
// Security hardened with input validation
async function handleRefreshTokenGrant(
  config: OAuthConfig,
  formData: FormData,
): Promise<Response> {
  // Validate refresh token input
  const refreshToken = validateInputLength(
    formData.get('refresh_token')?.toString(),
    SECURITY_CONSTANTS.MAX_TOKEN_LENGTH,
  );

  if (!refreshToken) {
    await addTimingJitter();
    return oauthError('invalid_request', 'Missing or invalid refresh_token');
  }

  // Get the existing session by refresh token
  const existingSession = await config.callbacks.getSessionByRefreshToken(refreshToken);
  if (!existingSession) {
    await addTimingJitter();
    return oauthError('invalid_grant', 'Invalid refresh token');
  }

  // Check if refresh token has expired
  if (existingSession.refreshTokenExpiresAt < Date.now()) {
    // Logout from the expired session
    await config.callbacks.logoutSession(existingSession.id);
    await addTimingJitter();
    return oauthError('invalid_grant', 'Refresh token has expired');
  }

  // Logout from the old session (this removes both old access and refresh tokens)
  await config.callbacks.logoutSession(existingSession.id);

  // Create a new session with fresh tokens
  const newSession = await createOAuthSession(
    config,
    existingSession.userId,
    existingSession.scope,
  );

  const accessTokenExpiration = config.accessTokenExpiration ?? 3600;
  const refreshTokenExpiration = config.refreshTokenExpiration ?? 2592000;
  return buildTokenResponse(newSession, accessTokenExpiration, refreshTokenExpiration);
}

export interface DecapOauth2 {
  fetch(request: Request): Promise<Response>;
}

export function decapOauth2(
  options: OAuthConfig,
): DecapOauth2 {
  const authorizeEndpoint = TL.url`${options.basePath}/authorize`;
  const tokenEndpoint = TL.url`${options.basePath}/token`;
  const totpSetupEndpoint = TL.url`${options.basePath}/setup/totp`;
  const totpSetupVerifyEndpoint = TL.url`${options.basePath}/setup/totp/verify`;
  const passkeySetupEndpoint = TL.url`${options.basePath}/setup/passkey`;
  const passkeyRegisterEndpoint = TL.url`${options.basePath}/setup/passkey/register`;
  const passkeyAuthenticateVerifyEndpoint = TL.url`${options.basePath}/passkey/authenticate/verify`;
  const forgotPasswordEndpoint = TL.url`${options.basePath}/forgot-password`;
  const resetPasswordEndpoint = TL.url`${options.basePath}/reset-password`;
  const logoutEndpoint = TL.url`${options.basePath}/logout`;
  const logoutAllEndpoint = TL.url`${options.basePath}/logout-all`;

  const config = options;

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = Url.normalize(url.pathname);

      if (pathname === authorizeEndpoint) {
        return handleAuthorize(request, options);
      }

      // Route: /oauth2/token
      if (pathname === tokenEndpoint) {
        return handleToken(request, config);
      }

      // Route: /oauth2/setup/totp (GET - show setup page)
      if (pathname === totpSetupEndpoint && request.method === 'GET') {
        return handleTotpSetupPage(request, config);
      }

      // Route: /oauth2/setup/totp/verify (POST - verify TOTP setup)
      if (pathname === totpSetupVerifyEndpoint && request.method === 'POST') {
        return handleTotpSetupVerify(request, config);
      }

      // Route: /oauth2/setup/passkey (GET - show setup page)
      if (pathname === passkeySetupEndpoint && request.method === 'GET') {
        return handlePasskeySetupPage(request, config);
      }

      // Route: /oauth2/setup/passkey/register (POST - register passkey)
      if (pathname === passkeyRegisterEndpoint && request.method === 'POST') {
        return handlePasskeyRegister(request, config);
      }

      // Route: /oauth2/passkey/authenticate/verify (POST - verify passkey authentication)
      if (pathname === passkeyAuthenticateVerifyEndpoint && request.method === 'POST') {
        return handlePasskeyAuthenticateVerify(request, config);
      }

      // Route: /oauth2/forgot-password (GET - show forgot password page, POST - request reset)
      if (pathname === forgotPasswordEndpoint) {
        return handleForgotPassword(request, config);
      }

      // Route: /oauth2/reset-password (GET - show reset password page, POST - reset password)
      if (pathname === resetPasswordEndpoint) {
        return handleResetPassword(request, config);
      }

      // Route: /oauth2/logout (GET - logout from current session)
      if (pathname === logoutEndpoint) {
        return handleLogout(request, config);
      }

      // Route: /oauth2/logout-all (GET - logout from all sessions)
      if (pathname === logoutAllEndpoint) {
        return handleLogoutAll(request, config);
      }

      // Unknown OAuth2 route
      return oauthError('invalid_request', `Unknown OAuth2 endpoint: ${pathname}`, undefined, 404);
    },
  };
}

/**
 * Handle TOTP setup page (GET /oauth2/setup/totp)
 */
async function handleTotpSetupPage(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri');

  if (!redirectUri) {
    return oauthError('invalid_request', 'Missing redirect_uri parameter');
  }

  if (!config.totp?.enabled) {
    return oauthError('invalid_request', 'TOTP is not enabled');
  }

  // Get the setup token from the URL (passed from authorize endpoint)
  const setupToken = url.searchParams.get('setup_token');
  if (!setupToken) {
    return oauthError('invalid_request', 'Missing setup_token parameter');
  }

  // Verify the setup token and get the pending session
  const pendingSession = await config.totp.callbacks.getPendingTotpSession(setupToken);
  if (!pendingSession) {
    return oauthError('access_denied', 'Invalid or expired setup token', undefined, 401);
  }

  // Get the user
  const user = await config.callbacks.getUserById(pendingSession.userId);
  if (!user) {
    return oauthError('access_denied', 'User not found', undefined, 401);
  }

  // Generate TOTP secret and QR code using setupOAuthTOTP
  const issuer = config.totp.issuer || 'Decap CMS';
  const setupData = await setupOAuthTOTP(pendingSession.userId, user.email, {
    enabled: true,
    issuer,
    callbacks: config.totp.callbacks,
  });

  // Import and render the TOTP setup page
  const html = renderTotpSetupPage({
    baseUrl: url.origin + (config.basePath || ''),
    qrCodeDataUrl: setupData.qrCode,
    secret: setupData.secret,
    issuer,
    email: user.email,
    setupToken,
    redirectUri,
    messages: config.translations,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:",
    },
  });
}

/**
 * Handle TOTP setup verification (POST /oauth2/setup/totp/verify)
 */
async function handleTotpSetupVerify(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const formData = await request.formData();

  const setupToken = formData.get('setup_token')?.toString();
  const totpCode = formData.get('totp_code')?.toString();

  if (!setupToken || !totpCode) {
    return oauthError('invalid_request', 'Missing setup_token or totp_code');
  }

  if (!config.totp?.enabled) {
    return oauthError('invalid_request', 'TOTP is not enabled');
  }

  // Verify the setup token
  const pendingSession = await config.totp.callbacks.getPendingTotpSession(setupToken);
  if (!pendingSession) {
    return oauthError('access_denied', 'Invalid or expired setup token', undefined, 401);
  }

  // Get the stored secret
  const secret = await config.totp.callbacks.getTotpSecret(pendingSession.userId);
  if (!secret) {
    return oauthError('access_denied', 'TOTP secret not found', undefined, 401);
  }

  // Verify the TOTP code
  const result = await verifyOAuthTOTPSetup(pendingSession.userId, totpCode, {
    enabled: true,
    issuer: config.totp.issuer || 'Decap CMS',
    callbacks: config.totp.callbacks,
  });
  const isValid = result.success;

  if (!isValid) {
    await addTimingJitter();
    return oauthError('access_denied', 'Invalid TOTP code', undefined, 401);
  }

  // TOTP is now verified - redirect back to the authorize endpoint
  // The redirect_uri should be in the original setup URL
  const redirectUri = url.searchParams.get('redirect_uri') || formData.get('redirect_uri')?.toString();

  if (redirectUri) {
    // Parse the redirect URI and add the totp_session parameter
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('totp_session', setupToken);

    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl.toString(),
      },
    });
  }

  // If no redirect_uri, show success message
  return new Response('TOTP setup complete. You can close this window.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * Handle passkey setup page (GET /oauth2/setup/passkey)
 */
async function handlePasskeySetupPage(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri');

  if (!redirectUri) {
    return oauthError('invalid_request', 'Missing redirect_uri parameter');
  }

  if (!config.passkey?.enabled) {
    return oauthError('invalid_request', 'Passkey is not enabled');
  }

  // Get the setup token from the URL
  const setupToken = url.searchParams.get('setup_token');
  if (!setupToken) {
    return oauthError('invalid_request', 'Missing setup_token parameter');
  }

  // Verify the setup token using passkey's own session callbacks
  const pendingSession = await config.passkey.callbacks.getPendingPasskeySetupSession(setupToken);
  if (!pendingSession) {
    return oauthError('access_denied', 'Invalid or expired setup token', undefined, 401);
  }

  // Get the user
  const user = await config.callbacks.getUserById(pendingSession.userId);
  if (!user) {
    return oauthError('access_denied', 'User not found', undefined, 401);
  }

  // Generate registration options
  const registrationOptions = await generateRegistrationOptions(pendingSession.userId, config.passkey);

  // Import and render the passkey setup page
  const html = renderPasskeySetupPage({
    baseUrl: url.origin + (config.basePath || ''),
    registrationOptions: registrationOptions.publicKey,
    setupToken,
    redirectUri,
    userId: pendingSession.userId,
    messages: config.translations,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    },
  });
}

/**
 * Handle passkey registration (POST /oauth2/setup/passkey/register)
 */
async function handlePasskeyRegister(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  if (!config.passkey?.enabled) {
    return new Response(JSON.stringify({ error: 'Passkey is not enabled' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as {
      setup_token: string,
      credential: {
        id: string,
        rawId: string,
        response: {
          clientDataJSON: string,
          attestationObject: string,
        },
        type: string,
      },
    };

    const { setup_token, credential } = body;

    if (!setup_token || !credential) {
      return new Response(JSON.stringify({ error: 'Missing setup_token or credential' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify the setup token using passkey's own session callbacks
    const pendingSession = await config.passkey.callbacks.getPendingPasskeySetupSession(setup_token);
    if (!pendingSession) {
      return new Response(JSON.stringify({ error: 'Invalid or expired setup token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify and store the credential
    // Cast credential to the expected type
    const registrationCredential = {
      ...credential,
      type: 'public-key' as const,
    };
    const verification = await verifyRegistration(registrationCredential, config.passkey);

    if (!verification.success) {
      return new Response(JSON.stringify({ error: verification.error || 'Credential verification failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    config.logger?.error('Passkey registration error:', error);
    return new Response(JSON.stringify({ error: 'Registration failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle passkey authentication verification (POST /oauth2/passkey/authenticate/verify)
 */
async function handlePasskeyAuthenticateVerify(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  if (!config.passkey?.enabled) {
    return new Response(JSON.stringify({ error: 'Passkey is not enabled' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    // The client sends the credential data directly at the root level, not nested under 'credential'
    const credential = await request.json() as {
      id: string,
      rawId: string,
      response: {
        clientDataJSON: string,
        authenticatorData: string,
        signature: string,
        userHandle?: string,
      },
      type: string,
    };

    if (!credential || !credential.id || !credential.response) {
      return new Response(JSON.stringify({ error: 'Missing credential' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify the authentication response
    // Cast credential to the expected type
    const authCredential = {
      ...credential,
      type: 'public-key' as const,
    };
    const verification = await verifyAuthentication(authCredential, config.passkey);

    if (!verification.success || !verification.userId) {
      return new Response(JSON.stringify({ error: verification.error || 'Authentication failed' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if user has TOTP enabled
    if (config.totp?.enabled) {
      const hasTotp = await config.totp.callbacks.hasTotp(verification.userId);
      if (hasTotp) {
        // Create a pending TOTP session
        const totpSessionId = generateSecureRandomString(SECURITY_CONSTANTS.MIN_SESSION_ID_LENGTH);
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
        await config.totp.callbacks.storePendingTotpSession(totpSessionId, verification.userId, expiresAt);

        // Return the TOTP session ID - client will redirect to TOTP verification
        // Build the authorize URL for TOTP verification redirect
        const authorizeUrl = TL.url`${url.origin}${config.basePath}/authorize` + url.search;

        return new Response(
          JSON.stringify({
            success: true,
            requires_totp: true,
            totp_session: totpSessionId,
            authorize_url: authorizeUrl,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }
    const params = url.searchParams;

    const clientId = validateInputLength(params.get('client_id'), 256);
    const redirectUri = validateUri(params.get('redirect_uri'));
    const codeChallenge = validateInputLength(params.get('code_challenge'), 128);
    const codeChallengeMethod = validateInputLength(params.get('code_challenge_method'), 16) as 'S256' | null;
    const scopeRaw = validateInputLength(params.get('scope'), SECURITY_CONSTANTS.MAX_SCOPE_LENGTH);
    const scope = scopeRaw?.split(' ').filter(s => s.length > 0 && s.length <= 64) || [];
    const state = validateInputLength(params.get('state'), 256);

    if (!redirectUri || !codeChallenge) {
      return new Response(JSON.stringify({ error: 'Missing OAuth parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate authorization code
    const code = generateSecureRandomString(SECURITY_CONSTANTS.MIN_AUTH_CODE_LENGTH);
    const codeExpiration = config.authCodeExpiration ?? 600;

    await config.callbacks.storeAuthorizationCode({
      code,
      userId: verification.userId,
      clientId: clientId || config.clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: (codeChallengeMethod as 'S256') || 'S256',
      scope,
      expiresAt: Date.now() + codeExpiration * 1000,
    });

    // Build redirect URL with code
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    return new Response(
      JSON.stringify({
        success: true,
        redirect_uri: redirectUrl.toString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    config.logger?.error('Passkey authentication error:', error);
    return new Response(JSON.stringify({ error: 'Authentication failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle forgot password page and request (GET/POST /oauth2/forgot-password)
 */
async function handleForgotPassword(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  if (!config.passwordReset) {
    return oauthError('invalid_request', 'Password reset is not enabled', undefined, 404);
  }

  const url = new URL(request.url);

  // Get CAPTCHA config if enabled
  const captchaWidget = config.captcha?.enabled ? config.captcha.widgetHtml : undefined;
  const captchaScript = config.captcha?.enabled ? config.captcha.scriptHtml : undefined;

  // Base CSP for password reset pages
  const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";

  // GET - show forgot password page
  if (request.method === 'GET') {
    const page = renderForgotPasswordPage({
      baseUrl: url.origin + (config.basePath || ''),
      customLogo: config.customLogo,
      loginUrl: config.loginRedirectUrl,
      captchaWidget,
      captchaScript,
      messages: config.translations,
    });
    const csp = buildCspWithLogo(baseCsp, page.imgSrc);

    return new Response(page.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': csp,
      },
    });
  }

  // POST - request password reset
  if (request.method === 'POST') {
    const formData = await request.formData();
    const email = formData.get('email')?.toString();

    if (!email) {
      const page = renderForgotPasswordPage({
        baseUrl: url.origin + (config.basePath || ''),
        error: 'Please enter your email address',
        customLogo: config.customLogo,
        loginUrl: config.loginRedirectUrl,
        captchaWidget,
        captchaScript,
        messages: config.translations,
      });
      const csp = buildCspWithLogo(baseCsp, page.imgSrc);

      return new Response(page.html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': csp,
        },
      });
    }

    // Verify CAPTCHA if enabled
    if (config.captcha?.enabled) {
      const captchaToken = formData.get(config.captcha.responseFieldName)?.toString();
      if (!captchaToken) {
        const page = renderForgotPasswordPage({
          baseUrl: url.origin + (config.basePath || ''),
          error: 'CAPTCHA verification required',
          customLogo: config.customLogo,
          loginUrl: config.loginRedirectUrl,
          captchaWidget,
          captchaScript,
          messages: config.translations,
        });
        const csp = buildCspWithLogo(baseCsp, page.imgSrc);

        return new Response(page.html, {
          status: 400,
          headers: {
            'Content-Type': 'text/html',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': csp,
          },
        });
      }

      // Get client IP from request headers
      const clientIp = request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
        || request.headers.get('X-Real-IP')
        || undefined;

      const captchaValid = await config.captcha.verify(captchaToken, clientIp);
      if (!captchaValid) {
        const page = renderForgotPasswordPage({
          baseUrl: url.origin + (config.basePath || ''),
          error: 'CAPTCHA verification failed',
          customLogo: config.customLogo,
          loginUrl: config.loginRedirectUrl,
          captchaWidget,
          captchaScript,
          messages: config.translations,
        });
        const csp = buildCspWithLogo(baseCsp, page.imgSrc);

        return new Response(page.html, {
          status: 400,
          headers: {
            'Content-Type': 'text/html',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': csp,
          },
        });
      }
    }

    const resetBaseUrl = TL.url`${url.origin}/${config.basePath}/reset-password`;

    const user = await config.callbacks.getUserByEmail(email);

    if (user) {
      try {
        await requestPasswordReset(user, {
          ...config.passwordReset,
          resetBaseUrl,
        });
      } catch (err) {
        // Log error but don't expose it to prevent email enumeration
        config.logger?.error('Password reset request error:', err);
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
    }

    // Always show success message to prevent email enumeration
    const successPage = renderForgotPasswordSuccessPage({
      baseUrl: url.origin + (config.basePath || ''),
      customLogo: config.customLogo,
      loginUrl: config.loginRedirectUrl,
      messages: config.translations,
    });
    const successCsp = buildCspWithLogo(baseCsp, successPage.imgSrc);

    return new Response(successPage.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': successCsp,
      },
    });
  }

  return oauthError('invalid_request', 'Method not allowed', undefined, 405);
}

/**
 * Handle reset password page and action (GET/POST /oauth2/reset-password)
 */
async function handleResetPassword(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  if (!config.passwordReset) {
    return oauthError('invalid_request', 'Password reset is not enabled', undefined, 404);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  // Base CSP for reset password pages
  const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";

  // GET - show reset password page
  if (request.method === 'GET') {
    if (!token) {
      return oauthError('invalid_request', 'Missing reset token');
    }

    // Verify token exists and is not expired
    const resetToken = await config.passwordReset.callbacks.getResetToken(token);
    if (!resetToken || resetToken.expiresAt < Date.now()) {
      const page = renderResetPasswordPage({
        baseUrl: url.origin + (config.basePath || ''),
        token,
        error: 'This reset link has expired or is invalid. Please request a new one.',
        customLogo: config.customLogo,
        messages: config.translations,
      });
      const csp = buildCspWithLogo(baseCsp, page.imgSrc);

      return new Response(page.html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': csp,
        },
      });
    }

    const page = renderResetPasswordPage({
      baseUrl: url.origin + (config.basePath || ''),
      token,
      customLogo: config.customLogo,
      messages: config.translations,
    });
    const csp = buildCspWithLogo(baseCsp, page.imgSrc);

    return new Response(page.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': csp,
      },
    });
  }

  // POST - reset password
  if (request.method === 'POST') {
    const formData = await request.formData();
    const formToken = formData.get('token')?.toString();
    const newPassword = formData.get('password')?.toString();
    const confirmPassword = formData.get('confirm_password')?.toString();

    if (!formToken) {
      return oauthError('invalid_request', 'Missing reset token');
    }

    if (!newPassword || newPassword.length < 8) {
      const page = renderResetPasswordPage({
        baseUrl: url.origin + (config.basePath || ''),
        token: formToken,
        error: 'Password must be at least 8 characters',
        customLogo: config.customLogo,
        messages: config.translations,
      });
      const csp = buildCspWithLogo(baseCsp, page.imgSrc);

      return new Response(page.html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': csp,
        },
      });
    }

    if (newPassword !== confirmPassword) {
      const page = renderResetPasswordPage({
        baseUrl: url.origin + (config.basePath || ''),
        token: formToken,
        error: 'Passwords do not match',
        customLogo: config.customLogo,
        messages: config.translations,
      });
      const csp = buildCspWithLogo(baseCsp, page.imgSrc);

      return new Response(page.html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': csp,
        },
      });
    }

    const result = await resetPassword(formToken, newPassword, config.passwordReset);

    if (!result.success) {
      const page = renderResetPasswordPage({
        baseUrl: url.origin + (config.basePath || ''),
        token: formToken,
        error: result.error || 'Failed to reset password',
        customLogo: config.customLogo,
        messages: config.translations,
      });
      const csp = buildCspWithLogo(baseCsp, page.imgSrc);

      return new Response(page.html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': csp,
        },
      });
    }

    // Success - show success page
    const successPage = renderResetPasswordSuccessPage({
      baseUrl: url.origin + (config.basePath || ''),
      customLogo: config.customLogo,
      loginUrl: config.loginRedirectUrl,
      messages: config.translations,
    });
    const successCsp = buildCspWithLogo(baseCsp, successPage.imgSrc);

    return new Response(successPage.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': successCsp,
      },
    });
  }

  return oauthError('invalid_request', 'Method not allowed', undefined, 405);
}

/**
 * Handle logout from a single session (GET /oauth2/logout)
 *
 * Requires a valid access token in the query parameter.
 * Invalidates the current session only and returns an HTML success page.
 *
 * @param request - The incoming request
 * @param config - OAuth configuration
 * @returns HTML response showing logout success
 */
export async function handleLogout(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  const url = new URL(request.url);

  // Only allow GET requests
  if (request.method !== 'GET') {
    return oauthError('invalid_request', 'Method not allowed', undefined, 405);
  }

  // Extract access token from query parameter
  const accessToken = validateInputLength(url.searchParams.get('access_token'), SECURITY_CONSTANTS.MAX_TOKEN_LENGTH);
  if (!accessToken) {
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Missing or invalid access_token parameter',
      status: 401,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // Add timing jitter to prevent timing attacks
  await addTimingJitter(SECURITY_CONSTANTS.TIMING_JITTER_MS);

  // Get the session by access token
  const session = await config.callbacks.getSessionByAccessToken(accessToken);
  if (!session) {
    return oauthErrorHtml({
      error: 'invalid_token',
      errorDescription: 'Invalid or expired access token',
      status: 401,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // Logout the session
  await config.callbacks.logoutSession(session.id);

  config.logger?.info('User logged out from session', { userId: session.userId, sessionId: session.id });

  // Render logout success page with custom logo support
  const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";
  const page = renderLogoutSuccessPage({
    customLogo: config.customLogo,
    loginUrl: config.loginRedirectUrl,
    messages: config.translations,
  });
  const csp = buildCspWithLogo(baseCsp, page.imgSrc);

  // Return HTML success page
  return new Response(page.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
    },
  });
}

/**
 * Handle logout from all sessions (GET /oauth2/logout/all)
 *
 * Requires a valid access token in the query parameter.
 * Invalidates all sessions for the user (logout everywhere) and returns an HTML success page.
 *
 * @param request - The incoming request
 * @param config - OAuth configuration
 * @returns HTML response showing logout success
 */
export async function handleLogoutAll(
  request: Request,
  config: OAuthConfig,
): Promise<Response> {
  const url = new URL(request.url);

  // Only allow GET requests
  if (request.method !== 'GET') {
    return oauthError('invalid_request', 'Method not allowed', undefined, 405);
  }

  // Extract access token from query parameter
  const accessToken = validateInputLength(url.searchParams.get('access_token'), SECURITY_CONSTANTS.MAX_TOKEN_LENGTH);
  if (!accessToken) {
    return oauthErrorHtml({
      error: 'invalid_request',
      errorDescription: 'Missing or invalid access_token parameter',
      status: 401,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // Add timing jitter to prevent timing attacks
  await addTimingJitter(SECURITY_CONSTANTS.TIMING_JITTER_MS);

  // Get the session by access token to find the user
  const session = await config.callbacks.getSessionByAccessToken(accessToken);
  if (!session) {
    return oauthErrorHtml({
      error: 'invalid_token',
      errorDescription: 'Invalid or expired access token',
      status: 401,
      messages: config.translations,
      goBackHref: config.loginRedirectUrl || '/',
    });
  }

  // Logout all sessions for the user
  await config.callbacks.logoutAll(session.userId);

  config.logger?.info('User logged out from all sessions', { userId: session.userId });

  // Render logout all success page with custom logo support
  const baseCsp = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";
  const page = renderLogoutAllSuccessPage({
    customLogo: config.customLogo,
    loginUrl: config.loginRedirectUrl,
    messages: config.translations,
  });
  const csp = buildCspWithLogo(baseCsp, page.imgSrc);

  // Return HTML success page
  return new Response(page.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
    },
  });
}
