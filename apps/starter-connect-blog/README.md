# starter-connect-blog

Minimal blog built with [connect](https://github.com/senchalabs/connect) and LaikaCMS. connect is
the grandfather of Express — a bare middleware framework with no routing, no body parser, no
template engine.

## Key patterns surfaced

### 1. No routing — parse URLs manually

connect has no built-in router. All middleware receives every request; you match paths yourself:

```ts
app.use(async (req, res, next) => {
  if (req.url === '/') /* blog index */ return;

  const postMatch = /^\/blog\/([^/?#]+)$/.exec(req.url ?? '');
  if (postMatch) /* single post */ return;

  next(); // 404
});
```

### 2. Prefix mounts strip the prefix from `req.url`

`app.use('/api/decap', handler)` is connect's only path matching. Inside the handler `req.url` is
the **sub-path** (e.g. `/documents`). connect sets `req.originalUrl` to the full path — use that to
reconstruct the URL for `laika.fetch`:

```ts
app.use('/api/decap', async (req, res) => {
  const fullPath = (req as any).originalUrl ?? req.url ?? '/';
  const url = `http://${req.headers.host}${fullPath}`;
  // ...
});
```

> **Doc gap fixed**: this `originalUrl` behaviour is now documented in
> [`docs/decap-integration.md`](../../docs/decap-integration.md).

### 3. No body parser — stream is pristine

connect never reads the body. The `IncomingMessage` stream arrives untouched in every middleware.
Read it into a `Buffer` for the Decap proxy:

```ts
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  return new Promise(resolve => req.on('end', () => resolve(Buffer.concat(chunks))));
}
```

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for Decap CMS.

## Structure

```
apps/starter-connect-blog/
├── content/posts/   # Markdown content files
├── src/
│   ├── index.ts     # connect server with manual URL routing
│   └── laika.ts     # createEmbeddedLaika + minimalBlogConfig
├── package.json
└── tsconfig.json
```
