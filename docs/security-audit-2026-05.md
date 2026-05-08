# Security Audit — OAuth & API Packages (2026-05-08)

Audit scope: `@laikacms/decap-oauth2`, `@laikacms/decap-api`, `@laikacms/contentbase-api`,
`@laikacms/documents-api`, `@laikacms/assets-api`, `@laikacms/storage-api`.

The findings below were identified by static review. Severity ratings reflect the impact when the
relevant feature is enabled and exposed to untrusted clients.

## Summary

| # | Severity | Component               | Issue                                                                         | Status |
| - | -------- | ----------------------- | ----------------------------------------------------------------------------- | ------ |
| 1 | High     | `decap-oauth2/passkey`  | `userVerification: 'required'` is silently ignored (UV flag never checked)    | Fixed  |
| 2 | High     | `decap-oauth2`          | Password reset does not invalidate existing OAuth sessions                    | Fixed  |
| 3 | Medium   | `decap-oauth2/totp`     | TOTP codes can be replayed within the validity window (no last-step tracking) | Fixed  |
| 4 | Medium   | `decap-oauth2`          | Pending TOTP session is not consumed (re-usable until natural expiry)         | Fixed  |
| 5 | Medium   | `decap-oauth2`          | Logout endpoint accepts the access token in a `GET` query parameter           | Fixed  |
| 6 | Medium   | `decap-api`             | API key accepted via `?api_key=` URL query parameter                          | Fixed  |
| 7 | Medium   | `decap-oauth2`          | Open redirect after TOTP setup verification                                   | Fixed  |
| 8 | Low      | `*-api` server packages | Built without authentication; documentation does not warn about this          | Fixed  |

All eight findings are addressed by the commits on the audit branch. Findings 3 and 4 introduce new
optional callbacks on `OAuthTotpCallbacks` so existing implementations keep working but gain replay
protection once they wire the new callbacks up.

---

## 1. Passkey: `userVerification` flag never enforced — **High**

**Location:** `packages/decap/decap-oauth2/src/passkey/passkey.ts` (`verifyAuthentication` ≈ line
464, `verifyRegistration` ≈ line 287)

`PasskeyConfig.userVerification` defaults to `'required'`, and registration/authentication options
sent to the browser request that the authenticator perform user verification (PIN/biometric).
However, the server only verifies the `userPresent` (UP) flag of `authenticatorData`:

```ts
if (!parsedAuthData.flags.userPresent) {
  return { success: false, error: 'User presence flag not set' };
}
```

The `userVerified` (UV) flag is parsed but never read for an authorization decision. A client (or
attacker with access to a discoverable credential, e.g. a stolen unlocked device or a malicious
browser extension that can drive WebAuthn) can return `UV=0`, `UP=1` and the server will accept it
even though the deployment requires user verification.

**Impact:** Two-factor strength of passkeys is reduced to single-factor "user present" — the second
factor (knowledge / inherence via PIN or biometric) is never verified server-side. An attacker who
gains physical access to an unlocked device, or who can prompt a victim with `UV=discouraged`
options via a parallel WebAuthn flow on the same authenticator, bypasses the `required`
configuration.

**Fix applied in this commit:** `verifyAuthentication` and `verifyRegistration` now reject responses
where `userVerification === 'required'` but the authenticator data UV flag is unset.

---

## 2. Password reset does not invalidate existing sessions — **High**

**Location:** `packages/decap/decap-oauth2/src/oauth2.ts` (`handleResetPassword` ≈ line 1843) and
`packages/decap/decap-oauth2/src/email/email.ts` (`resetPassword` ≈ line 290).

After a successful password reset, `OAuthCallbacks.logoutAll(userId)` is never called. Existing
access tokens, refresh tokens and pending TOTP sessions remain valid.

**Threat model:** A user resets their password specifically because they suspect compromise (stolen
session token via XSS, stolen device, leaked refresh token from log files, etc.). The expectation is
that "I changed my password" terminates all active sessions. Today it does not — an attacker holding
a stolen token continues to have full access until the token's natural expiry (default 30 days for
refresh tokens).

**Fix applied in this commit:** `resetPassword` now returns the `userId` of the affected user, and
`handleResetPassword` calls `config.callbacks.logoutAll(userId)` immediately after a successful
reset. Existing callers that destructure only `{ success, error }` continue to work.

---

## 3. TOTP codes are replayable within their window — **Medium**

**Location:** `packages/decap/decap-oauth2/src/totp/totp.ts` (`verifyTOTP` ≈ line 257).

The implementation accepts any TOTP code that matches the current ±`window` time steps. RFC 6238
§5.2 recommends rejecting any code whose time step is less than or equal to the most recently used
time step for that user. The current `OAuthTotpCallbacks` has no `getLastTotpTimeStep` /
`setLastTotpTimeStep` (or equivalent "code already used") hook, so a leaked TOTP code (logs,
shoulder-surfing, phishing) can be replayed for up to ~90 seconds (with default `window=1`).

**Fix applied:** `verifyTOTPWithStep` now returns the matched time step alongside the verification
result, and a new `verifyOAuthTOTPWithReplayProtection` helper consults two new optional callbacks
on `OAuthTotpCallbacks` — `getLastTotpStep(userId)` and `setLastTotpStep(userId, step)` — to reject
any code whose step is `<= last`. The callbacks are optional so existing storage adapters compile;
adapters that wire them in get RFC 6238 §5.2 replay protection automatically.

