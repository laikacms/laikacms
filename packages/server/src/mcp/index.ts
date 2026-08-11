/**
 * MCP (Model Context Protocol) surface for Laika CMS.
 *
 * Two generic tools — `api_request` (an authenticated "curl" into the JSON:API)
 * and `read_api_spec` (the OpenAPI contract, indexed and sliced on demand) —
 * because the API is the product; see mcp-server.ts. `laikaMcp` mounts them
 * over Streamable HTTP with OAuth discovery metadata; `createLaikaMcpServer`
 * is the transport-agnostic factory (the `laika local mcp` CLI command
 * connects it to stdio).
 *
 * This subpath is the module's laziness boundary: importing it pulls the MCP
 * SDK and hono, so apps that don't speak MCP simply never import it.
 *
 * @module @laikacms/server/mcp
 */

export { createLaikaMcpServer, resolveApiRequestUrl } from './mcp-server.js';
export type { FetchHandler, LaikaMcpServerOptions } from './mcp-server.js';

export { laikaMcp, protectedResourceMetadata } from './mcp-routes.js';
export type { LaikaMcp, LaikaMcpOptions } from './mcp-routes.js';

export { buildLaikaApiOpenApi, combineOpenApiDocuments } from './openapi-combine.js';
export type { CombineOpenApiOptions, LaikaApiOpenApiOptions, OpenApiSource } from './openapi-combine.js';

export { buildSpecIndex, hasSliceFilter, readApiSpec, sliceOpenApiDocument } from './openapi-slice.js';
export type { OpenApiSliceArgs, OpenApiSliceResult } from './openapi-slice.js';
