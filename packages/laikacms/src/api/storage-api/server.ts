import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';

import type { ErrorStatus, LaikaResult } from 'laikacms/core';
import {
  ErrorCodeToStatusMap,
  InternalError,
  InvalidData,
  type LaikaDone,
  LaikaError,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type { JsonApiError, JsonApiResponse } from 'laikacms/json-api';
import { errorToJsonApiMapper } from 'laikacms/json-api';
import type {
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
} from 'laikacms/storage';

import {
  atomSummaryToJsonApi,
  atomToJsonApi,
  buildPaginationLinks,
  folderToJsonApi,
  type JsonApiCollectionResponse,
  type JsonApiResource,
  parsePaginationQuery,
  storageObjectToJsonApi,
  withSelfLink,
} from './jsonapi.js';

type AllJsonApiResponses = JsonApiResponse | JsonApiCollectionResponse | JsonApiError;

interface AtomicResults {
  'atomic:results': Array<{ data?: JsonApiResource, errors?: JsonApiError['errors'] } | undefined>;
}

const json = <T extends AllJsonApiResponses | AtomicResults>(body: T, status: number = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Cache-Control': 'no-store',
    },
  });

// decodeURIComponent throws on malformed sequences; degrade to the raw segment
// rather than 500ing on bad input — downstream validation will reject anything
// the storage layer can't handle.
const safeDecode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

function respondError(result: LaikaResult<unknown>, status: ErrorStatus = 400) {
  if (Result.isSuccess(result)) throw new InternalError('respondError called with success result');
  return json(errorToJsonApiMapper(result), status);
}

function respondResourceWithConverter<T, R extends JsonApiResource>(
  result: LaikaResult<T>,
  converter: (data: T) => R,
  basePath: string,
) {
  if (Result.isFailure(result)) return respondError(result);
  return json({ data: withSelfLink(converter(result.success), basePath) });
}

function respondCollectionWithConverter<T, R extends JsonApiResource>(
  request: Request,
  items: readonly T[],
  converter: (item: T) => R,
  baseUrl: string,
  basePath: string,
  done?: LaikaDone,
) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const pagination = parsePaginationQuery(queryParams);
  let firstCursor: string | undefined;
  let lastCursor: string | undefined;

  if (items.length > 0) {
    const firstItem = items[0] as { id?: string, key?: string };
    const lastItem = items[items.length - 1] as { id?: string, key?: string };
    firstCursor = firstItem.id || firstItem.key;
    lastCursor = lastItem.id || lastItem.key;
  }

  // `hasMore` is best-effort: prefer the upstream Done's pagination hint
  // when present, otherwise infer from "more items than requested".
  const requestedLimit = 'limit' in pagination
    ? pagination.limit
    : ('perPage' in pagination ? pagination.perPage : undefined);
  const hasMore = done?.pagination !== undefined
    || (typeof done?.total === 'number' && typeof requestedLimit === 'number'
      ? items.length === requestedLimit
      : false);

  // Navigation lives in `links` per JSON:API §8 — `next` is present iff
  // there's another page, which carries the `hasMore` signal implicitly.
  // The current cursor lives in the request URL itself.
  const links = buildPaginationLinks(baseUrl, pagination, hasMore, lastCursor, firstCursor, lastCursor);

  // `meta.page` only carries aggregate counts the backend supplies — never
  // values that should be derived from links.
  const meta = typeof done?.total === 'number'
    ? { page: { total: done.total } }
    : undefined;

  const response: JsonApiCollectionResponse = {
    data: items.map(item => withSelfLink(converter(item), basePath)),
    links,
    ...(meta ? { meta } : {}),
  };

  return json(response);
}

/** Convert any caught throw into a LaikaError, preserving LaikaError instances and wrapping defects in InternalError. */
const toLaikaError = (err: unknown): LaikaError => {
  if (err instanceof LaikaError) return err;
  if (err instanceof Error) return new InternalError(err.message, { cause: err });
  return new InternalError(String(err));
};

/**
 * Run a LaikaTask and surface the resolved value as a LaikaResult. Catches
 * both typed failures AND defects so route handlers always produce a
 * JSON:API response instead of leaking text/plain 500s.
 */
