import {
  BadRequestError,
  ErrorCodeToStatusMap,
  ErrorStatus,
  LaikaError,
  LaikaResult,
  NotFoundError,
} from '@laikacms/core';
import { DocumentsRepository } from '@laikacms/documents';
import {
  buildPaginationLinks,
  errorToJsonApiMapper,
  JsonApiCollectionResponse,
  JsonApiError,
  JsonApiResource,
  JsonApiResponse,
  parsePaginationQuery,
  schemaIssueFormatter,
} from '@laikacms/json-api';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';
import {
  documentCreateFromJsonApi,
  type DocumentCreateJsonApi,
  type DocumentJsonApi,
  type DocumentSummaryJsonApi,
  documentSummaryToJsonApi,
  documentToJsonApi,
  documentUpdateFromJsonApi,
  revisionCreateFromJsonApi,
  type RevisionCreateJsonApi,
  type RevisionJsonApi,
  type RevisionSummaryJsonApi,
  revisionSummaryToJsonApi,
  revisionToJsonApi,
  unpublishedCreateFromJsonApi,
  type UnpublishedCreateJsonApi,
  type UnpublishedJsonApi,
  type UnpublishedSummaryJsonApi,
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
    },
  });
};

// JSON:API error response
function respondError(result: LaikaResult<unknown>, status: ErrorStatus = 400) {
  if (Result.isSuccess(result)) throw new Error('respondError called with success result');
  return json(errorToJsonApiMapper(result), status);
}

// JSON:API success response for single resource
function respondResource<T, R extends JsonApiResource>(
  result: LaikaResult<T>,
  transformer: (data: T) => R,
) {
  if (Result.isFailure(result)) {
    // Check if this is a "not found" error and return 404
    const isNotFound = result.failure.code === NotFoundError.CODE
      || result.failure.message?.toLowerCase().includes('not found');
    return respondError(result, isNotFound ? 404 : 400);
  }
  // Wrap the resource in a "data" field per JSON:API spec
  return json({ data: transformer(result.success) });
}

// JSON:API success response for void result (delete operations)
function respondVoid(result: LaikaResult<void>) {
  if (Result.isFailure(result)) {
    return respondError(result);
  }
  return json({ meta: { deleted: true } });
}

// JSON:API success response for resource collection with pagination
async function respondCollection<T, R extends JsonApiResource>(
  request: Request,
  items: readonly T[],
  transformer: (item: T) => R,
  baseUrl: string,
) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const pagination = parsePaginationQuery(queryParams);
  let hasMore = false;
  let lastCursor: string | undefined;

  const links = buildPaginationLinks(baseUrl, pagination, hasMore, lastCursor);

  const response: JsonApiCollectionResponse = {
    data: items.map(transformer),
    links,
    meta: {
      page: {
        cursor: lastCursor,
        hasMore,
      },
    },
  };

  return json(response);
}

// Helper to get first result from async generator
async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  const { value, done } = await gen.next();
  if (done) {
    return Result.fail(new NotFoundError('No result returned'));
  }
  return value;
}

interface DocumentsApiOptions {
  repo: DocumentsRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
}

// Schema definitions using Effect Schema
const FolderFilterSchema = S.String.pipe(
  S.check(S.makeFilter<string>(s => /^[a-zA-Z0-9_/-]*$/.test(s) ? undefined : 'Invalid folder path')),
);

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

