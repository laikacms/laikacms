# @laikacms/decap/decap-oauth2

[![npm](https://img.shields.io/npm/v/@laikacms/decap)](https://www.npmjs.com/package/@laikacms/decap)
[![npm](https://img.shields.io/npm/dm/@laikacms/decap)](https://www.npmjs.com/package/@laikacms/decap)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/decap)](https://bundlephobia.com/result?p=@laikacms/decap)

OAuth2 authentication server for Decap CMS with PKCE support.

## Features

- OAuth2 with PKCE (Proof Key for Code Exchange)
- Self-contained authorization server (email + password login, passkey/WebAuthn, TOTP 2FA)
- Quantum-safe cryptographic considerations
- Cloudflare Workers compatible

## Installation

```bash
pnpm add @laikacms/decap
```

## Usage

```typescript
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';

const oauth2 = decapOauth2({
  basePath: '/oauth2',
  clientId: process.env.DECAP_CLIENT_ID!,
  callbacks: {
    getUserByEmail: async email => {/* return User | null */},
    getUserById: async id => {/* return User | null */},
    storeAuthorizationCode: async code => {/* persist */},
    getAuthorizationCode: async code => {/* return AuthorizationCode | null */},
    deleteAuthorizationCode: async code => {/* delete */},
    createSession: async session => {/* persist */},
    getSessionByAccessToken: async token => {/* return OAuthSession | null */},
    getSessionByRefreshToken: async token => {/* return OAuthSession | null */},
    logoutSession: async sessionId => {/* delete session */},
    logoutAll: async userId => {/* delete all sessions for user */},
  },
});

export default { fetch: oauth2.fetch.bind(oauth2) };
```

## Optional features

All optional features are enabled by adding the corresponding key to your `OAuthConfig`. None are
required for basic email/password login.

### Passkey (WebAuthn)

Adds passwordless FIDO2/WebAuthn login. Users can register a passkey after first signing in with
their password and may optionally be required to do so.

```typescript
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';

const oauth2 = decapOauth2({
  // ... required options
  passkey: {
    /** Enable passkey authentication */
    enabled: true,
    /** Force passkey enrollment on next login (optional, default: false) */
    required: false,

    // PasskeyConfig fields:
    /** Relying Party ID — usually the bare domain, e.g. 'example.com' */
    rpId: 'example.com',
    /** Human-readable name displayed in the browser passkey UI */
    rpName: 'My CMS',
    /** Full origin, e.g. 'https://example.com' */
    origin: 'https://example.com',
    /** Challenge TTL in seconds (default: 300) */
    challengeExpiration: 300,
    /** Require PIN or biometric (default: 'required') */
    userVerification: 'required',
    /** 'platform' (built-in), 'cross-platform' (security key), or omit for both */
    authenticatorAttachment: 'platform',
    /** Resident/discoverable key preference (default: 'preferred') */
    residentKey: 'preferred',

    callbacks: {
      storeCredential(credential): Promise<void> {/* persist StoredCredential */},
      getCredentialById(credentialId): Promise<StoredCredential | null> {/* ... */},
      getCredentialsByUserId(userId): Promise<StoredCredential[]> {/* ... */},
      updateCredential(credentialId, updates): Promise<void> {/* ... */},
      deleteCredential(credentialId): Promise<void> {/* ... */},
      storeChallenge(challenge): Promise<void> {/* persist StoredChallenge */},
      consumeChallenge(challenge): Promise<StoredChallenge | null> {/* get + delete */},
      getUserById(userId): Promise<{ id: string, email: string, name?: string } | null> {/* ... */},
      getUserByEmail(email): Promise<{ id: string, email: string, name?: string } | null> {
        /* ... */
      },
      storePendingPasskeySetupSession(sessionId, userId, expiresAt): Promise<void> {/* ... */},
      getPendingPasskeySetupSession(sessionId): Promise<{ userId: string } | null> {/* ... */},
    },
  },
});
```

`StoredCredential` and `StoredChallenge` are exported from `@laikacms/decap/decap-oauth2`.

### TOTP 2FA

Adds time-based one-time password (RFC 6238) second factor, compatible with Google Authenticator,
Authy, and any standard TOTP app.

```typescript
const oauth2 = decapOauth2({
  // ... required options
  totp: {
    /** Enable TOTP 2FA */
    enabled: true,
    /** Force TOTP enrollment on next login (optional, default: false) */
    required: false,
    /** Issuer name shown in authenticator apps */
    issuer: 'My CMS',
    /** Time-step tolerance for clock drift (default: 1) */
    window: 1,

    callbacks: {
      hasTotp(userId): Promise<boolean> {/* ... */},
      getTotpSecret(userId): Promise<string | null> {/* base32 secret or null */},
      storeTotpSecret(userId, secret): Promise<void> {/* ... */},
      storePendingTotpSession(sessionId, userId, expiresAt): Promise<void> {/* ... */},
      getPendingTotpSession(sessionId): Promise<{ userId: string } | null> {/* ... */},
      // Optional — omitting relies on natural TTL expiry:
      deletePendingTotpSession(sessionId): Promise<void> {/* ... */},
      // Optional — omitting disables per-step replay protection:
      getLastTotpStep(userId): Promise<number | null> {/* ... */},
      setLastTotpStep(userId, step): Promise<void> {/* ... */},
    },
  },
});
```

### Password reset

Adds a "Forgot password?" link to the login page and a full email-based reset flow.

```typescript
const oauth2 = decapOauth2({
  // ... required options
  passwordReset: {
    /** Email provider (see EmailProvider interface) */
    emailProvider: myEmailProvider,
    /** Sender address */
    fromEmail: 'noreply@example.com',
    /** Application name used in email templates */
    appName: 'My CMS',
    /** Support email shown in templates (optional) */
    supportEmail: 'support@example.com',
    /**
     * Base URL for reset links.
     * Defaults to /reset-password under basePath if omitted.
     */
    resetBaseUrl: 'https://example.com/reset-password',
    /** Token TTL in seconds (default: 3600 = 1 hour) */
    tokenExpiration: 3600,
    /** Override the HTML reset-email renderer (optional) */
    renderHtml: vars => myTemplate(vars),
    /** Override the plain-text reset-email renderer (optional) */
    renderText: vars => myTextTemplate(vars),

    callbacks: {
      storeResetToken(token): Promise<void> {/* persist PasswordResetToken */},
      getResetToken(token): Promise<PasswordResetToken | null> {/* ... */},
      deleteResetToken(token): Promise<void> {/* ... */},
      updateUserPassword(userId, passwordHash): Promise<void> {/* ... */},
    },
  },
});
```

`EmailProvider` and `PasswordResetToken` are exported from `@laikacms/decap/decap-oauth2`.

#### EmailProvider interface

Implement `EmailProvider` to connect any email service (MailChannels, Nodemailer, Resend, etc.):

```typescript
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
```

### CAPTCHA

Adds CAPTCHA verification to the login and forgot-password forms. Any provider that renders a widget
via HTML and exposes a form field token is supported (reCAPTCHA v2, hCaptcha, Cloudflare Turnstile,
etc.).

```typescript
const oauth2 = decapOauth2({
  // ... required options
  captcha: {
    /** Enable CAPTCHA on login and forgot-password forms */
    enabled: true,
    /**
     * HTML for the CAPTCHA widget, inserted before the submit button.
     * Examples:
     *   reCAPTCHA v2: '<div class="g-recaptcha" data-sitekey="SITE_KEY"></div>'
     *   hCaptcha:     '<div class="h-captcha"   data-sitekey="SITE_KEY"></div>'
     *   Turnstile:    '<div class="cf-turnstile" data-sitekey="SITE_KEY"></div>'
     */
    widgetHtml: '<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>',
    /**
     * Script tag(s) to load the CAPTCHA library, inserted in <head>.
     * Example: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
     */
    scriptHtml:
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>',
    /**
     * Form field name containing the token.
     * Default field names: reCAPTCHA → 'g-recaptcha-response', hCaptcha → 'h-captcha-response',
     * Turnstile → 'cf-turnstile-response'
     */
    responseFieldName: 'cf-turnstile-response',
    /**
     * Server-side token verification callback.
     * @param token   The CAPTCHA response token from the form
     * @param remoteIp  The client IP address (optional)
     */
    async verify(token, remoteIp) {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.TURNSTILE_SECRET_KEY!,
          response: token,
          remoteip: remoteIp ?? '',
        }),
      });
      const result = await res.json() as { success: boolean };
      return result.success;
    },
  },
});
```

### Translations / i18n

All user-facing strings can be localized via the `translations` field. The package ships English
(`en`) and Dutch (`nl`) out of the box; import them from the `@laikacms/decap/decap-oauth2/i18n`
subpath.

```typescript
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';
import { nl } from '@laikacms/decap/decap-oauth2/i18n';

const oauth2 = decapOauth2({
  // ... required options
  translations: nl,
});
```

To provide fully custom translations, implement the `OAuthMessages` (alias of `Translation`) type:

```typescript
import type { OAuthMessages } from '@laikacms/decap/decap-oauth2';

const myTranslations: OAuthMessages = {
  auth: {/* login/logout strings */},
  totp: {/* TOTP setup/verification strings */},
  passkey: {/* passkey registration/authentication strings */},
  passwordReset: {/* forgot-password flow strings */},
  email: {/* email-related strings */},
  error: {/* generic error strings */},
  logout: {/* logout page strings */},
  common: {/* shared strings like button labels */},
};

const oauth2 = decapOauth2({
  // ... required options
  translations: myTranslations,
});
```

Both `OAuthMessages` and `Translation` are exported from `@laikacms/decap/decap-oauth2/i18n`.

## Security Considerations

This package implements security measures with future quantum computing threats in mind:

- Uses hybrid encryption approaches where applicable
- Implements secure key derivation functions
- Follows NIST post-quantum cryptography guidelines

## Disclaimer

> [!WARNING] **This package is provided "as is" without warranty of any kind.**
>
> While reasonable effort has been made to implement secure authentication flows, you are
> responsible for reviewing the implementation, ensuring it meets your security requirements,
> conducting your own security audits, and keeping dependencies up to date.
>
> The maintainers are **not liable** for any security incidents arising from the use of this
> package. See the [LICENSE](../../../LICENSE) for full terms.
>
> Do not use this package in production without understanding its limitations and conducting
> appropriate security reviews.

## License

MIT
