/**
 * OAuth 2.0 PKCE Authentication Module
 *
 * Provides secure OAuth 2.0 authentication with PKCE support for Decap CMS.
 * Security hardened for post-quantum computing resistance.
 *
 * @module @laikacms/decap-api/oauth2
 */

// OAuth 2.0 PKCE
export * from './oauth2.js';

// HTML Templates (login page with passkey and TOTP support)
export * from './templates/index.js';

// TOTP 2FA
export * from './totp/index.js';

// Passkey (WebAuthn)
export * from './passkey/index.js';

// QR Code generation
export * from './qrcode/index.js';

// Email templates
export * from './email/index.js';

// Internationalization (i18n)
export * from './i18n/index.js';
