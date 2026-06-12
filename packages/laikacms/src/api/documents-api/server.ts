import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';

import type { ErrorStatus, LaikaDone, LaikaResult } from 'laikacms/core';
import { BadRequestError, InternalError, LaikaError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type { DocumentsRepository } from 'laikacms/documents';
import type { JsonApiCollectionResponse, JsonApiError, JsonApiResource, JsonApiResponse } from 'laikacms/json-api';
import {
  buildPaginationLinks,
  errorToJsonApiMapper,
  parsePaginationQuery,
  recoverableErrorsToWarnings,
} from 'laikacms/json-api';
import {
  documentCreateFromJsonApi,
  type DocumentCreateJsonApi,
  documentSummaryToJsonApi,
  documentToJsonApi,
  revisionCreateFromJsonApi,
  type RevisionCreateJsonApi,
  revisionSummaryToJsonApi,
  revisionToJsonApi,
  unpublishedCreateFromJsonApi,
  type UnpublishedCreateJsonApi,
  unpublishedSummaryToJsonApi,
  unpublishedToJsonApi,
  unpublishedUpdateFromJsonApi,
  type UnpublishedUpdateJsonApi,
} from './jsonapi.js';

type AllJsonApiResponses =
  | JsonApiResponse
  | JsonApiCollectionResponse
  | JsonApiError;

const json = <
  T extends AllJsonApiResponses | { meta: Record<string, unknown> } | { 'atomic:results': unknown[] },
>(
  body: T,
  status: number = 200,
) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Cache-Control': 'no-store',
    },
  });
};

// JSON:API error response
function respondError(result: LaikaResult<unknown>, status: ErrorStatus = 400) {
  if (Result.isSuccess(result)) throw new Error('respondError called with success result');
  return json(errorToJsonApiMapper(result), status);
}

/**
 * Map a documents-api resource `type` to its canonical detail URL relative to
 * the API base path. Summaries inherit the URL of their full counterpart so
 * collection clients can follow a list item into detail without knowing the
 * route table.
 */
const docsSelfPathFor = (type: string, id: string): string | undefined => {
  const encoded = encodeURIComponent(id);
  switch (type) {
    case 'published':
    case 'published-summary':
      return `/published/${encoded}`;
    case 'unpublished':
    case 'unpublished-summary':
      return `/unpublished/${encoded}`;
    case 'revision':
    case 'revision-summary':
      return `/revisions/${encoded}`;
    case 'documents-capabilities':
      return `/capabilities`;
    default:
      return undefined;
  }
};

const withDocsSelfLink = <
  R extends { type: string, id: string, links?: Record<string, string> },
>(
  resource: R,
  basePath: string,
): R => {
  const path = docsSelfPathFor(resource.type, resource.id);
  if (!path) return resource;
  return { ...resource, links: { ...(resource.links ?? {}), self: `${basePath}${path}` } };
};

// JSON:API success response for single resource
function respondResource<T, R extends JsonApiResource>(
  result: LaikaResult<T>,
  transformer: (data: T) => R,
  basePath: string,
  recoverableErrors?: ReadonlyArray<LaikaError>,
) {
  if (Result.isFailure(result)) {
    // Check if this is a "not found" error and return 404
    const isNotFound = result.failure.code === NotFoundError.CODE
      || result.failure.message?.toLowerCase().includes('not found');
    return respondError(result, isNotFound ? 404 : 400);
  }
  const warnings = recoverableErrors ? recoverableErrorsToWarnings(recoverableErrors) : undefined;
  return json({
    data: withDocsSelfLink(transformer(result.success), basePath),
    ...(warnings ? { meta: { warnings } } : {}),
  });
}

/**
 * Run a LaikaTask and respond with the resulting resource — surfacing any
 * recoverable warnings (e.g. R2 readback fallback on writes, content-parse
 * fallback on reads) into `meta.warnings`. Equivalent to
 * `respondResource(await firstResult(...), ...)` but threads metadata through.
 */
