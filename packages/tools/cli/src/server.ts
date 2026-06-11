import { NodeHttpServer } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpRouter from 'effect/unstable/http/HttpRouter';
import type * as HttpServerError from 'effect/unstable/http/HttpServerError';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';
import { createServer } from 'node:http';

import type { StorageSerializerRegistry } from 'laikacms/storage';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

export interface LocalStorageServerOptions {
  /** Filesystem path the storage repository roots at. */
  root: string;
  /** Listen port. */
  port: number;
  /** Listen host. Defaults to `127.0.0.1`. */
  host?: string;
  /** Default file extension for newly-created objects. Defaults to `md`. */
  defaultExtension?: string;
  /** If set, require `Authorization: Bearer <token>` on every request. */
  authToken?: string;
  /**
   * Override the serializer registry. Defaults to markdown / yaml / json so the
   * common dev cases work out of the box.
   */
  serializerRegistry?: StorageSerializerRegistry;
}

const DEFAULT_SERIALIZERS: StorageSerializerRegistry = {
  md: markdownSerializer,
  markdown: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
};

/**
 * Bearer-token gate baked into the catch-all route. No-op when `token` is
 * undefined.
 */
const checkAuth = (
  request: HttpServerRequest.HttpServerRequest,
  token: string | undefined,
): HttpServerResponse.HttpServerResponse | undefined => {
  if (!token) return undefined;
  if (request.headers.authorization === `Bearer ${token}`) return undefined;
  return HttpServerResponse.jsonUnsafe(
    { errors: [{ status: '401', title: 'Unauthorized' }] },
    { status: 401 },
  );
};

/**
 * Build the Layer for the catch-all route that forwards every request into
 * laikacms's JSON:API handler. The handler is `(Request) => Promise<Response>`,
 * so we convert at the boundary with `HttpServerRequest.toWeb` /
 * `HttpServerResponse.fromWeb`.
 */
const buildRoutes = (options: LocalStorageServerOptions) => {
  const storage = new FileSystemStorageRepository(
    options.root,
    options.serializerRegistry ?? DEFAULT_SERIALIZERS,
    options.defaultExtension ?? 'md',
  );
  const api = buildJsonApi({ repo: storage, logger: console });

  return HttpRouter.add(
    '*',
    '/*',
    Effect.fn('storage-api.handle')(function*(request: HttpServerRequest.HttpServerRequest) {
      const denied = checkAuth(request, options.authToken);
      if (denied) return denied;
      const webReq = yield* HttpServerRequest.toWeb(request);
      const webRes = yield* Effect.promise(() => api.fetch(webReq));
      return HttpServerResponse.fromWeb(webRes);
    }),
  );
};

/**
 * Layer that runs the JSON:API storage server until interrupted.
 *
 * Compose with `Layer.launch` (or `NodeRuntime.runMain` of a workflow that
 * depends on this layer).
 */
export const layerStorageServer = (
  options: LocalStorageServerOptions,
): Layer.Layer<never, HttpServerError.ServeError> => {
  const host = options.host ?? '127.0.0.1';
  const Routes = buildRoutes(options);
  const App = Layer.mergeAll(Routes, HttpRouter.cors());
  return HttpRouter.serve(App).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: options.port, host })),
  );
};
