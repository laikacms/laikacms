import { Atom, AtomSummary, StorageRepository } from "@laikacms/storage";
import {
  ErrorCodeToStatusMap,
  ErrorStatus,
  InternalError,
  InvalidData,
  LaikaResult,
  LaikaError,
  NotFoundError,
} from "@laikacms/core";
import * as Result from "effect/Result";
import {
  folderToJsonApiZ,
  storageObjectFromJsonApiZ,
  storageObjectToJsonApiZ,
  toJsonApi,
  parsePaginationQuery,
  buildPaginationLinks,
  type JsonApiCollectionResponse,
  type JsonApiResource,
  storageObjectCreateFromJsonApiZ,
  storageObjectUpdateFromJsonApiZ,
  folderCreateFromJsonApiZ,
  atomSummaryToJsonApiZ,
  atomToJsonApiZ,
} from "./jsonapi.js";
import {
  errorToJsonApiMapper,
  JsonApiError,
  JsonApiResponse,
  zodIssueFormatter,
} from "@laikacms/json-api";
import z, { ZodType, ZodError } from "zod";

type AllJsonApiResponses = JsonApiResponse | JsonApiCollectionResponse | JsonApiError;

interface AtomicResults {
  "atomic:results": Array<{ data?: JsonApiResource; errors?: JsonApiError["errors"] } | undefined>;
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
      "Content-Type": "application/vnd.api+json",
    },
  });
};

// JSON:API error response
function respondError(result: LaikaResult<any>, status: ErrorStatus = 400) {
  if (Result.isSuccess(result))
    throw new InternalError("respondError called with success result");
  return json(errorToJsonApiMapper(result), status);
}

// JSON:API success response for single resource
function respondResource<T>(
  result: LaikaResult<T>,
  outputSchema: ReturnType<typeof toJsonApi>,
) {
  if (Result.isFailure(result)) {
    return respondError(result);
  }
  return json({ data: outputSchema.parse(result.success) });
}

// JSON:API success response for resource collection with pagination
async function respondCollection<T>(
  request: Request,
  items: readonly T[],
  outputSchema: ZodType<JsonApiResource>,
  baseUrl: string,
) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const pagination = parsePaginationQuery(queryParams);
  const results: T[] = [];
  let hasMore = false;
  let firstCursor: string | undefined;
  let lastCursor: string | undefined;

  // For cursor-based pagination, extract cursors from items if available
  if (items.length > 0) {
    // Assuming items have an 'id' or 'key' property that can be used as cursor
    const firstItem = items[0] as any;
    const lastItem = items[items.length - 1] as any;
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
    data: items.map((item) => outputSchema.parse(item)),
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
    return Result.fail(new NotFoundError("No result returned"));
  }
  return value;
}

interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string | undefined;
  onError?(error: unknown): void;
  logger?: Console | undefined;
}

