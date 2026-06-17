# @laikacms/decap-cms-backend-laika

[![npm](https://img.shields.io/npm/v/@laikacms/decap-cms-backend-laika)](https://www.npmjs.com/package/@laikacms/decap-cms-backend-laika)
[![npm](https://img.shields.io/npm/dm/@laikacms/decap-cms-backend-laika)](https://www.npmjs.com/package/@laikacms/decap-cms-backend-laika)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/decap-cms-backend-laika)](https://bundlephobia.com/result?p=@laikacms/decap-cms-backend-laika)

Custom Decap CMS backend for Laika CMS.

## Installation

```bash
pnpm add @laikacms/decap-cms-backend-laika decap-cms-app
```

## Usage

```typescript
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import CMS from 'decap-cms-app';

const LaikaBackend = createLaikaBackend({
  documentsApiBaseUrl: '/api/documents',
  assetsApiBaseUrl: '/api/assets',
});

CMS.registerBackend('laika', LaikaBackend);
CMS.init();
```

## Config

```yaml
backend:
  name: laika
  base_url: https://api.example.com
  api_root: /api
```

## Options

All options are passed to `createLaikaBackend(options)`. Every field is optional.

| Option                   | Type                                                              | Default        | Description                                                     |
| ------------------------ | ----------------------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| `documentsApiBaseUrl`    | `string`                                                          | —              | Base URL used by the default `DocumentsJsonApiProxyRepository`. |
| `assetsApiBaseUrl`       | `string`                                                          | —              | Base URL used by the default `AssetsJsonApiProxyRepository`.    |
| `getDocumentsRepository` | `(options: GetDocumentsRepositoryOptions) => DocumentsRepository` | built-in proxy | Factory that returns a custom `DocumentsRepository`.            |
| `getAssetsRepository`    | `(options: GetAssetsRepositoryOptions) => AssetsRepository`       | built-in proxy | Factory that returns a custom `AssetsRepository`.               |
| `onWarning`              | `(error: LaikaError) => void`                                     | `console.warn` | Called for every recoverable warning emitted by the backend.    |

### `getDocumentsRepository`

Inject a custom `DocumentsRepository` — useful for in-process testing, local mocks, or direct
database access without an HTTP proxy.

The factory receives a `GetDocumentsRepositoryOptions` object:

```ts
interface GetDocumentsRepositoryOptions {
  /** Resolves to the current bearer token. */
  tokenPromise: () => Promise<string>;
  /** The `base_url` value from the Decap config (same as `documentsApiBaseUrl` when set). */
  baseUrl: string;
}
```

Example — swap in an in-memory repository for Storybook / unit tests:

```typescript
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import { InMemoryDocumentsRepository } from './test-helpers';

const LaikaBackend = createLaikaBackend({
  getDocumentsRepository: ({ tokenPromise, baseUrl }) => {
    return new InMemoryDocumentsRepository({ tokenPromise, baseUrl });
  },
});
```

### `getAssetsRepository`

Inject a custom `AssetsRepository` for media and binary files.

The factory receives a `GetAssetsRepositoryOptions` object:

```ts
interface GetAssetsRepositoryOptions {
  /** Resolves to the current bearer token. */
  tokenPromise: () => Promise<string>;
  /** The `base_url` value from the Decap config (same as `assetsApiBaseUrl` when set). */
  baseUrl: string;
}
```

Example — point assets at a different origin than documents:

```typescript
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import { AssetsJsonApiProxyRepository } from 'laikacms/assets-jsonapi-proxy';

const LaikaBackend = createLaikaBackend({
  getAssetsRepository: ({ tokenPromise }) => {
    return new AssetsJsonApiProxyRepository({
      tokenPromise,
      baseUrl: 'https://assets.example.com',
    });
  },
});
```

### `onWarning`

Called for every recoverable warning the backend encounters (for example, a partial-success state
where the CMS operation succeeded but a secondary action — such as an R2 readback — fell back to a
synthesized response).

By default, warnings are written to `console.warn` so they surface in browser devtools. Provide your
own handler to route them to a structured logger or error-tracking service.

```typescript
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import * as Sentry from '@sentry/browser';

const LaikaBackend = createLaikaBackend({
  onWarning: error => {
    // Route to Sentry as a breadcrumb so warnings appear alongside errors
    Sentry.addBreadcrumb({
      category: 'laika-backend',
      message: `[${error.code}] ${error.message}`,
      level: 'warning',
    });
    // Also keep the devtools line
    console.warn('Laika Backend warning:', error);
  },
});
```

Or with a structured logger:

```typescript
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import { logger } from './logger';

const LaikaBackend = createLaikaBackend({
  onWarning: error => {
    logger.warn({ code: error.code, message: error.message }, 'laika-backend recoverable warning');
  },
});
```

## Features

- Editorial workflow (draft/review/publish)
- Media library integration
- i18n support (multiple folders)
- Custom repository injection