const UnpublishedQuerySchema = S.toStandardSchemaV1(S.Struct({
  'filter[status]': S.optional(S.String),
  'filter[folder]': S.optional(S.String),
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
const decodeUnpublishedQuery = S.decodeUnknownSync(UnpublishedQuerySchema);
const decodeDocumentCreateBody = S.decodeUnknownSync(DocumentCreateBodySchema);
const decodeUnpublishedCreateBody = S.decodeUnknownSync(UnpublishedCreateBodySchema);
const decodeUnpublishedUpdateBody = S.decodeUnknownSync(UnpublishedUpdateBodySchema);
const decodeUnpublishBody = S.decodeUnknownSync(UnpublishBodySchema);
const decodeRevisionCreateBody = S.decodeUnknownSync(RevisionCreateBodySchema);
const decodeOperations = S.decodeUnknownSync(OperationsSchema);

// Type aliases for decoded values
type RecordsQuery = S.Schema.Type<typeof RecordsQuerySchema>;
type UnpublishedQuery = S.Schema.Type<typeof UnpublishedQuerySchema>;
type AtomicOperation = S.Schema.Type<typeof AtomicOperationSchema>;
type AddUnpublishedOp = S.Schema.Type<typeof AddUnpublishedOpSchema>;
type AddDocumentOp = S.Schema.Type<typeof AddDocumentOpSchema>;
type StateTransitionOp = S.Schema.Type<typeof StateTransitionOpSchema>;
type UpdateUnpublishedOp = S.Schema.Type<typeof UpdateUnpublishedOpSchema>;
type RemoveOp = S.Schema.Type<typeof RemoveOpSchema>;

export function buildJsonApi(options: DocumentsApiOptions) {
  const { repo, onError, basePath = '' } = options;

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
            // TODO: Root endpoint - list available endpoints
            type: 'endpoints',
            id: 'documents-api',
            attributes: {
              endpoints: [
                'records',
                'record-summaries',
                'published',
                'unpublished',
                'unpublished-summaries',
                'revisions',
                'operations',
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

        const allResults: Array<{ type: string, key: string, [key: string]: unknown }> = [];
        for await (
          const result of repo.listRecords({
            pagination: parsePaginationQuery(queryParams),
            folder,
            type: type as 'published' | 'unpublished' | undefined,
            depth,
          })
        ) {
          if (Result.isFailure(result)) {
            return respondError(result);
          }
          allResults.push(...result.success);
        }

        console.log('Fetched records:', allResults);

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

        return json({ data: transformedResults });
      };

      const listRecordSummaries = async () => {
        const parsed = decodeRecordsQuery(queryParams);
        const type = parsed['filter[type]'] === 'all' ? undefined : (parsed['filter[type]'] ?? 'published');
        const folder = parsed['filter[folder]'] ?? '';
        const depth = parsed['filter[depth]'] ?? 1;

        const allResults: Array<{ type: string, key: string, [key: string]: unknown }> = [];
        for await (
          const result of repo.listRecordSummaries({
            pagination: parsePaginationQuery(queryParams),
            folder,
            type: type as 'published' | 'unpublished' | undefined,
            depth,
          })
        ) {
          if (Result.isFailure(result)) {
            return respondError(result);
          }
          allResults.push(...result.success);
        }

        console.log('Fetched record summaries:', allResults);

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

        return json({ data: transformedResults });
      };

      // ===== RECORDS =====
      if (resource === 'records' && request.method === 'GET') {
        return listFullRecords();
      }

      if (resource === 'record-summaries' && request.method === 'GET') {
        return listRecordSummaries();
      }

      // ===== DOCUMENTS (PUBLISHED) =====
      if (resource === 'published' && request.method === 'GET' && key) {
        return respondResource(
          await firstResult(repo.getDocument(key)),
          documentToJsonApi,
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
        return respondResource(
          await firstResult(repo.unpublish(key, data.attributes.status)),
          unpublishedToJsonApi,
        );
      }

      if (resource === 'published' && request.method === 'POST') {
        const body = await request.json();
        console.log(
          'Received document creation request:',
          JSON.stringify(body, null, 2),
        );
        const { data } = decodeDocumentCreateBody(body);
        const createData = documentCreateFromJsonApi({
          type: 'published',
          id: data.id ?? '',
          attributes: data.attributes,
        } as DocumentCreateJsonApi);
        return respondResource(
          await firstResult(repo.createDocument(createData)),
          documentToJsonApi,
        );
      }

      if (resource === 'published' && request.method === 'PATCH' && key) {
        const body = await request.json();
        const { data } = decodeDocumentCreateBody(body);
        const updateData = {
          key,
          ...data.attributes,
        };
        return respondResource(
          await firstResult(repo.updateDocument(updateData)),
          documentToJsonApi,
        );
      }

      if (resource === 'published' && request.method === 'DELETE' && key) {
        return respondVoid(await firstResult(repo.deleteDocument(key)));
      }

      if (resource === 'unpublished' && request.method === 'GET' && key) {
        return respondResource(
          await firstResult(repo.getUnpublished(key)),
          unpublishedToJsonApi,
        );
      }

      if (
        resource === 'unpublished'
        && action === 'publish'
        && request.method === 'POST'
        && key
      ) {
        return respondResource(
          await firstResult(repo.publish(key)),
          documentToJsonApi,
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
        return respondResource(
          await firstResult(repo.createUnpublished(createData)),
          unpublishedToJsonApi,
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
        return respondResource(
          await firstResult(repo.updateUnpublished({ ...updateData, key })),
          unpublishedToJsonApi,
        );
      }

      if (resource === 'unpublished' && request.method === 'DELETE' && key) {
        return respondVoid(await firstResult(repo.deleteUnpublished(key)));
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
        return respondResource(
          await firstResult(repo.createRevision(createData)),
          revisionToJsonApi,
        );
      }

      if (
        resource === 'revisions'
        && request.method === 'GET'
        && key
        && !action
      ) {
        const generator = repo.listRevisions(key, {
          pagination: parsePaginationQuery(queryParams),
        });

        const allResults: Array<unknown> = [];
        for await (const result of generator) {
          if (Result.isFailure(result)) {
            return respondError(result);
          }
          allResults.push(...result.success);
        }

        return respondCollection(
          request,
          allResults as Array<Parameters<typeof revisionSummaryToJsonApi>[0]>,
          revisionSummaryToJsonApi,
          request.url,
        );
      }

      if (
        resource === 'revisions'
        && request.method === 'GET'
        && key
        && action
      ) {
        return respondResource(
          await firstResult(repo.getRevision(key, action)),
          revisionToJsonApi,
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
                result = await firstResult(repo.createUnpublished(createData));
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
                result = await firstResult(repo.createDocument(createData));
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
                      result = await firstResult(repo.publish(ref.id));
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
                      result = await firstResult(repo.unpublish(
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
                result = await firstResult(repo.updateUnpublished(updateData));
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
                result = await firstResult(repo.deleteDocument(ref.id));
                transformer = null;
              } else if (ref.type === 'unpublished') {
                result = await firstResult(repo.deleteUnpublished(ref.id));
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

          // For remove operations, return meta instead of data
          if (operation.op === 'remove') {
            const removeOp = operation as RemoveOp;
            return {
              meta: {
                deleted: true,
                ref: removeOp.ref,
              },
            };
          }

          // For other operations, return the transformed data
          if (transformer) {
            return { data: transformer(op.success) };
          }

          return { data: null };
        });

        return json({
          'atomic:results': atomicResults,
        });
      }

      options.logger?.debug('Documents endpoint not found:', path);
      const error = new NotFoundError('Endpoint not found');

      console.log('error', Result.fail(error));

      return respondError(
        Result.fail(error),
        404,
      );
    },
  };
}
