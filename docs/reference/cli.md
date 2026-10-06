# CLI

`laikacli` scaffolds new projects and runs local development workflows: a dev storage server, typed
codegen from your CMS config, and content migrations between backends.

The package installs two commands that point at the same entry point:

- **`laikacli`**: matches the package name, so `npx laikacli` and `pnpm dlx laikacli` work without
  installing anything.
- **`laika`**: the short name, available once the package is installed.

## Install

```sh
pnpm add -D laikacli   # or npm i -D / yarn add -D / bun add -d
```

Or run without installing:

```sh
npx laikacli create
pnpm dlx laikacli local serve
```

The CLI needs Node.js.

## At a glance

```sh
laika create                       # wizard: starter, directory, title, CMS backends/widgets/locales
laika local serve                  # serve a content folder over JSON:API on :3030
laika local generate --watch       # config.yaml -> typed config.gen.ts, kept fresh on save
laika local migrate -s ./a -d ./b  # copy all content from one storage backend to another
laika local list-backends          # show the storage backends migrate can use
```

| Command               | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `create`              | Bootstrap a new app from a starter and generate its `src/cms.ts`     |
| `local serve`         | Start a local-file JSON:API storage server for development           |
| `local generate`      | Generate a typed TypeScript module from the CMS config file          |
| `local migrate`       | Copy every folder and object from one storage backend to another     |
| `local list-backends` | List every storage backend `migrate` can use and its package version |

Every command accepts `--help` for its full flag reference, e.g. `laika local migrate --help`.

## `create`

`laika create` is the supported way to start a Laika app. On a terminal it walks you through each
choice:

1. **Starter**: the template to copy (skipped while only one starter is available).
2. **Directory**: where to create the app (default `./my-laika-app`). It must be empty or not exist
   yet.
3. **Site title**: written into the starter (default `My Blog`).
4. **Package manager**: `pnpm`, `npm`, `yarn` or `bun` (default `pnpm`).
5. **CMS**: the admin UI the app ships with (skipped while Decap is the only option).
6. **Backends**, **widgets** and extra admin UI **locales** to register.

The starter boots a bare Decap admin with nothing pre-registered, so your backend, widget and locale
choices are written to the generated app's `src/cms.ts`, and the matching packages are added to its
dependencies. To change them later, edit `src/cms.ts` or run the wizard again in a new directory.
Dependencies are installed at the end unless you pass `--skip-install`.

### Scripted use

Every question can be answered with a flag. Questions you leave out are still asked, unless you pass
`--yes` or the terminal is not interactive (CI, piped input); then the default is used.

```sh
laika create --directory ./my-blog --title "My Blog" --package-manager npm \
  --backends laika,github --widgets string,datetime,richtext,image --locales nl,de

laika create --yes            # accept every default, no prompts
laika create --skip-install   # scaffold only; install dependencies yourself
```

| Flag                 | Description                                                                            |
| -------------------- | -------------------------------------------------------------------------------------- |
| `--directory` / `-d` | Target directory (default: `./my-laika-app`)                                           |
| `--starter`          | Starter template (default: `starter-astro-blog`)                                       |
| `--name`             | `name` field in the new `package.json` (default: the directory name)                   |
| `--title`            | Site title (default: `My Blog`)                                                        |
| `--package-manager`  | `pnpm`, `npm`, `yarn` or `bun` (default: `pnpm`)                                       |
| `--cms`              | CMS to scaffold (default: `decap`)                                                     |
| `--backends`         | Comma-separated CMS backends to register (default: `laika`)                            |
| `--widgets`          | Comma-separated widgets to register (default: `string,datetime,richtext`)              |
| `--locales`          | Comma-separated extra admin UI locales (default: none; `en` is always included)        |
| `--skip-install`     | Create the app without installing dependencies                                         |
| `--yes` / `-y`       | Accept all defaults and skip the prompts (also the behavior when there is no terminal) |

### Decap choices

