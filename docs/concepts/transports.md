# Transports

A transport carries a protocol across a process boundary. LaikaCMS ships one: **JSON:API over HTTP**
— each protocol ([Storage](./storage), [Documents](./documents), [Assets](./assets),
[Catalog](./catalog)) has a [JSON:API surface](../reference/json-api/) with the same operations as
its repository contract.

Two properties matter more than the wire format:

**It's built directly on `fetch`.** An API handler is just
`{ fetch(request: Request): Promise<Response> }` — no framework, no server object. That means it
runs anywhere a Web API `Request`/`Response` pair works (Node.js, Cloudflare Workers, a Vite dev
server), and it can be called **without any network at all**: hand the handler a `Request` in the
same process and you have a zero-hop transport.

**It's symmetric.** For every protocol there is a `*-jsonapi-proxy` repository that implements the
repository contract _by calling_ the JSON:API. A remote LaikaCMS server is therefore just another
[backend](../backends/jsonapi-proxy):

```
your code → DocumentsJsonApiProxyRepository → HTTP → laikaApi → CatalogDocumentsRepository → storage
```

Client and server speak the same contracts, so where you draw the network boundary is a deployment
decision, not an architectural one.

## Mounting it

See [Middleware → API](../middleware/api) for `laikaApi` (the production surface with required
authentication) and the raw per-protocol builders. The full endpoint documentation lives in the
[JSON:API reference](../reference/json-api/).
