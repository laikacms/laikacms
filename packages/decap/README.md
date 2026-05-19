# @laikacms/decap

[Decap CMS](https://decapcms.org/) integrations for
[Laika CMS](https://www.npmjs.com/package/laikacms): backend adapter, OAuth2 server, custom widgets,
and an AI chat assistant.

```bash
pnpm add @laikacms/decap
```

## Exports

### Backend & API

| Export                                    | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `@laikacms/decap/decap-api`               | Decap-compatible HTTP API on top of a Laika storage |
| `@laikacms/decap/decap-cms-backend-laika` | Decap CMS backend that talks to `decap-api`         |
| `@laikacms/decap/decap-oauth2`            | OAuth2 server (GitHub-style) for Decap login        |

### Widgets

| Export                                                      | Purpose                                 |
| ----------------------------------------------------------- | --------------------------------------- |
| `@laikacms/decap/decap-cms-widget-ai-chat`                  | AI chat widget for in-editor assistance |
| `@laikacms/decap/decap-cms-widget-lucide-icon`              | Lucide icon picker widget               |
| `@laikacms/decap/decap-cms-widget-radix-icon`               | Radix icon picker widget                |
| `@laikacms/decap/decap-cms-editor-component-embedded-entry` | Embed entries inside Markdown           |

### AI

| Export                           | Purpose                             |
| -------------------------------- | ----------------------------------- |
| `@laikacms/decap/decap-ai`       | AI chat backend (Anthropic-powered) |
| `@laikacms/decap/decap-ai/tools` | Tool definitions for the AI chat    |

### Locales

`@laikacms/decap/decap-cms-locale-nl` — Dutch locale for Decap CMS.

i18n bundles are exposed per-module: `…/i18n/en`, `…/i18n/nl`, `…/i18n/types`.

## Companion packages

- [`laikacms`](https://www.npmjs.com/package/laikacms) — core domain, APIs, serializers
- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub storage
- [`@laikacms/aws`](https://www.npmjs.com/package/@laikacms/aws) — AWS implementations

## Documentation

See the [laikacms repository](https://github.com/laikacms/laikacms) for setup and integration
guides.

## License

MIT