---

## 4. Pending TOTP session is reusable — **Medium**

**Location:** `packages/decap/decap-oauth2/src/oauth2.ts` (`handleAuthorize`, TOTP-verify branch ≈
line 653 and the passkey-then-TOTP branch ≈ line 1530).

When a user presents a valid `(totp_session, totp_code)` pair, the server issues an authorization
code but does **not** delete the pending session. The same `totp_session` value is therefore valid
for all subsequent requests until it naturally expires (5 minutes for password+TOTP, 10 minutes for
TOTP setup, 5 minutes for passkey+TOTP). An attacker who steals a `totp_session` value (from browser
history, logs, or referer headers — it is passed in URL query strings) and who also captures a valid
TOTP code (see Finding 3) can mint multiple authorization codes from a single interception.

**Fix applied:** Added an optional `deletePendingTotpSession(sessionId)` callback to
`OAuthTotpCallbacks`. `handleAuthorize` now calls it on the success path that issues an
authorization code from a `(totp_session, totp_code)` pair, so a captured `totp_session` cannot be
reused for further authorizations.

---

## 5. Logout via GET with token in URL — **Medium**

**Location:** `packages/decap/decap-oauth2/src/oauth2.ts` (`handleLogout` ≈ line 1951,
`handleLogoutAll` ≈ line 2027).

```ts
// /oauth2/logout?access_token=…  — GET only
const accessToken = validateInputLength(url.searchParams.get('access_token'), …);
```

Access tokens placed in a URL leak through:

- HTTP server access logs.
- Reverse-proxy / CDN logs.
- Browser history.
- The `Referer` header on any subsequent navigation away from the page.

Additionally, because the endpoint is `GET`, it is vulnerable to "logout CSRF" via `<img>` /
`<link rel="prefetch">` tags (low impact, but a nuisance).

**Fix applied:** `handleLogout` and `handleLogoutAll` now accept the access token via the
`Authorization: Bearer …` header. They also accept `POST`. The legacy `?access_token=` query
parameter is still honored for backward compatibility but emits a `logger.warn` so operators can
spot remaining callers and migrate them.

---

## 6. API key in URL query parameter — **Medium**

**Location:** `packages/decap/decap-api/src/index.ts` (`authenticateRequest` ≈ line 110).

```ts
const urlApiKey = new URL(request.url).searchParams.get('api_key') || undefined;
```

Same class of leak as Finding 5. Industry best practice (OWASP API Security, RFC 6750) is to never
accept bearer credentials via query string.

**Fix applied:** `authenticateRequest` no longer falls back to the `api_key` URL parameter; it
requires either the `X-API-Key` header or `Authorization: ApiKey <key>`. When a caller still
provides `?api_key=…`, the request is treated as unauthenticated and a warning is logged.

---

## 7. Open redirect after TOTP setup verification — **Medium**

**Location:** `packages/decap/decap-oauth2/src/oauth2.ts` (`handleTotpSetupVerify` ≈ line 1315).

```ts
const redirectUri = url.searchParams.get('redirect_uri')
  || formData.get('redirect_uri')?.toString();
if (redirectUri) {
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('totp_session', setupToken);
  return new Response(null, { status: 302, headers: { Location: redirectUrl.toString() } });
}
```

Any URL is accepted, and the freshly minted `setup_token` (which doubles as a `totp_session`) is
attached as a query parameter. An attacker who can lure a user to a crafted setup URL gets the
session value delivered to a third-party origin, and can combine it with a guessed/replayed TOTP
code to complete authorization.

**Fix applied:** `handleTotpSetupVerify` now resolves the supplied `redirect_uri` against the
request origin and rejects the request when the resulting URL is on a different origin. Relative
URLs continue to work because they resolve to the same origin.

---

## 8. `*-api` server packages have no built-in authentication — **Low (by design, but undocumented)**

**Location:** `packages/api/contentbase-api`, `packages/api/documents-api`,
`packages/api/assets-api`, `packages/api/storage-api`.

The `buildJsonApi` / `buildAssetsApi` factories produce fully wired CRUD endpoints with no
authentication middleware. The published READMEs show

```ts
const api = buildJsonApi({ repo: myStorageRepo });
export default { fetch: api.fetch };
```

with no warning that doing so on a public network exposes the entire content store to anonymous
read/write/delete. The `decap-api` wrapper provides authentication, but a developer following the
storage-api README literally would deploy an unauthenticated CMS backend.

**Fix applied:** The `storage-api` README gained a prominent "⚠️ Authentication" section, and each of
the four `buildJsonApi` / `buildAssetsApi` exports (`storage-api`, `documents-api`, `assets-api`,
`contentbase-api`) now carries a JSDoc warning that surfaces in IDE tooltips when a developer
reaches for the function.

---

## Notes on items checked and found acceptable

- PKCE: code challenge is constant-time compared, only `S256` is accepted, `code_verifier` length is
  bounded — looks correct.
- Authorization code is single-use: deleted on success and on PKCE failure.
- Refresh-token rotation: old session is deleted before a new one is created (line 1100).
- Email enumeration on `/forgot-password`: mitigated by always rendering the success page and
  inserting jitter when the user is missing.
- Password verification uses a constant dummy hash when the user does not exist, eliminating timing
  enumeration.
- OAuth error responses set `Cache-Control: no-store` and security headers
  (`X-Content-Type-Options`, `X-Frame-Options`, CSP) on HTML responses.
