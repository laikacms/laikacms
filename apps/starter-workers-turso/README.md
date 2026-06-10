# `@laikacms/starter-workers-turso`

A **Cloudflare Worker** blog backend backed by **Turso** (distributed libSQL). Exposes LaikaCMS over
JSON:API and serves a Decap CMS admin shell.

`LibSqlDataSource` speaks the hrana HTTP pipeline protocol over `fetch()` — no Node.js native
modules, no persistent sockets. It runs natively in V8 isolates without `nodejs_compat`.

## Stack

- Cloudflare Workers (V8 isolates)
- Hono (routing)
- `@laikacms/libsql` — `LibSqlDataSource` + `LibSqlStorageRepository`
- `@laikacms/decap-integrations/custom` — `createCustomLaika`
- Turso / libSQL HTTP endpoint

## Local development

### Option A: sqld (no Turso account needed)

```bash
# Install sqld: https://github.com/tursodatabase/libsql
sqld --http-listen-addr 0.0.0.0:8080 &

# Create the storage table
curl -X POST http://localhost:8080/v2/pipeline \
  -H 'Content-Type: application/json' \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"CREATE TABLE IF NOT EXISTS laika_storage (key TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL, depth INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"}}]}'

# Start the Worker dev server
LIBSQL_URL=http://localhost:8080 pnpm --filter @laikacms/starter-workers-turso dev
```

### Option B: Turso cloud

```bash
# Create a .dev.vars file (gitignored)
cat > apps/starter-workers-turso/.dev.vars <<EOF
LIBSQL_URL=https://<db-name>-<org>.turso.io
LIBSQL_AUTH_TOKEN=<your-token>
EOF

pnpm --filter @laikacms/starter-workers-turso dev
```

Then open:

- `http://localhost:3000/` — endpoint index
- `http://localhost:3000/admin` — Decap CMS admin
- `http://localhost:3000/posts` — list posts

## Deploy to Cloudflare

```bash
# 1. Set the auth token as a secret (not stored in wrangler.toml).
wrangler secret put LIBSQL_AUTH_TOKEN

# 2. Edit wrangler.toml [vars] to set LIBSQL_URL for production,
#    or pass it on the command line:
wrangler deploy --var LIBSQL_URL=https://<db-name>-<org>.turso.io
```

## Schema

The `LibSqlStorageRepository` creates the table automatically on first write. You can also create it
manually:

```sql
CREATE TABLE IF NOT EXISTS laika_storage (
  key        TEXT    PRIMARY KEY NOT NULL,
  type       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  depth      INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
```

## Layout

```
apps/starter-workers-turso/
├── wrangler.toml          # Worker name + LIBSQL_URL var
├── tsconfig.json          # Workers types, Bundler moduleResolution
└── src/
    ├── index.ts           # Hono app + per-request makeLaika(env)
    └── decap-config.ts    # minimalBlogConfig()
```