async function respondResourceWithWarnings<T, R extends JsonApiResource>(
  task: LaikaTask.LaikaTask<T>,
  transformer: (data: T) => R,
  basePath: string,
) {
  const r = await firstResultWithMetadata(task);
  if (Result.isFailure(r)) {
    return respondResource(Result.fail(r.failure) as LaikaResult<T>, transformer, basePath);
  }
  return respondResource(
    Result.succeed(r.success.value),
    transformer,
    basePath,
    r.success.recoverableErrors,
  );
}

// JSON:API success response for void result (delete operations)
function respondVoid(result: LaikaResult<void>, recoverableErrors?: ReadonlyArray<LaikaError>) {
  if (Result.isFailure(result)) {
    return respondError(result);
  }
  const warnings = recoverableErrors ? recoverableErrorsToWarnings(recoverableErrors) : undefined;
  return json({ meta: { deleted: true, ...(warnings ? { warnings } : {}) } });
}

/**
 * Run a delete LaikaTask and respond via {@link respondVoid}, surfacing any
 * recoverableErrors emitted during the delete as `meta.warnings` (e.g. a
 * folder partially-removed-with-skipped-children warning).
 */
async function respondVoidWithWarnings(task: LaikaTask.LaikaTask<void>) {
  const r = await firstResultWithMetadata(task);
  if (Result.isFailure(r)) return respondVoid(Result.fail(r.failure) as LaikaResult<void>);
  return respondVoid(Result.succeed(undefined), r.success.recoverableErrors);
}

// JSON:API success response for resource collection with pagination
async function respondCollection<T, R extends JsonApiResource>(
  request: Request,
  items: readonly T[],
  transformer: (item: T) => R,
  baseUrl: string,
  basePath: string,
  done?: { total?: number },
  recoverableErrors?: ReadonlyArray<LaikaError>,
) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const pagination = parsePaginationQuery(queryParams);
  const last = items[items.length - 1] as { id?: string, key?: string } | undefined;
  const lastCursor: string | undefined = last?.id ?? last?.key;
  const requestedLimit = 'limit' in pagination
    ? pagination.limit
    : ('perPage' in pagination ? pagination.perPage : undefined);
  const hasMore = typeof requestedLimit === 'number'
    ? items.length === requestedLimit
    : false;

  const links = buildPaginationLinks(baseUrl, pagination, hasMore, lastCursor);

  // `meta.page` carries aggregate counts; `meta.warnings` carries per-item
  // recoverable errors collected during the stream.
  const warnings = recoverableErrors ? recoverableErrorsToWarnings(recoverableErrors) : undefined;
  const page = typeof done?.total === 'number' ? { total: done.total } : undefined;
  const meta = page || warnings ? { ...(page ? { page } : {}), ...(warnings ? { warnings } : {}) } : undefined;

  const response: JsonApiCollectionResponse = {
    data: items.map(item => withDocsSelfLink(transformer(item), basePath)),
    links,
    ...(meta ? { meta } : {}),
  };

  return json(response);
}

/** Convert any caught throw into a LaikaError, preserving LaikaError instances and wrapping defects in InternalError. */
function toLaikaError(err: unknown): LaikaError {
  if (err instanceof LaikaError) return err;
  if (err instanceof Error) return new InternalError(err.message, { cause: err });
  return new InternalError(String(err));
}

/**
 * Run a LaikaTask and surface the resolved value as a LaikaResult. Catches
 * both typed failures AND defects (e.g. `TypeError`s thrown by buggy impl
 * code) so route handlers always produce a JSON:API response instead of
 * leaking text/plain 500s to the framework.
 */
