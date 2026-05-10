# @laikacms/decap-oauth2

[![npm](https://img.shields.io/npm/v/@laikacms/decap-oauth2)](https://www.npmjs.com/package/@laikacms/decap-oauth2)
[![npm](https://img.shields.io/npm/dm/@laikacms/decap-oauth2)](https://www.npmjs.com/package/@laikacms/decap-oauth2)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/decap-oauth2)](https://bundlephobia.com/result?p=@laikacms/decap-oauth2)

OAuth2 authentication server for Decap CMS with PKCE support.

## Features

- OAuth2 with PKCE (Proof Key for Code Exchange)
- GitHub, GitLab, and Bitbucket provider support
- Quantum-safe cryptographic considerations
- Cloudflare Workers compatible

## Installation

```bash
pnpm add @laikacms/decap-oauth2
```

## Usage

```typescript
import { createOAuth2Server } from '@laikacms/decap-oauth2';

const server = createOAuth2Server({
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  },
});

export default server;
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
