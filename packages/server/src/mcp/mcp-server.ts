/**
 * The MCP server itself: a `@modelcontextprotocol/sdk` `Server` with
 * deliberately almost no tools, because the API is the product.
 *
 *  - `api_request` is a generic authenticated "curl" that dispatches into a
 *    caller-provided `fetch` handler — in-process when that handler is
 *    `laikaApi(...).fetch` (no network hop, every server-side gate applies
 *    unchanged), or a real network fetch when a CLI proxies a remote
 *    deployment.
 *  - `read_api_spec` serves the OpenAPI contract so the model can discover the
 *    surface instead of guessing — as an operation index by default and as a
 *    `$ref`-closed slice on demand, because the whole document costs more
 *    context than the work it enables (see openapi-slice.ts).
 *
 * Transport-agnostic: `laikaMcp` (mcp-routes.ts) connects it to Streamable
 * HTTP, the `laika local mcp` CLI command connects it to stdio.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { OpenApiDocument } from 'laikacms/json-api';
import { type OpenApiSliceArgs, readApiSpec } from './openapi-slice.js';

/**
 * A WHATWG fetch handler — the same shape `laikaApi(...).fetch` and
 * `createEmbeddedLaika(...).fetch` expose, and what `globalThis.fetch` degrades
 * to when the target is remote.
 */
export type FetchHandler = (request: Request) => Promise<Response>;

/** Cap tool output so a huge record listing cannot blow up the model context. */
const DEFAULT_MAX_TOOL_RESPONSE_CHARS = 100_000;

const API_REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface ApiRequestArgs {
  method?: unknown;
  path?: unknown;
  query?: unknown;
  body?: unknown;
}

/** Keep only the slice filters, in the shape openapi-slice expects. */
function toSliceArgs(raw: unknown): OpenApiSliceArgs {
  const args = (raw ?? {}) as Record<string, unknown>;
  const paths = Array.isArray(args.paths)
    ? args.paths.filter((path): path is string => typeof path === 'string')
    : typeof args.paths === 'string'
    ? [args.paths]
    : undefined;
  return {
    ...(paths?.length ? { paths } : {}),
    ...(typeof args.tag === 'string' && args.tag ? { tag: args.tag } : {}),
    ...(typeof args.search === 'string' && args.search ? { search: args.search } : {}),
  };
}

/**
 * Normalize-then-check path gate for `api_request`. Normalizing FIRST is what
 * makes `${basePath}/../oauth2/token` fail the check — the URL parser collapses
 * dot segments, so the gate sees the real target path. `apiUrl` is the absolute
 * URL of the JSON:API root (origin + base path); the resolved request must stay
 * on its origin and under its path.
 */