const runTask = async <T>(task: LaikaTask.LaikaTask<T>): Promise<LaikaResult<T>> => {
  try {
    return await Effect.runPromise(Effect.result(LaikaTask.runValue(task)));
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};

/** Run a LaikaStream and collect data + recoverable errors + done as a LaikaResult. Catches defects, same as {@link runTask}. */
const runStream = async <A, D extends LaikaDone>(
  stream: LaikaStream.LaikaStream<A, D>,
): Promise<
  LaikaResult<{
    data: ReadonlyArray<A>,
    recoverableErrors: ReadonlyArray<LaikaError>,
    done: D,
  }>
> => {
  try {
    return await Effect.runPromise(Effect.result(LaikaStream.runCollect(stream)));
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};

const JsonApiStorageObjectCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('object')),
    content: S.optional(S.Record(S.String, S.Any)),
  }),
  // Resource-level meta — surfaces StorageObject.metadata (extension,
  // revisionId, …) without polluting `attributes`.
  meta: S.optional(S.Record(S.String, S.Any)),
}));

const JsonApiStorageObjectUpdateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('object')),
    content: S.optional(S.Record(S.String, S.Any)),
  }),
  meta: S.optional(S.Record(S.String, S.Any)),
}));

const JsonApiFolderCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder'),
  id: S.String,
  attributes: S.Struct({ type: S.optional(S.Literal('folder')) }),
}));

const StorageObjectCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiStorageObjectCreateSchema,
}));
const StorageObjectUpdateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiStorageObjectUpdateSchema,
}));

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

/**
 * Build a JSON:API handler for the storage repository.
 *
 * ⚠️ This handler ships no authentication. Wrap it before exposing it to an
 * untrusted network.
 */