async function firstResult<T>(task: LaikaTask.LaikaTask<T>): Promise<LaikaResult<T>> {
  try {
    return await Effect.runPromise(Effect.result(LaikaTask.runValue(task)));
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
}

/**
 * Like {@link firstResult} but preserves any LaikaTask recoverableErrors so
 * the caller can surface them as `meta.warnings` on a single-resource
 * response — needed for the create/update routes where the backing impl
 * may emit recoverable warnings (e.g. R2 readback fallback after a write).
 */
async function firstResultWithMetadata<T>(
  task: LaikaTask.LaikaTask<T>,
): Promise<LaikaResult<{ value: T, recoverableErrors: ReadonlyArray<LaikaError> }>> {
  try {
    const r = await Effect.runPromise(Effect.result(LaikaTask.runCollect(task)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed({ value: r.success.value, recoverableErrors: r.success.recoverableErrors });
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
}

/**
 * Run a LaikaStream and collect data, the terminal `Done` value, and any
 * per-item recoverableErrors so we can surface `meta.page.total` and
 * `meta.warnings` on the JSON:API response. Catches defects, same as
 * {@link firstResult}.
 */
async function runStreamWithDone<A, D extends LaikaDone>(
  stream: LaikaStream.LaikaStream<A, D>,
): Promise<
  LaikaResult<{
    data: ReadonlyArray<A>,
    done: D,
    recoverableErrors: ReadonlyArray<LaikaError>,
  }>
> {
  try {
    const r = await Effect.runPromise(Effect.result(LaikaStream.runCollect(stream)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed({
      data: r.success.data,
      done: r.success.done,
      recoverableErrors: r.success.recoverableErrors,
    });
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
}

export interface DocumentsApiOptions {
  repo: DocumentsRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
}

// Schema definitions using Effect Schema
const RecordsQuerySchema = S.toStandardSchemaV1(S.Struct({
  'filter[type]': S.optional(S.Union([
    S.Literal('published'),
    S.Literal('unpublished'),
    S.Literal('all'),
  ])),
  'filter[folder]': S.optional(S.String),
  'filter[depth]': S.optional(S.NumberFromString.pipe(
    S.check(S.makeFilter<number>(n => n >= 1 ? undefined : 'Depth must be at least 1')),
  )),
}));

// JSON:API request body schemas
const DocumentCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: S.Struct({
    type: S.Literal('published'),
    id: S.optional(S.String),
    attributes: S.Record(S.String, S.Any),
  }),
}));

const UnpublishedCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: S.Struct({
    type: S.Literal('unpublished'),
    id: S.optional(S.String),
    attributes: S.Record(S.String, S.Any),
  }),
}));

const UnpublishedUpdateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: S.Struct({
    type: S.Literal('unpublished'),
    id: S.String,
    attributes: S.Record(S.String, S.Any),
  }),
}));

const UnpublishBodySchema = S.toStandardSchemaV1(S.Struct({
  data: S.Struct({
    type: S.Literal('unpublished'),
    attributes: S.Struct({
      status: S.String,
    }),
  }),
}));

const RevisionCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: S.Struct({
    type: S.Literal('revision'),
    id: S.optional(S.String),
    attributes: S.Record(S.String, S.Any),
  }),
}));

const RefSchema = S.toStandardSchemaV1(S.Struct({
  id: S.String,
  type: S.Union([
    S.Literal('document'),
    S.Literal('unpublished'),
    S.Literal('revision'),
  ]),
}));

// Atomic operation schemas
const AddUnpublishedOpSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('add'),
  data: S.Struct({
    type: S.Literal('unpublished'),
    id: S.optional(S.String),
    attributes: S.Record(S.String, S.Any),
  }),
}));

const AddDocumentOpSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('add'),
  data: S.Struct({
    type: S.Literal('published'),
    id: S.optional(S.String),
    attributes: S.Record(S.String, S.Any),
  }),
}));

const StateTransitionOpSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('update'),
  href: S.Union([S.Literal('/publish'), S.Literal('/unpublish')]),
  ref: RefSchema,
  data: S.optional(S.Struct({
    type: S.Literal('unpublished'),
    attributes: S.Struct({
      status: S.String,
    }),
  })),
}));

const UpdateUnpublishedOpSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('update'),
  data: S.Struct({
    type: S.Literal('unpublished'),
    id: S.String,
    attributes: S.Record(S.String, S.Any),
  }),
}));

const RemoveOpSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('remove'),
  ref: RefSchema,
}));

const AtomicOperationSchema = S.Union([
  AddUnpublishedOpSchema,
  AddDocumentOpSchema,
  StateTransitionOpSchema,
  UpdateUnpublishedOpSchema,
  RemoveOpSchema,
]);

const OperationsSchema = S.toStandardSchemaV1(S.Struct({
  'atomic:operations': S.Array(AtomicOperationSchema),
}));

// Decoders
const decodeRecordsQuery = S.decodeUnknownSync(RecordsQuerySchema);
const decodeDocumentCreateBody = S.decodeUnknownSync(DocumentCreateBodySchema);
const decodeUnpublishedCreateBody = S.decodeUnknownSync(UnpublishedCreateBodySchema);
const decodeUnpublishedUpdateBody = S.decodeUnknownSync(UnpublishedUpdateBodySchema);
const decodeUnpublishBody = S.decodeUnknownSync(UnpublishBodySchema);
const decodeRevisionCreateBody = S.decodeUnknownSync(RevisionCreateBodySchema);
const decodeOperations = S.decodeUnknownSync(OperationsSchema);

// Type aliases for decoded values
type AtomicOperation = S.Schema.Type<typeof AtomicOperationSchema>;
type AddUnpublishedOp = S.Schema.Type<typeof AddUnpublishedOpSchema>;
type AddDocumentOp = S.Schema.Type<typeof AddDocumentOpSchema>;
type StateTransitionOp = S.Schema.Type<typeof StateTransitionOpSchema>;
type UpdateUnpublishedOp = S.Schema.Type<typeof UpdateUnpublishedOpSchema>;
type RemoveOp = S.Schema.Type<typeof RemoveOpSchema>;

/**
 * Build a JSON:API handler for the documents repository.
 *
 * ⚠️ This handler ships **no authentication**. Wrap it (e.g. with
 * `laikacms/decap-api` or a custom middleware that validates a Bearer token)
 * before exposing it to an untrusted network — otherwise anyone who can reach
 * `fetch` can read, create, modify, publish, unpublish, and delete documents
 * and revisions.
 */
