# Deploy to Production

Every quickstart ends with a dev token and localhost. This page is the rest: real hosting, real
auth, and the hardening checklist. Run the API and the frontend in separate runtimes where you can —
it keeps secrets and blast radius apart.

## Where to run it

The API handler is `{ fetch(request: Request): Promise<Response> }`, so anywhere that speaks the
Fetch API hosts it unchanged:

- **Cloudflare Workers** — `wrangler deploy`; content in [R2](../backends/r2) or
  [D1/SQL](../backends/sql). See the [Workers quickstart](./cloudflare-workers).
- **Node.js hosts** (Railway, Fly.io, Docker, a VPS) — via `@hono/node-server`. If you use the
  [filesystem backend](../backends/fs), attach a **persistent volume** at the content directory so
  content survives restarts and redeploys.
- **Serverless (Vercel, Lambda)** — read-only filesystems; use a remote backend
  ([GitHub](../backends/github), [S3](../backends/s3), [SQL](../backends/sql)). See the
  [Vercel quickstart](./vercel).

### Filesystem hosting examples

::: details Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Content is stored in /app/content — mount a volume here in production.
VOLUME ["/app/content"]

EXPOSE 3000
CMD ["node", "server.mjs"]
```

```bash
docker build -t laika-api .
docker run -p 3000:3000 -v $(pwd)/content:/app/content laika-api
```

:::

::: details Fly.io

```toml
# fly.toml
app = "my-laika-api"
primary_region = "iad"

[mounts]
source = "content_data"
destination = "/app/content"

[[services]]
internal_port = 3000
protocol = "tcp"

[[services.ports]]
port = 443
handlers = ["tls", "http"]
```

```bash
fly volumes create content_data --size 1
fly deploy
```

:::

::: details Railway

1. Connect the repo to a new Railway project.
2. Add a **Persistent Volume** mounted at `/app/content` (or wherever `rootDirectory` points).
3. Set environment variables in the dashboard; Railway runs `npm start`.

:::

## Replace the dev token

The quickstarts authenticate with a pre-shared dev token. In production, `authenticateAccessToken`
must validate a real credential:

- **Best:** mount the [OAuth2 authorization server](../middleware/oauth2) next to the API — full
  login UI, PKCE, passkeys, TOTP — and validate its access tokens via your session store.
- **Fine for machine-to-machine:** JWT verification or a database session lookup inside
  `authenticateAccessToken`.
- **Also state your `authorize` policy** — who may read, who may write.
  [Middleware → API](../middleware/api) covers both callbacks in detail.

Alternatively, gate at the framework level and keep the handler's internal policy open — then the
middleware is the gate:

```typescript
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('*', cors({ origin: 'https://your-frontend.example.com' }));
app.use('*', bearerAuth({ token: process.env.API_TOKEN! }));
app.all('*', c => api.fetch(c.req.raw));
```

On Workers, the equivalent is a header check at the top of the `fetch` handler before dispatching to
the API.

## CORS

Needed exactly when the admin (or frontend) and the API are on different origins. Pass
`cors: { origins: ['https://admin.example.com'] }` to `laikaApi`, or handle it in framework
middleware as above. Serving admin and API from the same origin removes the need entirely.

## Secrets

- Secrets live in environment variables or your platform's secret store (`wrangler secret put`,
  `vercel env add`) — never in the Decap config, which is served to the browser.
- Remove `dev_token` from any deployed admin config; it's a dev-only bypass.
- Use `effect`'s `Secret` for secret values in your own code, and never include sensitive data in
  error results — internal detail belongs in `LaikaError`'s server-side `cause`
  ([Middleware → API → error hygiene](../middleware/api#error-hygiene)).

## Logging

Both `laikaApi` and the raw builders accept a `logger` (`error`/`warn`/`info`/`debug`) — wire your
platform's logger or a filtered console ([details](../middleware/api#logging)).

## Checklist

- [ ] HTTPS only
- [ ] `authenticateAccessToken` validates a real credential (no dev token anywhere)
- [ ] `authorize` states the real read/write policy
- [ ] CORS restricted to your actual origins
- [ ] Rate limiting at the platform or middleware level
- [ ] Secrets in environment variables / secret store, not in configs served to the browser
- [ ] Filesystem backend: persistent volume mounted
- [ ] Error responses leak no internal detail
