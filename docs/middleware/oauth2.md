# OAuth2

`laikaOauth2` (`@laikacms/server/oauth2`) is a self-contained OAuth2 **authorization server** with
PKCE you mount next to the [API](./api): email + password login out of the box, with optional
passkey/WebAuthn, TOTP 2FA, password reset, and CAPTCHA. Storage is yours — every persistence
concern is a callback, so it runs against any database on Node.js or Cloudflare Workers.

Don't hand-roll session storage: this is the production answer to the dev tokens used in the
quickstarts.

## Mount it

```typescript
import { laikaOauth2 } from '@laikacms/server/oauth2';

const oauth2 = laikaOauth2({
  basePath: '/oauth2',
  clientId: process.env.OAUTH_CLIENT_ID!,
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

Run it alongside `laikaApi` in the same app; the API's `authenticateAccessToken` callback then
validates tokens via the same session store (`getSessionByAccessToken`).

## Optional features

Each is enabled by adding its key to the config — none are required for basic email/password login:

- **Passkey / WebAuthn** — passwordless FIDO2 login; users enroll after first password sign-in, and
  can be required to (`passkey.required`).
- **TOTP 2FA** — RFC 6238 second factor, compatible with Google Authenticator/Authy; optional
  per-step replay protection.
- **Password reset** — full email-based flow with a pluggable `EmailProvider` (MailChannels,
  Nodemailer, Resend, …) and overridable templates.
- **CAPTCHA** — login and forgot-password forms; any widget-plus-form-field provider works
  (reCAPTCHA v2, hCaptcha, Cloudflare Turnstile).

The full callback tables for every feature are in the
[`@laikacms/server/oauth2` README](https://github.com/laikacms/laikacms/blob/develop/packages/server/src/oauth2/README.md).

## Scope today: one client

The server implements standard authorization-code + PKCE flows, but it is configured with a single
`clientId` — there is no dynamic client registration yet. In practice that client is the Decap
admin; the Decap-side wiring lives in [Decap → Authentication](../decap/auth). Treat multi-client
and dynamic registration as not-yet-supported rather than configure-it-harder.

## Design notes

- **Fails closed** — invalid tokens, expired codes, and missing sessions all deny; runtime safety
  gates assert unsafe deployment configurations at startup.
- **Quantum-safe cryptographic considerations** are part of the design; see the README for the
  current posture.
- The UI ships localized (`@laikacms/server/oauth2/i18n/{en,nl}`).