export function buildJsonApi(options: DocumentsApiOptions) {
  const { repo, basePath = '' } = options;

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      let path = url.pathname.substring(basePath.length);
      if (path.startsWith('/')) path = path.substring(1);
      if (path.endsWith('/')) path = path.slice(0, -1);

      // Root endpoint - list available endpoints
      if (path === '' && request.method === 'GET') {
        return json({
          data: {
            type: 'api-info',
            id: 'documents',
            attributes: {
              name: 'Documents API',
              version: '1.0.0',
              endpoints: [
                {
                  path: '/capabilities',
                  methods: ['GET'],
                  description: 'Underlying documents repository capabilities',
                },
                {
                  path: '/records',
                  methods: ['GET'],
                  description: 'List full records (published + unpublished view per key)',
                },
                {
                  path: '/record-summaries',
                  methods: ['GET'],
                  description: 'List record summaries (lightweight listing)',
                },
                {
                  path: '/published',
                  methods: ['POST'],
                  description: 'Create a published document',
                },
                {
                  path: '/published/{key}',
                  methods: ['GET', 'PATCH', 'DELETE'],
                  description: 'Read, update, or remove a published document',
                },
                {
                  path: '/published/{key}/unpublish',
                  methods: ['POST'],
                  description: 'State transition: move a published document to unpublished',
                },
                {
                  path: '/unpublished',
                  methods: ['POST'],
                  description: 'Create an unpublished draft',
                },
                {
                  path: '/unpublished/{key}',
                  methods: ['GET', 'PATCH', 'DELETE'],
                  description: 'Read, update, or remove an unpublished draft',
                },
                {
                  path: '/unpublished/{key}/publish',
                  methods: ['POST'],
                  description: 'State transition: publish an unpublished draft',
                },
                {
                  path: '/revisions',
                  methods: ['POST'],
                  description: 'Create a revision for a document',
                },
                {
                  path: '/revisions/{key}',
                  methods: ['GET'],
                  description: 'List revisions for a document',
                },
                {
                  path: '/revisions/{key}/{revisionId}',
                  methods: ['GET'],
                  description: 'Read a specific revision of a document',
                },
                {
                  path: '/operations',
                  methods: ['POST'],
                  description: 'Atomic operations (add/update/remove + publish/unpublish transitions)',
                },
              ],
            },
          },
        });
      }

      const pathParts = path.split('/');
      const resource = pathParts[0];
      const key = pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined;
      const action = pathParts[2];

      const queryParams = Object.fromEntries(url.searchParams.entries());

      const listFullRecords = async () => {
        const parsed = decodeRecordsQuery(queryParams);
        const type = parsed['filter[type]'] === 'all' ? undefined : (parsed['filter[type]'] ?? 'published');
        const folder = parsed['filter[folder]'] ?? '';
        const depth = parsed['filter[depth]'] ?? 1;

        const result = await runStreamWithDone(
          repo.listRecords({
            pagination: parsePaginationQuery(queryParams),
            folder,
            type: type as 'published' | 'unpublished' | undefined,
            depth,
          }),
        );
        if (Result.isFailure(result)) return respondError(result);
        const allResults = result.success.data as ReadonlyArray<{
          type: string,
          key: string,
          [key: string]: unknown,
        }>;

        // `respondCollection` adds per-item `links.self`, the collection's
        // pagination links, and `meta.page.total` from the stream's Done.
        // Per-entry type drives which converter we apply up front; the
        // collection helper then applies the self-link decorator.
        const transformedResults = allResults.map(entry => {
          switch (entry.type) {
            case 'published':
              return documentToJsonApi(entry as Parameters<typeof documentToJsonApi>[0]);
            case 'unpublished':
              return unpublishedToJsonApi(entry as Parameters<typeof unpublishedToJsonApi>[0]);
            default:
              throw new Error(`Unknown entry type: ${entry.type}`);
          }
        });

        return respondCollection(
          request,
          transformedResults,
          r => r,
          request.url,
          basePath,
          { total: result.success.done.total },
          result.success.recoverableErrors,
        );
      };

      const listRecordSummaries = async () => {
        const parsed = decodeRecordsQuery(queryParams);
        const type = parsed['filter[type]'] === 'all' ? undefined : (parsed['filter[type]'] ?? 'published');
        const folder = parsed['filter[folder]'] ?? '';
        const depth = parsed['filter[depth]'] ?? 1;

        const result = await runStreamWithDone(
          repo.listRecordSummaries({
            pagination: parsePaginationQuery(queryParams),
            folder,
            type: type as 'published' | 'unpublished' | undefined,
            depth,
          }),
        );
        if (Result.isFailure(result)) return respondError(result);
        const allResults = result.success.data as ReadonlyArray<{
          type: string,
          key: string,
          [key: string]: unknown,
        }>;

        const transformedResults = allResults.map(entry => {
          switch (entry.type) {
            case 'published':
              return documentSummaryToJsonApi(
                { ...entry, type: 'published-summary' } as Parameters<typeof documentSummaryToJsonApi>[0],
              );
            case 'unpublished':
              return unpublishedSummaryToJsonApi(
                { ...entry, type: 'unpublished-summary' } as Parameters<typeof unpublishedSummaryToJsonApi>[0],
              );
            default:
              throw new Error(`Unknown entry type: ${entry.type}`);
          }
        });

        return respondCollection(
          request,
          transformedResults,
          r => r,
          request.url,
          basePath,
          { total: result.success.done.total },
          result.success.recoverableErrors,
        );
      };

      // ===== CAPABILITIES =====
      // Mirror of /storage-api's `/capabilities`: surface the documents repo's
      // own capabilities so the proxy client can introspect what's supported.
      if (resource === 'capabilities' && request.method === 'GET') {
        const result = await firstResult(repo.getCapabilities());
        if (Result.isFailure(result)) {
          return respondError(result);
        }
        return json({
          data: {
            type: 'documents-capabilities',
            id: 'self',
            attributes: result.success,
            links: { self: `${basePath}/capabilities` },
          },
        });
      }

      // ===== RECORDS =====
      if (resource === 'records' && request.method === 'GET') {
        return listFullRecords();
      }

      if (resource === 'record-summaries' && request.method === 'GET') {
        return listRecordSummaries();
      }

      // ===== DOCUMENTS (PUBLISHED) =====
      if (resource === 'published' && request.method === 'GET' && key) {
        return respondResourceWithWarnings(
          repo.getDocument(key),
          documentToJsonApi,
          basePath,
        );
      }

      if (
        resource === 'published'
        && action === 'unpublish'
        && request.method === 'POST'
        && key
      ) {
        const body = await request.json();
        const { data } = decodeUnpublishBody(body);
        return respondResourceWithWarnings(
          repo.unpublish(key, data.attributes.status),
          unpublishedToJsonApi,
          basePath,
        );
      }

      if (resource === 'published' && request.method === 'POST') {
        const body = await request.json();
        const { data } = decodeDocumentCreateBody(body);
        const createData = documentCreateFromJsonApi({
          type: 'published',
          id: data.id ?? '',
          attributes: data.attributes,
        } as DocumentCreateJsonApi);
        return respondResourceWithWarnings(
          repo.createDocument(createData),
          documentToJsonApi,
          basePath,
        );
      }

      if (resource === 'published' && request.method === 'PATCH' && key) {
        const body = await request.json();
        const { data } = decodeDocumentCreateBody(body);
        const updateData = {
          key,
          ...data.attributes,
        };
        return respondResourceWithWarnings(
          repo.updateDocument(updateData),
          documentToJsonApi,
          basePath,
        );
      }

      if (resource === 'published' && request.method === 'DELETE' && key) {
        return respondVoidWithWarnings(repo.deleteDocument(key));
      }

      if (resource === 'unpublished' && request.method === 'GET' && key) {
        return respondResourceWithWarnings(
          repo.getUnpublished(key),
          unpublishedToJsonApi,
          basePath,
        );
      }

      if (
        resource === 'unpublished'
        && action === 'publish'
        && request.method === 'POST'
        && key
      ) {
        return respondResourceWithWarnings(
          repo.publish(key),
          documentToJsonApi,
          basePath,
        );
      }

      if (resource === 'unpublished' && request.method === 'POST') {
        const body = await request.json();
        const { data } = decodeUnpublishedCreateBody(body);
        const createData = unpublishedCreateFromJsonApi({
          type: 'unpublished',
          id: data.id ?? '',
          attributes: data.attributes,
        } as UnpublishedCreateJsonApi);
        return respondResourceWithWarnings(
          repo.createUnpublished(createData),
          unpublishedToJsonApi,
          basePath,
        );
      }

      if (resource === 'unpublished' && request.method === 'PATCH' && key) {
        const body = await request.json();
        const { data: bodyData } = decodeUnpublishedUpdateBody(body);
        const updateData = unpublishedUpdateFromJsonApi({
          type: 'unpublished',
          id: bodyData.id,
          attributes: bodyData.attributes,
        } as UnpublishedUpdateJsonApi);
        return respondResourceWithWarnings(
          repo.updateUnpublished({ ...updateData, key }),
          unpublishedToJsonApi,
          basePath,
        );
      }

      if (resource === 'unpublished' && request.method === 'DELETE' && key) {
        return respondVoidWithWarnings(repo.deleteUnpublished(key));
      }

      // ===== REVISIONS =====
      if (resource === 'revisions' && request.method === 'POST') {
        const body = await request.json();
        const { data } = decodeRevisionCreateBody(body);
        const createData = revisionCreateFromJsonApi({
          type: 'revision',
          id: data.id ?? '',
          attributes: data.attributes,
        } as RevisionCreateJsonApi);
        return respondResourceWithWarnings(
          repo.createRevision(createData),
          revisionToJsonApi,
          basePath,
        );
      }

      if (
        resource === 'revisions'
        && request.method === 'GET'
        && key
        && !action
      ) {
        const result = await runStreamWithDone(
          repo.listRevisions(key, { pagination: parsePaginationQuery(queryParams) }),
        );
        if (Result.isFailure(result)) return respondError(result);

        return respondCollection(
          request,
          result.success.data as ReadonlyArray<Parameters<typeof revisionSummaryToJsonApi>[0]>,
          revisionSummaryToJsonApi,
          request.url,
          basePath,
          { total: result.success.done.total },
          result.success.recoverableErrors,
        );
      }

      if (
        resource === 'revisions'
        && request.method === 'GET'
        && key
        && action
      ) {
        return respondResourceWithWarnings(
          repo.getRevision(key, action),
          revisionToJsonApi,
          basePath,
        );
      }

      // ===== ATOMIC OPERATIONS =====
      if (resource === 'operations' && request.method === 'POST') {
        const body = await request.json();
        const parsedBody = decodeOperations(body);

        const atomicOperations = parsedBody['atomic:operations'].map(
          async (operation: AtomicOperation) => {
            let result: LaikaResult<unknown>;
            let transformer: ((data: unknown) => JsonApiResource) | null = null;

            if (operation.op === 'add') {
              if (
                'data' in operation
                && operation.data.type === 'unpublished'
              ) {
                const op = operation as AddUnpublishedOp;
                const createData = unpublishedCreateFromJsonApi({
                  type: 'unpublished',
                  id: op.data.id ?? '',
                  attributes: op.data.attributes,
                } as UnpublishedCreateJsonApi);
                result = await firstResultWithMetadata(repo.createUnpublished(createData));
                transformer = unpublishedToJsonApi as (data: unknown) => JsonApiResource;
              } else if (
                'data' in operation
                && operation.data.type === 'published'
              ) {
                const op = operation as AddDocumentOp;
                const createData = documentCreateFromJsonApi({
                  type: 'published',
                  id: op.data.id ?? '',
                  attributes: op.data.attributes,
                } as DocumentCreateJsonApi);
                result = await firstResultWithMetadata(repo.createDocument(createData));
                transformer = documentToJsonApi as (data: unknown) => JsonApiResource;
              } else {
                result = Result.fail(
                  new BadRequestError(
                    `Cannot add type: ${(operation as { data?: { type?: string } }).data?.type}`,
                  ),
                );
              }
              return { op: result, operation, transformer };
            }

            if (operation.op === 'update') {
              if ('href' in operation && 'ref' in operation) {
                // State transition operation
                const { href, ref, data } = operation as StateTransitionOp;
                switch (href) {
                  case '/publish':
                    if (ref.type === 'unpublished') {
                      result = await firstResultWithMetadata(repo.publish(ref.id));
                      transformer = documentToJsonApi as (data: unknown) => JsonApiResource;
                    } else {
                      result = Result.fail(
                        new BadRequestError(
                          `Cannot publish ${ref.type}`,
                        ),
                      );
                    }
                    break;
                  case '/unpublish':
                    if (ref.type === 'document') {
                      if (!data) {
                        result = Result.fail(
                          new BadRequestError(
                            `Missing data for unpublish operation`,
                          ),
                        );
                        break;
                      }
                      result = await firstResultWithMetadata(repo.unpublish(
                        ref.id,
                        data.attributes.status,
                      ));
                      transformer = unpublishedToJsonApi as (data: unknown) => JsonApiResource;
                    } else {
                      result = Result.fail(
                        new BadRequestError(
                          `Cannot unpublish ${ref.type}`,
                        ),
                      );
                    }
                    break;
                  default:
                    result = Result.fail(
                      new BadRequestError(
                        `Unknown action: ${href}`,
                      ),
                    );
                }
              } else if ('data' in operation) {
                // Update content operation
                const op = operation as UpdateUnpublishedOp;
                const updateData = unpublishedUpdateFromJsonApi({
                  type: 'unpublished',
                  id: op.data.id,
                  attributes: op.data.attributes,
                } as UnpublishedUpdateJsonApi);
                result = await firstResultWithMetadata(repo.updateUnpublished(updateData));
                transformer = unpublishedToJsonApi as (data: unknown) => JsonApiResource;
              } else {
                result = Result.fail(
                  new BadRequestError(
                    'Invalid update operation',
                  ),
                );
              }
              return { op: result, operation, transformer };
            }

            if (operation.op === 'remove') {
              const { ref } = operation as RemoveOp;
              if (ref.type === 'document') {
                result = await firstResultWithMetadata(repo.deleteDocument(ref.id));
                transformer = null;
              } else if (ref.type === 'unpublished') {
                result = await firstResultWithMetadata(repo.deleteUnpublished(ref.id));
                transformer = null;
              } else {
                result = Result.fail(
                  new BadRequestError(
                    `Cannot remove ${ref.type}`,
                  ),
                );
              }
              return { op: result, operation, transformer };
            }

            return {
              op: Result.fail(
                new BadRequestError(
                  `Unsupported operation: ${(operation as { op?: string }).op}`,
                ),
              ),
              operation,
              transformer: null,
            };
          },
        );

        const atomicsSettled = await Promise.allSettled(atomicOperations);

        const atomicResults = atomicsSettled.map(promiseResult => {
          if (promiseResult.status === 'rejected') {
            return {
              errors: [
                {
                  status: '500',
                  title: 'Operation Failed',
                  detail: promiseResult.reason.message,
                },
              ],
            };
          }

          const { op, operation, transformer } = promiseResult.value;

          if (Result.isFailure(op)) {
            const failure = op.failure as LaikaError;
            return {
              errors: [
                {
                  status: '400',
                  title: 'Operation Failed',
                  detail: failure.message,
                },
              ],
            };
          }

          // For remove operations, return meta instead of data. When the
          // underlying delete task emitted recoverable warnings (e.g. an
          // orphaned sidecar that couldn't be cleaned up), surface them via
          // meta.warnings on this entry.
          if (operation.op === 'remove') {
            const removeOp = operation as RemoveOp;
            // op.success here is {value: void, recoverableErrors: [...]} from
            // firstResultWithMetadata when ref.type is document/unpublished,
            // or `undefined` when the route fell through to a fail branch.
            const carrier = op.success as
              | { value: void, recoverableErrors: ReadonlyArray<LaikaError> }
              | undefined;
            const warnings = carrier
              ? recoverableErrorsToWarnings(carrier.recoverableErrors)
              : undefined;
            return {
              meta: warnings
                ? { deleted: true, ref: removeOp.ref, warnings }
                : { deleted: true, ref: removeOp.ref },
            };
          }

          // For other operations, the success now carries {value,
          // recoverableErrors} from firstResultWithMetadata. Surface per-op
          // recoverable warnings under each result's `meta.warnings` so a
          // single atomic batch can report partial-success state per row.
          if (transformer) {
            const carrier = op.success as {
              value: unknown,
              recoverableErrors: ReadonlyArray<LaikaError>,
            };
            const warnings = recoverableErrorsToWarnings(carrier.recoverableErrors);
            const data = transformer(carrier.value);
            return warnings ? { data, meta: { warnings } } : { data };
          }

          return { data: null };
        });

        return json({
          'atomic:results': atomicResults,
        });
      }

      options.logger?.debug('Documents endpoint not found:', path);
      const error = new NotFoundError('Endpoint not found');

      return respondError(
        Result.fail(error),
        404,
      );
    },
  };
}