**Backends** decide where the admin UI reads and writes content: `laika` (the default, talks to a
Laika API server), `github`, `gitlab`, `gitea`, `forgejo`, `bitbucket`, `azure`, `git-gateway`,
`aws-cognito-github-proxy`, `proxy` (a local decap-server, for development) and `test-repo` (in
memory, for demos).

**Widgets** are the field types you can use in collections: `string`, `text`, `boolean`, `number`,
`datetime`, `select`, `object`, `list`, `relation`, `code`, `file`, `image`, `map`, `colorstring`,
`uuid`, `lucide-icon`, `radix-icon`, `aichat` and `richtext`. `richtext` is also registered under
the name `markdown`, so existing Decap configs that use `widget: markdown` keep working.

**Locales**: `bg`, `ca`, `cs`, `da`, `de`, `es`, `fa`, `fr`, `gr`, `he`, `hr`, `hu`, `it`, `ja`,
`ko`, `lt`, `mk`, `nb_no`, `nl`, `nn_no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sr_Cyrl`, `sv`, `th`,
`tr`, `ua`, `uk`, `vi`, `zh_Hans`, `zh_Hant`.

A CMS backend (where the admin UI sends content) is a different thing from a storage backend (what
`local migrate` copies between). See the [Decap guide](../guides/decap/index.md) for how the two fit
together.

When pnpm skips dependency build scripts during install, `create` prints a warning. Run
`pnpm approve-builds` in the new app to review and run them.

## `local serve`

Serves a folder of content files as a JSON:API storage API, the same API a production
[API server](../guides/api-server.md) exposes. Point the Decap `laika` backend, a frontend, or any
JSON:API client at it while you develop.

```sh
laika local serve                                   # serve the current directory on 127.0.0.1:3030
laika local serve --root ./content --port 4000
laika local serve --auth-token "$LAIKA_DEV_TOKEN"   # require a bearer token
```

| Flag                  | Alias | Description                                                   |
| --------------------- | ----- | ------------------------------------------------------------- |
| `--root`              | `-r`  | Directory to serve (default: the current directory)           |
| `--port`              | `-p`  | Port to listen on (default: `3030`)                           |
| `--host`              | `-H`  | Host to listen on (default: `127.0.0.1`)                      |
| `--default-extension` | —     | File extension given to newly created objects (default: `md`) |
| `--auth-token`        | —     | Require `Authorization: Bearer <token>` on every request      |

Files ending in `.md`/`.markdown`, `.yaml`/`.yml` and `.json` are parsed into structured content.
CORS is enabled for every origin, so a dev frontend on another port can call it directly.

The server has no access control beyond the optional bearer token. It is meant for local
development: keep the default `127.0.0.1` host, and use `--auth-token` if you bind it to a network
interface. For production, run the [API server](../guides/api-server.md).

## `local generate`