export function resolveApiRequestUrl(apiUrl: string, path: string): URL | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  let base: URL;
  let url: URL;
  try {
    base = new URL(apiUrl);
    url = new URL(path, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const prefix = base.pathname.replace(/\/+$/, '');
  if (prefix !== '' && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  return url;
}

export interface LaikaMcpServerOptions {
  /**
   * Absolute URL of the JSON:API root the tools may reach — origin plus base
   * path, e.g. `'https://cms.example.com/api'`. `api_request` paths resolve
   * against its origin and are gated to its path; for a purely in-process
   * handler any private origin works (the CLI uses `'http://laika.local'`).
   */
  apiUrl: string;
  /**
   * Where `api_request` sends its requests: an in-process handler
   * (`laikaApi(...).fetch`) for zero-hop dispatch, or a real network fetch
   * when proxying a remote deployment.
   */
  fetch: FetchHandler;
  /** The OpenAPI contract `read_api_spec` serves — see `combineOpenApiDocuments` / `buildLaikaApiOpenApi`. */
  openApi: OpenApiDocument;
  /**
   * `Authorization` header value attached to every `api_request` dispatch —
   * the HTTP mount forwards the MCP caller's own bearer, the CLI passes
   * `Bearer <token>` for remote targets, and in-process handlers with their
   * own auth seam may need none.
   */
  authorization?: string | undefined;
  /** Server identity advertised to MCP clients. Defaults to `laikacms`. */
  serverInfo?: { name: string, version: string } | undefined;
  /** Override the default usage instructions sent to the model. */
  instructions?: string | undefined;
  /** Tool output cap in characters. Defaults to 100 000. */
  maxToolResponseChars?: number | undefined;
}

const defaultInstructions = (basePath: string): string =>
  "Access to a Laika CMS JSON:API deployment; requests run with the caller's authority. Call read_api_spec with no "
  + 'arguments for an index of the API surface (OpenAPI 3.1), then call it again with paths/tag/search for the full '
  + 'schema of the operations you actually need. Use api_request for everything else: paths are absolute under the '
  + `${basePath || '/'} base, e.g. GET ${basePath}/documents/records?filter[folder]=posts. `
  + 'Mutations are real - confirm with the user before POST/PUT/PATCH/DELETE.';

/**
 * Build the two-tool Laika CMS MCP server. Stateless and cheap: the HTTP mount
 * builds one per request, the stdio CLI builds one per process.
 */
export function createLaikaMcpServer(options: LaikaMcpServerOptions): Server {
  const { apiUrl, fetch, openApi, authorization, maxToolResponseChars } = options;
  const basePath = new URL(apiUrl).pathname.replace(/\/+$/, '');
  const maxChars = maxToolResponseChars ?? DEFAULT_MAX_TOOL_RESPONSE_CHARS;

  const server = new Server(
    options.serverInfo ?? { name: 'laikacms', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: options.instructions ?? defaultInstructions(basePath),
    },
  );

  const tools = [
    {
      name: 'api_request',
      description:
        "Perform an authenticated HTTP request against the Laika CMS JSON:API (like curl with the caller's Bearer "
        + `token attached). Only paths under ${basePath || '/'} are allowed. Read the OpenAPI spec via read_api_spec `
        + 'to discover endpoints. Responses are JSON; bodies must be JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: [...API_REQUEST_METHODS], description: 'HTTP method.' },
          path: {
            type: 'string',
            description: `Absolute API path starting with ${basePath || '/'}, e.g. "${basePath}/documents/records".`,
          },
          query: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
            description: 'Optional query parameters.',
          },
          body: { description: 'Optional JSON request body (for POST/PUT/PATCH).' },
        },
        required: ['method', 'path'],
      },
    },
    {
      name: 'read_api_spec',
      description: 'Read the OpenAPI 3.1 contract for the Laika CMS JSON:API - the source of truth for every endpoint, '
        + 'parameter and schema api_request can reach. Called with no arguments it returns a compact INDEX of every '
        + 'operation (method, path, summary); pass paths/tag/search to get the full contract for just those '
        + 'operations. The whole document is far too large to read at once, so: index first, then slice.',
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              `Paths to expand, e.g. ["/documents/published/{key}"]. The ${basePath || '/'} prefix is optional and a `
              + 'prefix match includes sub-paths ("/documents/published" also returns "/documents/published/{key}").',
          },
          tag: { type: 'string', description: 'Only operations with this tag (see the index headings).' },
          search: {
            type: 'string',
            description: 'Only operations whose path, summary, description or operationId contains this text.',
          },
        },
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const textResult = (text: string, isError = false) => ({ content: [{ type: 'text', text }], isError });

    try {
      if (request.params.name === 'read_api_spec') {
        return textResult(readApiSpec(openApi, toSliceArgs(request.params.arguments)));
      }

      if (request.params.name !== 'api_request') {
        return textResult(`Unknown tool: ${request.params.name}`, true);
      }

      const args = (request.params.arguments ?? {}) as ApiRequestArgs;
      const method = typeof args.method === 'string' ? args.method.toUpperCase() : '';
      if (!(API_REQUEST_METHODS as readonly string[]).includes(method)) {
        return textResult(`Invalid method. Use one of: ${API_REQUEST_METHODS.join(', ')}.`, true);
      }

      const url = resolveApiRequestUrl(apiUrl, typeof args.path === 'string' ? args.path : '');
      if (!url) {
        return textResult(
          `Invalid path: must be an absolute path under ${basePath || '/'} (see read_api_spec).`,
          true,
        );
      }
      if (args.query && typeof args.query === 'object') {
        for (const [key, value] of Object.entries(args.query as Record<string, unknown>)) {
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
      }

      const headers: Record<string, string> = {
        Accept: 'application/vnd.api+json, application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      };
      let body: string | undefined;
      if (args.body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(args.body);
      }

      const response = await fetch(new Request(url.toString(), { method, headers, body }));
      let text = await response.text();
      if (text.length > maxChars) {
        text = `${text.slice(0, maxChars)}\n… [truncated at ${maxChars} chars - use pagination parameters]`;
      }
      return textResult(`HTTP ${response.status}\n${text}`, response.status >= 400);
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), true);
    }
  });

  return server;
}
