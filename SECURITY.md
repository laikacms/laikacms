# Security

## Reporting Vulnerabilities

Email [security@laikacms.com](mailto:security@laikacms.com). Do not use public issues.

## Packages

### `@laikacms/crypto`

- Argon2id password hashing
- Constant-time comparison
- Secure random generation

### `@laikacms/decap-oauth2`

> [!WARNING]
> Provided "as is" without warranty. Review the implementation and conduct your own security audits
> before production use.

### `@laikacms/file-sanitizer`

> [!CAUTION] **Best-effort sanitization only.** Will not stop determined attackers. Use additional
> measures: isolated storage, antivirus scanning, CDN delivery.

### `@laikacms/sanitizer`

HTML/input sanitization for XSS prevention.

## Deployment

- Run API and frontend in separate runtimes
- Use HTTPS only
- Store secrets in environment variables
- Enable rate limiting
