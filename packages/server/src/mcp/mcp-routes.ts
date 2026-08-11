/**
 * Remote MCP (Model Context Protocol) endpoint + OAuth discovery glue.
 *
 * Lets MCP clients (Claude Code / Claude Desktop custom connectors, and any
 * other Streamable HTTP MCP client) reach a Laika CMS JSON:API over the
 * deployment's EXISTING bearer auth — no second auth system:
 *
 *  - `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728) points MCP
 *    clients at the deployment's OAuth authorization server.
 *  - `ALL /mcp` is the Streamable HTTP MCP endpoint. Unauthenticated requests
 *    get the spec-required 401 + `WWW-Authenticate` resource_metadata pointer
 *    (that header IS the discovery entrypoint for MCP clients); a request that
 *    passes `verifyBearer` gets a per-request (stateless) MCP server whose
 *    `api_request` tool dispatches into the caller-provided `fetch` handler
 *    with the caller's own `Authorization` header attached — so every
 *    server-side gate (authentication, `authorize`, validation) applies
 *    unchanged.
 *
 * RFC 7591 dynamic client registration (`POST /oauth2/register`) is
 * intentionally NOT implemented: `@laikacms/server/oauth2` is a single-client
 * authorization server, and handing that client id to arbitrary registrants is
 * a policy the OAuth2 module has not adopted. When it grows registration
 * support, serve its endpoint on the same app this handler is composed into —
 * registered BEFORE any `/oauth2/*` catch-all, or the catch-all wins the route
 * — and advertise it via RFC 8414 authorization-server metadata.
 *
 * Composition: the returned handler answers only its own paths (`/mcp` and the
 * well-known documents) and 404s everything else, so route it by path prefix —
 * and, like every fixed route, BEFORE any catch-all the app mounts.
 */
import { Hono } from 'hono';
import { AuthenticationError, NotFoundError, Url } from 'laikacms/core';
import type { OpenApiDocument } from 'laikacms/json-api';
import { errorToJsonApiMapper } from 'laikacms/json-api';
import { createLaikaMcpServer, type FetchHandler } from './mcp-server.js';

/**
 * RFC 9728 protected-resource metadata: which authorization servers can mint
 * tokens for the `/mcp` resource. This document is what the 401's
 * `WWW-Authenticate` header points MCP clients at.
 */
export function protectedResourceMetadata(publicUrl: string, authorizationServers?: string[]) {
  return {
    resource: `${publicUrl}/mcp`,
    authorization_servers: authorizationServers?.length ? authorizationServers : [publicUrl],
    bearer_methods_supported: ['header'],
  };
}

export interface LaikaMcpOptions {
  /**
   * Public origin of this deployment (scheme + host, no trailing slash),
   * e.g. `'https://cms.example.com'`. Used in the discovery metadata and to
   * synthesize the internal Requests `fetch` receives.
   */
  publicUrl: string;
  /**
   * Base path of the JSON:API surface `api_request` may reach — the
   * `basePath` the `laikaApi` server was built with. Defaults to `''` (the
   * origin root).
   */
  apiBasePath?: string | undefined;
  /**
   * In-process dispatch into the app serving `apiBasePath` — typically
   * `laikaApi(...).fetch`, or the composed app handler. No network hop.
   */
  fetch: FetchHandler;
  /** The OpenAPI contract `read_api_spec` serves — see `buildLaikaApiOpenApi`. */
  openApi: OpenApiDocument;
  /**
   * The bearer gate: full `Authorization` header value in, the authenticated
   * principal out, or `null`/`undefined` to reject with 401. Plug in the same
   * verification the deployment's API uses (e.g. an OAuth session lookup).
   */
  verifyBearer: (
    authorization: string | undefined,
    request: Request,
  ) => Promise<unknown | null | undefined> | unknown | null | undefined;
  /**
   * Authorization server URL(s) advertised in the protected-resource
   * metadata. Defaults to `[publicUrl]` — correct when the deployment hosts
   * its own `@laikacms/server/oauth2` server on the same origin.
   */
  authorizationServers?: string[] | undefined;
  /** Server identity advertised to MCP clients. Defaults to `laikacms`. */
  serverInfo?: { name: string, version: string } | undefined;
  /** Override the default usage instructions sent to the model. */
  instructions?: string | undefined;
  /** Tool output cap in characters. Defaults to 100 000. */
  maxToolResponseChars?: number | undefined;
}

export interface LaikaMcp {
  /** Route `/mcp` and `/.well-known/oauth-protected-resource*` requests here. */
  fetch(request: Request): Promise<Response>;
}

const jsonApiError = (error: AuthenticationError | NotFoundError, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify(errorToJsonApiMapper(error)), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json', ...headers },
  });

/**
 * Build the MCP HTTP surface as a plain fetch handler, consistent with how the
 * rest of `@laikacms/server` exposes handlers. See the module doc for the
 * routes served and the composition/ordering rules.
 */
export function laikaMcp(options: LaikaMcpOptions): LaikaMcp {
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const apiBasePath = Url.normalize(options.apiBasePath ?? '');
  const apiUrl = `${publicUrl}${apiBasePath}`;

  const app = new Hono();

  const wellKnown = (payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });

  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    app.get(path, () => wellKnown(protectedResourceMetadata(publicUrl, options.authorizationServers)));
  }

  app.all('/mcp', async c => {
    const authorization = c.req.header('Authorization');
    let principal: unknown;
    try {
      principal = await options.verifyBearer(authorization, c.req.raw);
    } catch {
      principal = null; // a throwing gate fails closed
    }
    if (principal === null || principal === undefined) {
      return jsonApiError(
        new AuthenticationError('A valid Bearer token is required.'),
        401,
        { 'WWW-Authenticate': `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"` },
      );
    }

    // Per-request (stateless) server: the caller's own Authorization header
    // rides along on every api_request dispatch, so the API's auth decides
    // what this principal may do — the MCP layer adds no authority.
    const server = createLaikaMcpServer({
      apiUrl,
      fetch: options.fetch,
      openApi: options.openApi,
      authorization: authorization as string,
      serverInfo: options.serverInfo,
      instructions: options.instructions,
      maxToolResponseChars: options.maxToolResponseChars,
    });
    // Lazy: the Streamable HTTP transport (and its hono/streaming graph) only
    // evaluates on the first authenticated /mcp request; the 401/discovery
    // surface above stays transport-free.
    const { StreamableHTTPTransport } = await import('@hono/mcp');
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    const response = await transport.handleRequest(c);
    return response ?? c.body(null, 406);
  });

  app.notFound(() => jsonApiError(new NotFoundError('Endpoint not found'), 404));

  return {
    async fetch(request: Request): Promise<Response> {
      return app.fetch(request);
    },
  };
}
