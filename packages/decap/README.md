# @laikacms/decap-integrations

[Decap CMS](https://decapcms.org/) integrations for
[Laika CMS](https://www.npmjs.com/package/laikacms): backend adapter, OAuth2 server, custom widgets,
and an AI chat assistant.

```bash
pnpm add @laikacms/decap-integrations
```

## Exports

### Presets

| Export                                            | Purpose                                                                                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/decap-integrations/embedded`           | `createEmbeddedLaika(options)` — One-call Laika+Decap setup for Node/Astro/Next/Hono using `FileSystemStorageRepository`                                                                                 |
| `@laikacms/decap-integrations/workers`            | `createWorkersLaika(options)` — Cloudflare Workers preset using `R2StorageRepository` + `ContentBaseAssetsRepository` (native R2 asset storage via `R2AssetsRepository` is planned for a future release) |
| `@laikacms/decap-integrations/custom`             | `createCustomLaika(options)` — Storage-agnostic preset; accepts any `StorageRepository`                                                                                                                  |
| `@laikacms/decap-integrations/decap-config-types` | `ExtractFieldsType<T>`, `ExtractCollectionType<T>` — TypeScript utilities to derive typed frontmatter from a const-asserted Decap CMS config                                                             |

#### `decap-config-types` usage

```ts
import {
  ExtractCollectionType,
  ExtractFieldsType,
} from '@laikacms/decap-integrations/decap-config-types';
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

| Export                                                 | Purpose                                             |
| ------------------------------------------------------ | --------------------------------------------------- |
| `@laikacms/decap-integrations/decap-api`               | Decap-compatible HTTP API on top of a Laika storage |
| `@laikacms/decap-integrations/decap-cms-backend-laika` | Decap CMS backend that talks to `decap-api`         |
| `@laikacms/decap-integrations/decap-oauth2`            | OAuth2 server (GitHub-style) for Decap login        |

### Widgets

| Export                                                                   | Purpose                       |
| ------------------------------------------------------------------------ | ----------------------------- |
| `@laikacms/decap-integrations/decap-cms-widget-lucide-icon`              | Lucide icon picker widget     |
| `@laikacms/decap-integrations/decap-cms-widget-radix-icon`               | Radix icon picker widget      |
| `@laikacms/decap-integrations/decap-cms-editor-component-embedded-entry` | Embed entries inside Markdown |

### AI

AI features live in the separate
[`@laikacms/decap-ai`](https://www.npmjs.com/package/@laikacms/decap-ai) package:

```bash
pnpm add @laikacms/decap-ai
```

| Export                      | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `@laikacms/decap-ai`        | AI chat backend (Anthropic-powered)     |
| `@laikacms/decap-ai/tools`  | Tool definitions for the AI chat        |
| `@laikacms/decap-ai/widget` | AI chat widget for in-editor assistance |

### Locales

`@laikacms/decap-integrations/decap-cms-locale-nl` — Dutch locale for Decap CMS.

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
