# starter-loopback-blog

A minimal blog powered by **LoopBack 4** (IBM's TypeScript REST API framework) and **LaikaCMS**.

## Pattern

LoopBack 4 uses Express internally and registers its own body-parser at the `PARSE_PARAMS` sequence
step. The key technique here is the **outer Express wrapper**:

1. `new BlogApplication()` — constructs a `RestApplication`, registering all controllers
2. `await app.init()` — resolves IoC bindings; do **not** call `app.start()` (that binds a port)
3. Outer Express server mounts `express.raw()` + Decap proxy **before** `app.requestHandler`
4. LoopBack's `requestHandler` handles all other routes — it never sees `/api/decap/*`

## Quick start

```bash
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS.

## Controllers

LoopBack 4 returns `string` as `text/plain` by default. Inject `RestBindings.Http.RESPONSE` to set
`Content-Type: text/html`:

```ts
export class BlogController {
  constructor(
    @inject(RestBindings.Http.RESPONSE) private readonly res: Response,
  ) {}

  @get('/')
  async index(): Promise<string> {
    this.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return '<html>…</html>';
  }
}
```

## Structure

```
src/
  index.ts            outer Express wrapper + lifecycle
  application.ts      BlogApplication extends RestApplication
  laika.ts            createEmbeddedLaika setup
  controllers/
    blog.controller.ts @get decorators, injects RESPONSE
content/
  posts/              markdown files managed by Decap
```

## Doc gaps surfaced

- `RestApplication.requestHandler` is an Express `RequestHandler` — undocumented in LaikaCMS docs
- `app.init()` initialises bindings without opening a port; `app.start()` does both
- LoopBack string responses are `text/plain` without `@inject(RestBindings.Http.RESPONSE)`
