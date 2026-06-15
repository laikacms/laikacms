# starter-restify-blog

Minimal blog built with [Restify v11](http://restify.com) and LaikaCMS. Demonstrates the
**REST-first Node.js** pattern without Express.

## Key pattern — skip `bodyParser`, read stream directly

Restify's `bodyParser` middleware consumes the `IncomingMessage` stream. If it runs before the Decap
proxy handler, the raw binary body (file uploads, JSON payloads) is gone.

The fix: don't register `bodyParser` globally. Blog and admin routes never read the request body, so
there's nothing to parse. The Decap proxy handler reads the stream manually:

```ts
async function decapProxy(req: restify.Request, res: restify.Response) {
  // No global bodyParser → stream is still readable
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>(resolve => req.on('end', resolve));
  const body = Buffer.concat(chunks);

  const webRes = await laika.fetch(
    new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method !== 'GET' && body.length > 0 ? body : null,
    }),
  );

  res.status(webRes.status);
  webRes.headers.forEach((v: string, k: string) => res.header(k, v));
  // sendRaw bypasses Restify's content-type formatters (no JSON re-encoding)
  res.sendRaw(webRes.status, Buffer.from(await webRes.arrayBuffer()));
}
```

> `res.sendRaw()` is important: `res.send()` runs the body through Restify's formatter pipeline,
> which can JSON-encode a `Buffer` or re-encode JSON responses. `res.sendRaw()` sends bytes as-is,
> matching what `laika.fetch` returned.

> **Doc gap fixed**: Restify's `sendRaw` vs `send` distinction is documented in
> [`docs/decap-integration.md`](../../docs/decap-integration.md) under the _Restify_ section.

## Features

- **Restify server** — `createServer()` with explicit per-method route registration
- **SSR blog** — index and post pages rendered server-side with `laika.documents.*`
- **`laika.documents.*` via `laikacms/compat`** — `collectStream` / `runTask`
- **Decap admin from CDN** — admin UI at `/admin/`; laika backend at `/api/decap/*`

## Quick start

```bash
pnpm install
pnpm build
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for the Decap CMS
editor (dev auth applied automatically).

## Structure

```
apps/starter-restify-blog/
├── content/posts/   # Markdown content files
├── src/
│   ├── index.ts     # Restify server: routes + Decap proxy
│   └── laika.ts     # createEmbeddedLaika + minimalBlogConfig
├── package.json
└── tsconfig.json
```
