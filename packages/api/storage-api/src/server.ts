import type { ErrorStatus, LaikaResult } from '@laikacms/core';
import { ErrorCodeToStatusMap, InternalError, InvalidData, NotFoundError } from '@laikacms/core';
import type { JsonApiError, JsonApiResponse } from '@laikacms/json-api';
import { errorToJsonApiMapper } from '@laikacms/json-api';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
} from '@laikacms/storage';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';
import {
  atomSummaryToJsonApi,
  atomToJsonApi,
  buildPaginationLinks,
  folderToJsonApi,
  type JsonApiCollectionResponse,
  type JsonApiResource,
  parsePaginationQuery,
  storageObjectToJsonApi,
} from './jsonapi.js';

type AllJsonApiResponses = JsonApiResponse | JsonApiCollectionResponse | JsonApiError;

interface AtomicResults {
  'atomic:results': Array<{ data?: JsonApiResource, errors?: JsonApiError['errors'] } | undefined>;
}

const json = <
  T extends AllJsonApiResponses | AtomicResults,
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
  if (Result.isSuccess(result)) throw new InternalError('respondError called with success result');
  return json(errorToJsonApiMapper(result), status);
}

// JSON:API success response for single resource
function respondResourceWithConverter<T, R extends JsonApiResource>(
  result: LaikaResult<T>,
  converter: (data: T) => R,
) {
  if (Result.isFailure(result)) {
    return respondError(result);
  }
  return json({ data: converter(result.success) });
}

// JSON:API success response for resource collection with pagination
async function respondCollectionWithConverter<T, R extends JsonApiResource>(
  request: Request,
  items: readonly T[],
  converter: (item: T) => R,
  baseUrl: string,
) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const pagination = parsePaginationQuery(queryParams);
  const hasMore = false;
  let firstCursor: string | undefined;
  let lastCursor: string | undefined;

  // For cursor-based pagination, extract cursors from items if available
  if (items.length > 0) {
    // Assuming items have an 'id' or 'key' property that can be used as cursor
    const firstItem = items[0] as { id?: string, key?: string };
    const lastItem = items[items.length - 1] as { id?: string, key?: string };
    firstCursor = firstItem.id || firstItem.key;
    lastCursor = lastItem.id || lastItem.key;
  }

  const links = buildPaginationLinks(
    baseUrl,
    pagination,
    hasMore,
    lastCursor,
    firstCursor,
    lastCursor,
  );

  const response: JsonApiCollectionResponse = {
    data: items.map(item => converter(item)),
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

// Effect Schema definitions for JSON:API request validation
const JsonApiStorageObjectCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('object')),
    content: S.optional(S.Record(S.String, S.Any)),
  }),
}));

const JsonApiStorageObjectUpdateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('object')),
    content: S.optional(S.Record(S.String, S.Any)),
  }),
}));

const JsonApiFolderCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('folder')),
  }),
}));

// Request body wrappers for JSON:API format
const StorageObjectCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiStorageObjectCreateSchema,
}));

const StorageObjectUpdateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiStorageObjectUpdateSchema,
}));

// Atomic operations schemas
const RemoveOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('remove'),
  ref: S.Struct({
    type: S.Union([S.Literal('object'), S.Literal('folder'), S.Literal('atom')]),
    id: S.String,
  }),
}));

const AddOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('add'),
  data: S.Union([JsonApiStorageObjectCreateSchema, JsonApiFolderCreateSchema]),
}));

const UpdateOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('update'),
  data: JsonApiStorageObjectUpdateSchema,
}));

const AtomicOperationSchema = S.Union([RemoveOperationSchema, AddOperationSchema, UpdateOperationSchema]);

const AtomicOperationsRequestSchema = S.toStandardSchemaV1(S.Struct({
  'atomic:operations': S.Array(AtomicOperationSchema),
}));

