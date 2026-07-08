# @laikacms/decap

[Decap CMS](https://decapcms.org/) integrations for
[Laika CMS](https://www.npmjs.com/package/laikacms): backend adapter, OAuth2 server, custom widgets,
and an AI chat assistant.

```bash
pnpm add @laikacms/decap
```

## Exports

### Type utilities

| Export                               | Purpose                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/decap/decap-config-types` | `ExtractFieldsType<T>`, `ExtractCollectionType<T>` — TypeScript utilities to derive typed frontmatter from a const-asserted Decap CMS config |

#### `decap-config-types` usage

```ts
import { ExtractCollectionType, ExtractFieldsType } from '@laikacms/decap/decap-config-types';
import config from './config.gen';

// Pick a collection by name from the const-asserted config
type PagesCollection = Extract<
  typeof config['collections'][number],
  { name: 'pages' }
>;

// Derive the entry type — fields only
type PageEntry = ExtractCollectionType<PagesCollection>;
// Equivalent to: ExtractFieldsType<PagesCollection['fields']>

// You can also go field-level directly
type PageProps = ExtractFieldsType<PagesCollection['fields']>;
```

### Backend & API

| Export                                    | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `@laikacms/decap/decap-api`               | Decap-compatible HTTP API on top of a Laika storage |
| `@laikacms/decap/decap-cms-backend-laika` | Decap CMS backend that talks to `decap-api`         |
| `@laikacms/decap/decap-oauth2`            | OAuth2 server (GitHub-style) for Decap login        |

#### `decap-api` options

Key options accepted by `decapApi(options)`:

| Option                    | Type                                              | Required | Description                                                                                         |
| ------------------------- | ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `documents`               | `DocumentsRepository`                             | yes      | Document storage backend                                                                            |
| `storage`                 | `StorageRepository`                               | yes      | Raw file storage backend                                                                            |
| `assets`                  | `AssetsRepository`                                | no       | Binary asset storage; enables the `/assets` endpoint when provided                                  |
| `basePath`                | `string`                                          | no       | URL prefix for all endpoints (e.g. `'/api/decap'`)                                                  |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                | yes      | Validates a Bearer access token and returns the user                                                |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                  | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access                 |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>` | no       | Receives structured diagnostic output; forwarded to storage, documents, and assets API sub-handlers |

### Widgets

| Export                                                      | Purpose                       |
| ----------------------------------------------------------- | ----------------------------- |
| `@laikacms/decap/decap-cms-widget-lucide-icon`              | Lucide icon picker widget     |
| `@laikacms/decap/decap-cms-widget-radix-icon`               | Radix icon picker widget      |
| `@laikacms/decap/decap-cms-editor-component-embedded-entry` | Embed entries inside Markdown |

### AI

AI features live in the separate
[`@laikacms/decap-ai`](https://www.npmjs.com/package/@laikacms/decap-ai) package:

```bash
pnpm add @laikacms/decap-ai
```

| Export                      | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `@laikacms/decap-ai`        | AI chat backend (model-agnostic; any Vercel AI SDK provider) |
| `@laikacms/decap-ai/tools`  | Tool definitions for the AI chat                             |
| `@laikacms/decap-ai/widget` | AI chat widget for in-editor assistance                      |

### Locales

`@laikacms/decap/decap-cms-locale-nl` — Dutch locale for Decap CMS.

i18n bundles are exposed per-module: `…/decap-oauth2/i18n`, `…/decap-oauth2/i18n/en`,
`…/decap-oauth2/i18n/nl`.

## Companion packages

- [`laikacms`](https://www.npmjs.com/package/laikacms) — core domain, APIs, serializers
- [`@laikacms/decap-ai`](https://www.npmjs.com/package/@laikacms/decap-ai) — AI chat backend and
  widget for Decap CMS
- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub storage
- [`@laikacms/aws`](https://www.npmjs.com/package/@laikacms/aws) — AWS implementations

## Documentation

See the [laikacms repository](https://github.com/laikacms/laikacms) for setup and integration
guides.

## License

MIT
