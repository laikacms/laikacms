# @laikacms/decap-integrations/decap-oauth2

[![npm](https://img.shields.io/npm/v/@laikacms/decap-integrations)](https://www.npmjs.com/package/@laikacms/decap-integrations)
[![npm](https://img.shields.io/npm/dm/@laikacms/decap-integrations)](https://www.npmjs.com/package/@laikacms/decap-integrations)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/decap-integrations)](https://bundlephobia.com/result?p=@laikacms/decap-integrations)

OAuth2 authentication server for Decap CMS with PKCE support.

## Features

- OAuth2 with PKCE (Proof Key for Code Exchange)
- Self-contained authorization server (email + password login, passkey/WebAuthn, TOTP 2FA)
- Quantum-safe cryptographic considerations
- Cloudflare Workers compatible

## Installation

```bash
pnpm add @laikacms/decap-integrations
```

## Usage

```typescript
import { decapOauth2 } from '@laikacms/decap-integrations/decap-oauth2';

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