export function buildJsonApi(options: StorageApiOptions) {
  const { repo, onError, basePath = "" } = options;
  // Request body wrappers for JSON:API format
  const storageObjectCreateBodyZ = z.object({
    data: storageObjectCreateFromJsonApiZ,
  });

  const storageObjectUpdateBodyZ = z.object({
    data: storageObjectUpdateFromJsonApiZ,
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      let path = url.pathname.substring(basePath.length);
      if (path.startsWith("/")) path = path.substring(1);
      if (path.endsWith("/")) path = path.slice(0, -1);

      // Root endpoint - list available endpoints
      if (path === "" && request.method === "GET") {
        return json({
          data: {
            type: "api-info",
            id: "storage",
            attributes: {
              name: "Storage API",
              version: "1.0.0",
              endpoints: [
                { path: "/atoms/{key}", methods: ["GET"], description: "List atoms in a folder" },
                { path: "/objects/{key}", methods: ["POST", "PATCH"], description: "Create or update storage objects" },
                { path: "/operations", methods: ["POST"], description: "Atomic operations (add, update, remove)" },
              ],
            },
          },
        });
      }

      const [resource, key, operation] = path.split("/");

      const listFullAtoms = async () => {
        console.log("Listing atoms for collection", key);
        const listOptions = {
          depth: 1,
          pagination: {
            perPage: 10,
          },
        }
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
        return respondCollection(request, results, atomToJsonApiZ, request.url);
      }

      const listAtomSummaries = async () => {
        console.log("Listing atom summaries for collection", key);
        const listOptions = {
          depth: 1,
          pagination: {
            perPage: 10,
          },
        }
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
        return respondCollection(request, results, atomSummaryToJsonApiZ, request.url);
      }

      if (resource === "atoms" && request.method === "GET") return listFullAtoms();
      else if (resource === "atom-summaries" && request.method === "GET") return listAtomSummaries();

      else if (resource === "objects" && request.method === "POST") {
        const { data } = storageObjectCreateBodyZ.parse(await request.json());
        const result = await firstResult(repo.createObject(data));
        return respondResource(
          result,
          storageObjectToJsonApiZ,
        );
      }

      if (path.startsWith("objects") && request.method === "PATCH") {
        const [_, pathKey] = path.split("/");
        const { data } = storageObjectUpdateBodyZ.parse(await request.json());
        if (data.key !== pathKey) {
          return respondError(
            Result.fail(new InvalidData("Key in URL does not match key in body")),
            ErrorCodeToStatusMap[InvalidData.CODE],
          );
        }
        const result = await firstResult(repo.updateObject(data));
        return respondResource(
          result,
          storageObjectToJsonApiZ,
        );
      }

      else if (path === "operations" && request.method === "POST") {
        const operationsZ = z.object({
          "atomic:operations": z.array(
            z.discriminatedUnion("op", [
              z.object({
                op: z.literal("remove"),
                ref: z.object({
                  type: z.union([
                    z.literal("object"),
                    z.literal("folder"),
                    z.literal("atom"),
                  ]),
                  id: z.string(),
                }),
              }),
              z.object({
                op: z.literal("add"),
                data: z.union([
                  storageObjectCreateFromJsonApiZ,
                  folderCreateFromJsonApiZ,
                ]),
              }),
              z.object({
                op: z.literal("update"),
                data: z.union([storageObjectUpdateFromJsonApiZ]),
              }),
            ]),
          ),
        });

        const body = operationsZ.parse(await request.json());

        type Ref = { key: string; type: string };
        const removeOperations: [
          string,
          (ref: LaikaResult<Ref>) => void,
          Function,
        ][] = [];

        const remove = (key: string): Promise<LaikaResult<Ref>> =>
          new Promise((resolve, reject) =>
            removeOperations.push([key, resolve, reject]),
          );

        const atomicOperations = body["atomic:operations"]
          .map(async (operation) => {
            switch (operation.op) {
              case "add":
                if (operation.data.type === "object") {
                  const result = await firstResult(repo.createObject(operation.data));
                  return { op: result, operation };
                } else if (operation.data.type === "folder") {
                  const result = await firstResult(repo.createFolder(operation.data));
                  return { op: result, operation };
                }
                break;
              case "update":
                if (operation.data.type === "object") {
                  const result = await firstResult(repo.updateObject(operation.data));
                  return { op: result, operation };
                }
                break;
              case "remove":
                return remove(operation.ref.id).then((op) => ({
                  op,
                  operation,
                }));
            }
            return Promise.resolve({
              op: Result.fail(new InvalidData(
                `Unsupported operation ${operation.op} for ${(operation as any).data?.type}`,
              )),
              operation,
            });
          })
          .filter((x) => x !== null);

        for await (const atoms of repo.removeAtoms(
          removeOperations.map(([key]) => key),
        )) {
          if (Result.isFailure(atoms)) return respondError(atoms);
          const removedAtoms = atoms.success;
          for (const atom of removedAtoms) {
            const [, resolve] = removeOperations.find(([key]) => key === atom)!;
            resolve(Result.succeed({ type: "atom", key: atom }));
          }
        }

        const atomicsSettled = await Promise.allSettled(atomicOperations);

        const atomicResults = atomicsSettled
          .map((promiseResult) => {
            if (promiseResult.status === "rejected")
              return errorToJsonApiMapper(promiseResult);
            if (Result.isSuccess(promiseResult.value.op)) {
              if (
                promiseResult.value.operation.op === "add" ||
                promiseResult.value.operation.op === "update"
              ) {
                const data = promiseResult.value.op.success;
                const outputSchema =
                  data.type === "object"
                    ? storageObjectToJsonApiZ
                    : folderToJsonApiZ;
                return { data: outputSchema.parse(data) };
              } else if (promiseResult.value.operation.op === "remove") {
                return undefined;
              }
            }
          })
          .filter((x) => x !== undefined);

        return json({
          "atomic:results": atomicResults,
        });
      }

      else {
        options.logger?.debug('storage endpoint not found:', path);
        return respondError(
          Result.fail(new NotFoundError("Storage endpoint not found")),
          404,
        );
      }
    }
  };
}