export function buildJsonApi(options: StorageApiOptions) {
  const { repo, basePath = '' } = options;

  const decodeStorageObjectCreateBody = S.decodeUnknownSync(StorageObjectCreateBodySchema);
  const decodeStorageObjectUpdateBody = S.decodeUnknownSync(StorageObjectUpdateBodySchema);
  const decodeAtomicOperationsRequest = S.decodeUnknownSync(AtomicOperationsRequestSchema);

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      let path = url.pathname.substring(basePath.length);
      if (path.startsWith('/')) path = path.substring(1);
      if (path.endsWith('/')) path = path.slice(0, -1);

      if (path === '' && request.method === 'GET') {
        return json({
          data: {
            type: 'api-info',
            id: 'storage',
            attributes: {
              name: 'Storage API',
              version: '1.0.0',
              endpoints: [
                {
                  path: '/capabilities',
                  methods: ['GET'],
                  description: 'Underlying storage repository capabilities',
                },
                { path: '/atoms/{key}', methods: ['GET'], description: 'List atoms in a folder' },
                {
                  path: '/atom-summaries/{key}',
                  methods: ['GET'],
                  description: 'List atom summaries (lightweight listing) in a folder',
                },
                {
                  path: '/objects/{key}',
                  methods: ['GET', 'POST', 'PATCH'],
                  description: 'Read, create, or update storage objects',
                },
                { path: '/folders/{key}', methods: ['GET'], description: 'Read a folder' },
                {
                  path: '/operations',
                  methods: ['POST'],
                  description: 'Atomic operations (add, update, remove)',
                },
              ],
            },
          },
        });
      }

      // The JSON-API proxy URL-encodes the key (so keys with slashes survive the
      // /atoms/{key} route as a single path segment); decode it back here.
      const [resource, rawKey] = path.split('/');
      const key = rawKey === undefined ? undefined : safeDecode(rawKey);

      const listFullAtoms = async () => {
        const listOptions = { depth: 1, pagination: { perPage: 10 } };
        const result = await runStream(repo.listAtoms(key!, listOptions));
        if (Result.isFailure(result)) {
          const errorCode = result.failure.code as keyof typeof ErrorCodeToStatusMap;
          return respondError(result, ErrorCodeToStatusMap[errorCode] || 400);
        }
        return respondCollectionWithConverter(
          request,
          result.success.data,
          atomToJsonApi,
          request.url,
          basePath,
          result.success.done,
        );
      };

      const listAtomSummaries = async () => {
        const listOptions = { depth: 1, pagination: { perPage: 10 } };
        const result = await runStream(repo.listAtomSummaries(key!, listOptions));
        if (Result.isFailure(result)) {
          const errorCode = result.failure.code as keyof typeof ErrorCodeToStatusMap;
          return respondError(result, ErrorCodeToStatusMap[errorCode] || 400);
        }
        return respondCollectionWithConverter(
          request,
          result.success.data,
          atomSummaryToJsonApi,
          request.url,
          basePath,
          result.success.done,
        );
      };

      if (resource === 'capabilities' && request.method === 'GET') {
        // Surface the underlying repository's `Capabilities` so proxy clients
        // (and humans) can introspect what's actually supported instead of
        // assuming. Cheap call; we run it on every request so a swapped-out
        // repo is reflected immediately.
        const result = await runTask(repo.getCapabilities());
        if (Result.isFailure(result)) {
          const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap]
            ?? 500;
          return respondError(result, status);
        }
        return json({
          data: {
            type: 'storage-capabilities',
            id: 'self',
            attributes: result.success,
            links: { self: `${basePath}/capabilities` },
          },
        });
      }
      if (resource === 'atoms' && request.method === 'GET') return listFullAtoms();
      else if (resource === 'atom-summaries' && request.method === 'GET') return listAtomSummaries();
      else if (resource === 'objects' && request.method === 'GET') {
        if (!key) return respondError(Result.fail(new InvalidData('Missing object key')), 400);
        const result = await runTask(repo.getObject(key));
        if (Result.isFailure(result)) {
          const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap]
            ?? 400;
          return respondError(result, status);
        }
        return respondResourceWithConverter(result, storageObjectToJsonApi, basePath);
      } else if (resource === 'folders' && request.method === 'GET') {
        if (!key) return respondError(Result.fail(new InvalidData('Missing folder key')), 400);
        const result = await runTask(repo.getFolder(key));
        if (Result.isFailure(result)) {
          const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap]
            ?? 400;
          return respondError(result, status);
        }
        return respondResourceWithConverter(result, folderToJsonApi, basePath);
      } else if (resource === 'objects' && request.method === 'POST') {
        let body: StorageObjectCreateBody;
        try {
          const rawBody = await request.json();
          body = decodeStorageObjectCreateBody(rawBody);
        } catch {
          return respondError(Result.fail(new InvalidData('Invalid request body')), 400);
        }
        const data: StorageObjectCreate = {
          key: body.data.id,
          type: 'object',
          content: body.data.attributes.content || {},
          ...(body.data.meta ? { metadata: body.data.meta } : {}),
        };
        const result = await runTask(repo.createObject(data));
        return respondResourceWithConverter(result, storageObjectToJsonApi, basePath);
      }

      if (path.startsWith('objects') && request.method === 'PATCH') {
        const [, rawPathKey] = path.split('/');
        const pathKey = rawPathKey === undefined ? undefined : safeDecode(rawPathKey);
        let body: StorageObjectUpdateBody;
        try {
          const rawBody = await request.json();
          body = decodeStorageObjectUpdateBody(rawBody);
        } catch {
          return respondError(Result.fail(new InvalidData('Invalid request body')), 400);
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
          ...(body.data.meta ? { metadata: body.data.meta } : {}),
        };
        const result = await runTask(repo.updateObject(data));
        return respondResourceWithConverter(result, storageObjectToJsonApi, basePath);
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
                  return runTask(repo.createObject(createData)).then(r => ({ op: r, operation }));
                } else if (operation.data.type === 'folder') {
                  const createData: FolderCreate = {
                    key: operation.data.id,
                    type: 'folder',
                  };
                  return runTask(repo.createFolder(createData)).then(r => ({ op: r, operation }));
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
                  return runTask(repo.updateObject(updateData)).then(r => ({ op: r, operation }));
                }
                return Promise.resolve({
                  op: Result.fail(new InvalidData(`Unsupported update type`)),
                  operation,
                });
              case 'remove':
                return remove(operation.ref.id).then(op => ({ op, operation }));
            }
          });

        const removalResult = await runStream(
          repo.removeAtoms(removeOperations.map(([key]) => key)),
        );
        if (Result.isFailure(removalResult)) return respondError(removalResult);
        for (const key of removalResult.success.data) {
          const found = removeOperations.find(([k]) => k === key);
          if (found) {
            const [, resolve] = found;
            resolve(Result.succeed({ type: 'atom', key }));
          }
        }
        // Resolve any not-removed keys as warnings (they failed individually)
        for (const [k, resolve] of removeOperations) {
          if (!removalResult.success.data.includes(k)) {
            resolve(
              Result.fail(
                removalResult.success.recoverableErrors[0] ?? new NotFoundError(`Failed to remove ${k}`),
              ),
            );
          }
        }

        const atomicsSettled = await Promise.allSettled(atomicOperations);

        const atomicResults: Array<{ data: JsonApiResource }> = [];
        for (const promiseResult of atomicsSettled) {
          if (promiseResult.status === 'rejected') continue;
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
          }
        }

        return json({ 'atomic:results': atomicResults });
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
