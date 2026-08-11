/**
 * `laika local mcp` — the Laika CMS MCP server over stdio, for Claude Code /
 * Claude Desktop and any other stdio MCP client.
 *
 * Reuses the two-tool server from `@laikacms/server/mcp` (`api_request` +
 * `read_api_spec`) and only decides where `api_request` lands:
 *
 *  - default: the same local-file JSON:API `laika local serve` exposes,
 *    dispatched in-process (no HTTP server, no port);
 *  - `--base-url`: a remote Laika CMS JSON:API over real fetch, with the
 *    caller's `--auth-token` attached as a Bearer.
 *
 * IMPORTANT for anything touched from this module: stdout belongs to the MCP
 * protocol. Diagnostics must go to stderr or they corrupt the JSON-RPC stream.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildLaikaApiOpenApi, createLaikaMcpServer, type FetchHandler } from '@laikacms/server/mcp';
import { allowAll } from 'laikacms/json-api';
import type { StorageSerializerRegistry } from 'laikacms/storage';
import { buildJsonApi, buildStorageOpenApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * Private origin for the in-process handler. Never resolved over the network —
 * it only exists because `api_request` paths must resolve against some URL.
 */
const LOCAL_ORIGIN = 'http://laika.local';

const DEFAULT_SERIALIZERS: StorageSerializerRegistry = {
  md: markdownSerializer,
  markdown: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  raw: rawSerializer,
};

export interface LocalMcpServerOptions {
  /** Filesystem path the storage repository roots at. */
  root: string;
  /** Default file extension for newly-created objects. Defaults to `md`. */
  defaultExtension?: string;
  /**
   * Override the serializer registry. Defaults to markdown / yaml / json so the
   * common dev cases work out of the box.
   */
  serializerRegistry?: StorageSerializerRegistry;
}

/**
 * MCP server over the local-file storage JSON:API — the stdio twin of
 * `laika local serve`, dispatching in-process instead of listening on a port.
 * Access control is the process boundary: whoever can spawn this server can
 * read the files anyway, so the JSON:API allows all (same stance as `serve`
 * without `--auth-token`).
 */
export const buildLocalMcpServer = (options: LocalMcpServerOptions): Server => {
  const storage = new FileSystemStorageRepository(
    options.root,
    options.serializerRegistry ?? DEFAULT_SERIALIZERS,
    options.defaultExtension ?? 'md',
  );
  // No logger: the default console logger writes to stdout, which stdio MCP
  // reserves for the protocol.
  const api = buildJsonApi({ repo: storage, authorize: allowAll });
  return createLaikaMcpServer({
    apiUrl: LOCAL_ORIGIN,
    fetch: api.fetch,
    openApi: buildStorageOpenApi(),
    instructions: 'Access to a local-file Laika CMS storage JSON:API rooted at a directory on this machine. '
      + 'Call read_api_spec with no arguments for an index of the API surface (OpenAPI 3.1), then call it again with '
      + 'paths/tag/search for the operations you need. Use api_request for everything else. Writes hit the real '
      + 'files - confirm with the user before POST/PUT/PATCH/DELETE.',
  });
};

export interface RemoteMcpServerOptions {
  /** Absolute URL of the remote JSON:API root, e.g. `https://cms.example.com/api`. */
  baseUrl: string;
  /** Bearer token attached to every `api_request` (`Authorization: Bearer <token>`). */
  authToken?: string;
  /** Seam for tests; production uses the runtime's `fetch`. */
  fetch?: FetchHandler;
}

/**
 * MCP server proxying a remote Laika CMS JSON:API (`laikaApi`) over real
 * fetch. The remote deployment's own authentication and `authorize` policy
 * decide what the token may do.
 */
export const buildRemoteMcpServer = (options: RemoteMcpServerOptions): Server => {
  const apiUrl = new URL(options.baseUrl).toString().replace(/\/+$/, '');
  const basePath = new URL(apiUrl).pathname.replace(/\/+$/, '');
  return createLaikaMcpServer({
    apiUrl,
    fetch: options.fetch ?? (request => globalThis.fetch(request)),
    openApi: buildLaikaApiOpenApi({ basePath }),
    authorization: options.authToken ? `Bearer ${options.authToken}` : undefined,
  });
};

/**
 * Serve `server` over stdio until the client disconnects (stdin closes) or
 * `signal` aborts. Resolves on clean shutdown.
 */
export const runMcpStdioServer = (server: Server, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transport = new StdioServerTransport();
    server.onclose = () => resolve();
    signal?.addEventListener('abort', () => {
      void server.close().then(resolve, reject);
    });
    server.connect(transport).catch((error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