Reads your CMS config file (Decap's `config.yml`) and writes a TypeScript module that exports the
config as an `as const` value. Your code gets the parsed config at runtime and literal types for
every collection and field name at compile time, so a renamed field shows up as a type error.

```sh
laika local generate                               # find the config, write config.gen.ts next to it
laika local generate --watch                       # regenerate on every save
laika local generate -i src/config.yml -o src/cms/config.gen.ts
```

Without `--input`, the CLI looks for `config.yml`, `config.yaml`, `src/config.yml` and
`src/config.yaml` in the current directory, in that order.

| Flag       | Alias | Description                                                                   |
| ---------- | ----- | ----------------------------------------------------------------------------- |
| `--input`  | `-i`  | Path to the CMS config file (default: found automatically, see above)         |
| `--output` | `-o`  | Path of the generated `.ts` file (default: `config.gen.ts` next to the input) |
| `--watch`  | `-w`  | Keep running and regenerate whenever the input changes                        |
| `--cms`    | —     | Which CMS config format to read (default: `decap`)                            |

Commit the generated file or regenerate it in your build; either works. A common setup runs
`laika local generate --watch` next to your dev server.

## `local migrate`

Copies every folder and object from a source storage backend to a destination backend: filesystem to
S3, WebDAV to GitHub, one folder to another, and so on. Content is read through the source's
serializers and written through the destination's, so you can move between backends that store
content differently.

### Choosing source and destination

There are three ways to describe the two sides.

**Filesystem shortcut**, for copying between local folders:

```sh
laika local migrate -s ./content -d ./backup
```

**Named backends**, with options as a JSON object:

```sh
laika local migrate \
  --source-backend fs --source-options '{"root":"./content"}' \
  --destination-backend s3 \
  --destination-options '{"bucket":"site-content","endpoint":"https://<account>.r2.cloudflarestorage.com"}'
```

You can mix the two: `-s ./content --destination-backend github --destination-options '{...}'`.

**A config file** (`.json`, `.yaml` or `.yml`), which keeps long option sets and repeatable runs out
of your shell history:

```yaml
# migrate.yaml
source:
  backend: fs
  options:
    root: ./content
destination:
  backend: github
  options:
    owner: acme
    repo: content
    branch: main
    commitAuthor: { name: Laika Migration, email: bot@example.com }
migrate:
  from: blog         # only copy this folder and everything below it
  overwrite: false
  concurrency: 8
```

```sh
GITHUB_TOKEN=ghp_... laika local migrate --config migrate.yaml --dry-run
laika local migrate --config migrate.yaml
```

Settings in the file's `migrate` block take precedence over the matching command-line flags.

### Flags

| Flag                    | Alias | Description                                                                     |
| ----------------------- | ----- | ------------------------------------------------------------------------------- |
| `--config`              | `-c`  | JSON or YAML file with `source`, `destination` and an optional `migrate` block  |
| `--source-backend`      | —     | Source backend name (see [backends](#storage-backends))                         |
| `--source-options`      | —     | Source backend options, as a JSON object                                        |
| `--destination-backend` | —     | Destination backend name                                                        |
| `--destination-options` | —     | Destination backend options, as a JSON object                                   |
| `--source`              | `-s`  | Filesystem shortcut: source directory                                           |
| `--destination`         | `-d`  | Filesystem shortcut: destination directory                                      |
| `--default-extension`   | —     | Filesystem shortcut: extension for new files on the destination (default: `md`) |
| `--from`                | —     | Folder to start from (default: the root)                                        |
| `--overwrite`           | —     | Replace objects that already exist on the destination                           |
| `--dry-run`             | —     | Walk the source and print what would happen, without writing anything           |
| `--concurrency`         | —     | Objects copied in parallel per folder (default: `4`)                            |
| `--page-size`           | —     | Page size when listing source folders (default: `1000`)                         |
| `--no-install`          | —     | Fail instead of offering to install a missing backend package                   |

### What happens during a run

- Each line of output is one folder or object: `+` copied, `=` skipped (with the reason, `exists` or
  `dry-run`), `!` failed.
- Objects that already exist on the destination are **skipped** unless you pass `--overwrite`, so
  re-running an interrupted migration picks up where it left off.
- A failure on one object doesn't stop the run. The summary at the end counts created, skipped and
  failed items, and the command exits with a non-zero status when anything failed.
- Start with `--dry-run` against a real destination to check credentials and see what would be
  copied.
- Git-host destinations (`github`, `gitlab`, `bitbucket`) make one commit per object written. Expect
  a long history and API rate limits on large migrations; lower `--concurrency` if you hit them.

### Backend packages

`fs`, `jsonapi-proxy`, `webdav` and `github-cdn` are built in. The other backends need an extra
package. When it isn't installed in your project, `migrate` asks before installing the pinned
version into `~/.laika-cms/backends`, so your project's dependencies stay untouched. Without a
terminal, or with `--no-install`, it fails with the install command to run yourself.

## `local list-backends`

Prints every storage backend `migrate` accepts, with its package and pinned version.

```sh
laika local list-backends
```

## Storage backends

Options for each backend `migrate` accepts. Every backend that writes files also takes
`defaultExtension` (default `md`). Credentials can come from the environment variables listed, so
they stay out of config files and shell history. See [Adapters](../adapters/index.md) for what each
backend is and how it stores content.

| Backend         | Required options                                                          | Optional options                                                                     | Environment fallbacks                                                                                       |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `fs`            | `root`                                                                    | —                                                                                    | —                                                                                                           |
| `jsonapi-proxy` | `baseUrl`                                                                 | `authToken`                                                                          | —                                                                                                           |
| `webdav`        | `baseUrl`                                                                 | `basePath`, `username`, `password`, `token`, `headers`                               | —                                                                                                           |
| `github-cdn`    | `owner`, `repo`                                                           | `branch`, `fetchMeta`, `cdnBaseUrl`, `dataApiBaseUrl`, `userAgent`                   | —                                                                                                           |
| `s3`            | `bucket`, `accessKeyId`, `secretAccessKey`                                | `region` (default `auto`), `endpoint`, `sessionToken`, `keyPrefix`, `forcePathStyle` | `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`, `S3_ENDPOINT` |
| `github`        | `owner`, `repo`, `branch`, plus `token` or GitHub App credentials         | `commitAuthor`                                                                       | `GITHUB_TOKEN`, `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`                         |
| `gitlab`        | `projectId` (numeric id or URL-encoded path), `branch`                    | `token`, `oauthToken`, `jobToken`, `apiUrl` (self-hosted), `commitAuthor`            | `GITLAB_TOKEN`, `CI_JOB_TOKEN`                                                                              |
| `bitbucket`     | `workspace`, `repo`, `branch`, plus `oauthToken` or `username`+`password` | `apiUrl`, `commitAuthor`                                                             | `BITBUCKET_TOKEN`, `BITBUCKET_USERNAME`, `BITBUCKET_APP_PASSWORD`                                           |

Notes:

- `github-cdn` is read-only: use it as a source to pull content from a public repository without
  credentials.
- `s3` works with AWS S3, Cloudflare R2 (through its S3 endpoint), MinIO and other S3-compatible
  stores. For R2, set `endpoint` and leave `region` at `auto`.
- `github` accepts either a personal access token (`token`) or a GitHub App: `appId`,
  `installationId`, and the private key as `privateKey` (PEM string) or `privateKeyPath`.

  ```sh
  laika local migrate -s ./content --destination-backend github --destination-options \
    '{"appId":"123","installationId":"456","privateKeyPath":"./app.pem","owner":"acme","repo":"content","branch":"main"}'
  ```

- `commitAuthor` is an object: `{ "name": "...", "email": "..." }`.

## Programmatic API

Everything the CLI does is also exported from the package, for use in your own scripts:

```ts
import { bootstrapApplication, generateConfig, layerStorageServer, runMigrate } from 'laikacli';

// Run a migration from a script, with your own progress handling
const result = await runMigrate({
  config: {
    source: { backend: 'fs', options: { root: './content' } },
    destination: { backend: 'fs', options: { root: './backup' } },
    migrate: { dryRun: true },
  },
  onEvent: event => console.log(event.type, 'key' in event ? event.key : ''),
});
console.log(`${result.objectsCopied} copied, ${result.errors.length} errors`);
```

| Export                                     | Use it to                                                     |
| ------------------------------------------ | ------------------------------------------------------------- |
| `bootstrapApplication`                     | Scaffold an app, the same as `create`                         |
| `layerStorageServer`                       | Run the `local serve` server inside your own process          |
| `generateConfig`, `loadConfig`             | Generate or load the typed CMS config                         |
| `runMigrate`, `loadMigrateConfig`          | Run a migration from a config object or file                  |
| `migrateStorage`                           | Copy between two storage repositories you already constructed |
| `storageDrivers`, `buildStorageRepository` | Look up a storage backend by name and build it from options   |

If you build your own CLI with Effect, the `make*Command` factories (`makeServeCommand`,
`makeGenerateCommand`, `makeMigrateCommand`, …) let you mount these commands under your own names.