type StorageObjectCreateBody = S.Schema.Type<typeof StorageObjectCreateBodySchema>;
type StorageObjectUpdateBody = S.Schema.Type<typeof StorageObjectUpdateBodySchema>;
type AtomicOperation = S.Schema.Type<typeof AtomicOperationSchema>;
type AtomicOperationsRequest = S.Schema.Type<typeof AtomicOperationsRequestSchema>;

export interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string | undefined;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
}

export function buildJsonApi(options: StorageApiOptions) {
  const { repo, onError, basePath = '' } = options;

  // Create decoders
  const decodeStorageObjectCreateBody = S.decodeUnknownSync(StorageObjectCreateBodySchema);
  const decodeStorageObjectUpdateBody = S.decodeUnknownSync(StorageObjectUpdateBodySchema);
  const decodeAtomicOperationsRequest = S.decodeUnknownSync(AtomicOperationsRequestSchema);

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
            id: 'storage',
            attributes: {
              name: 'Storage API',
              version: '1.0.0',
              endpoints: [
                { path: '/atoms/{key}', methods: ['GET'], description: 'List atoms in a folder' },
                { path: '/objects/{key}', methods: ['POST', 'PATCH'], description: 'Create or update storage objects' },
                { path: '/operations', methods: ['POST'], description: 'Atomic operations (add, update, remove)' },
              ],
            },
          },
        });
      }

      const [resource, key, operation] = path.split('/');

      const listFullAtoms = async () => {
        console.log('Listing atoms for collection', key);
        const listOptions = {
          depth: 1,
          pagination: {
            perPage: 10,
          },
        };
        let results: Atom[] = [];
        for await (const listOfAtoms of repo.listAtoms(key, listOptions)) {
          if (Result.isFailure(listOfAtoms)) {
            const errorCode = listOfAtoms.failure.code as keyof typeof ErrorCodeToStatusMap;
            return respondError(
              listOfAtoms,
              ErrorCodeToStatusMap[errorCode] || 400,
            );
          }
          results = results.concat([...listOfAtoms.success]);
        }
        return respondCollectionWithConverter(request, results, atomToJsonApi, request.url);
      };

      const listAtomSummaries = async () => {
        console.log('Listing atom summaries for collection', key);
        const listOptions = {
          depth: 1,
          pagination: {
            perPage: 10,
          },
        };
        let results: AtomSummary[] = [];
        for await (const listOfAtoms of repo.listAtomSummaries(key, listOptions)) {
          if (Result.isFailure(listOfAtoms)) {
            const errorCode = listOfAtoms.failure.code as keyof typeof ErrorCodeToStatusMap;
            return respondError(
              listOfAtoms,
              ErrorCodeToStatusMap[errorCode] || 400,
            );
          }
          results = results.concat([...listOfAtoms.success]);
        }
        return respondCollectionWithConverter(request, results, atomSummaryToJsonApi, request.url);
      };

      if (resource === 'atoms' && request.method === 'GET') return listFullAtoms();
      else if (resource === 'atom-summaries' && request.method === 'GET') return listAtomSummaries();
      else if (resource === 'objects' && request.method === 'POST') {
        let body: StorageObjectCreateBody;
        try {
          const rawBody = await request.json();
          body = decodeStorageObjectCreateBody(rawBody);
        } catch {
          return respondError(
            Result.fail(new InvalidData('Invalid request body')),
            400,
          );
        }
        const data: StorageObjectCreate = {
          key: body.data.id,
          type: 'object',
          content: body.data.attributes.content || {},
        };
        const result = await firstResult(repo.createObject(data));
        return respondResourceWithConverter(
          result,
          storageObjectToJsonApi,
        );
      }

      if (path.startsWith('objects') && request.method === 'PATCH') {
        const [_, pathKey] = path.split('/');
        let body: StorageObjectUpdateBody;
        try {
          const rawBody = await request.json();
          body = decodeStorageObjectUpdateBody(rawBody);
        } catch {
          return respondError(
            Result.fail(new InvalidData('Invalid request body')),
            400,
          );
        }
        if (body.data.id !== pathKey) {
          return respondError(
            Result.fail(new InvalidData('Key in URL does not match key in body')),
            ErrorCodeToStatusMap[InvalidData.CODE],
          );
        }
        const data: StorageObjectUpdate = {
          key: body.data.id,
          type: 'object',
          content: body.data.attributes.content,
        };
        const result = await firstResult(repo.updateObject(data));
        return respondResourceWithConverter(
          result,
          storageObjectToJsonApi,
        );
      } else if (path === 'operations' && request.method === 'POST') {
        let body: AtomicOperationsRequest;
        try {
          const rawBody = await request.json();
          body = decodeAtomicOperationsRequest(rawBody);
        } catch {
          return respondError(
            Result.fail(new InvalidData('Invalid atomic operations request')),
            400,
          );
        }

        type Ref = { key: string, type: string };
        const removeOperations: [
          string,
          (ref: LaikaResult<Ref>) => void,
          (err: unknown) => void,
        ][] = [];

        const remove = (key: string): Promise<LaikaResult<Ref>> =>
          new Promise((resolve, reject) => removeOperations.push([key, resolve, reject]));

        const atomicOperations = body['atomic:operations']
          .map((operation: AtomicOperation) => {
            switch (operation.op) {
              case 'add':
                if (operation.data.type === 'object') {
                  const createData: StorageObjectCreate = {
                    key: operation.data.id,
                    type: 'object',
                    content: operation.data.attributes.content || {},
                  };
                  return firstResult(repo.createObject(createData)).then(result => ({ op: result, operation }));
                } else if (operation.data.type === 'folder') {
                  const createData: FolderCreate = {
                    key: operation.data.id,
                    type: 'folder',
                  };
                  return firstResult(repo.createFolder(createData)).then(result => ({ op: result, operation }));
                }
                return Promise.resolve({
                  op: Result.fail(new InvalidData(`Unsupported add type`)),
                  operation,
                });
              case 'update':
                if (operation.data.type === 'object') {
                  const updateData: StorageObjectUpdate = {
                    key: operation.data.id,
                    type: 'object',
                    content: operation.data.attributes.content,
                  };
                  return firstResult(repo.updateObject(updateData)).then(result => ({ op: result, operation }));
                }
                return Promise.resolve({
                  op: Result.fail(new InvalidData(`Unsupported update type`)),
                  operation,
                });
              case 'remove':
                return remove(operation.ref.id).then(op => ({
                  op,
                  operation,
                }));
            }
          });

        for await (
          const atoms of repo.removeAtoms(
            removeOperations.map(([key]) => key),
          )
        ) {
          if (Result.isFailure(atoms)) return respondError(atoms);
          const removedAtoms = atoms.success;
          for (const atom of removedAtoms) {
            const found = removeOperations.find(([key]) => key === atom);
            if (found) {
              const [, resolve] = found;
              resolve(Result.succeed({ type: 'atom', key: atom }));
            }
          }
        }

        const atomicsSettled = await Promise.allSettled(atomicOperations);

        const atomicResults: Array<{ data: JsonApiResource }> = [];
        for (const promiseResult of atomicsSettled) {
          if (promiseResult.status === 'rejected') {
            // Skip rejected promises for now
            continue;
          }
          const value = promiseResult.value;
          if (Result.isSuccess(value.op)) {
            if (value.operation.op === 'add' || value.operation.op === 'update') {
              const data = value.op.success;
              if (typeof data === 'object' && data !== null && 'type' in data) {
                const typedData = data as { type: string };
                if (typedData.type === 'object') {
                  atomicResults.push({ data: storageObjectToJsonApi(data as StorageObject) });
                } else {
                  atomicResults.push({ data: folderToJsonApi(data as Folder) });
                }
              }
            }
            // For "remove" operations, we don't add anything to results
          }
        }

        return json({
          'atomic:results': atomicResults,
        });
      } else {
        options.logger?.debug('storage endpoint not found:', path);
        return respondError(
          Result.fail(new NotFoundError('Storage endpoint not found')),
          404,
        );
      }
    },
  };
}
