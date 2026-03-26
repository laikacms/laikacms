import { Atom, AtomSummary, StorageRepository } from "@laikacms/storage";
import {
  ErrorCodeToStatusMap,
  ErrorStatus,
  InternalError,
  InvalidData,
  Logger,
  NotFoundError,
  Result,
  failure,
  success,
} from "@laikacms/core";
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
function respondError(result: Result<any>, status: ErrorStatus = 400) {
  if (result.success)
    throw new InternalError("respondError called with success result");
  return json(errorToJsonApiMapper(result), status);
}

// JSON:API success response for single resource
function respondResource<T>(
  result: Result<T>,
  outputSchema: ReturnType<typeof toJsonApi>,
) {
  if (!result.success) {
    return respondError(result);
  }
  return json({ data: outputSchema.parse(result.data) });
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

interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string | undefined;
  onError?(error: unknown): void;
  logger?: Logger | undefined;
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

      const listAtoms = async <SummariesOnly extends boolean, T = SummariesOnly extends true ? AtomSummary : Atom>(summariesOnly: SummariesOnly) => {
        console.log("Listing atoms for collection", key);
        const options = {
          depth: 1,
          pagination: {
            perPage: 10,
          },
        }
        const result = summariesOnly ? repo.listAtomSummaries(key, options) : repo.listAtoms(key, options);

        let results: T[] = [] as T[];
        for await (const listOfAtoms of result) {
          if (!listOfAtoms.success) {
            return respondError(
              listOfAtoms,
              ErrorCodeToStatusMap[listOfAtoms.code],
            );
          }
          results = results.concat(listOfAtoms.data as T[]);
        }

        return respondCollection(request, results, summariesOnly ? atomSummaryToJsonApiZ : atomToJsonApiZ, request.url);
      }

      if (resource === "atoms" && request.method === "GET") return listAtoms(false);
      else if (resource === "atom-summaries" && request.method === "GET") return listAtoms(true);

      else if (resource === "objects" && request.method === "POST") {
        const { data } = storageObjectCreateBodyZ.parse(await request.json());
        return respondResource(
          await repo.createObject(data),
          storageObjectToJsonApiZ,
        );
      }

      if (path.startsWith("objects") && request.method === "PATCH") {
        const [_, key] = path.split("/");
        const { data } = storageObjectUpdateBodyZ.parse(await request.json());
        if (data.key !== key) {
          return respondError(
            failure(InvalidData.CODE, ["Key in URL does not match key in body"]),
            ErrorCodeToStatusMap[InvalidData.CODE],
          );
        }
        return respondResource(
          await repo.updateObject(data),
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
          (ref: Result<Ref>) => void,
          Function,
        ][] = [];

        const remove = (key: string): Promise<Result<Ref>> =>
          new Promise((resolve, reject) =>
            removeOperations.push([key, resolve, reject]),
          );

        const atomicOperations = body["atomic:operations"]
          .map(async (operation) => {
            switch (operation.op) {
              case "add":
                if (operation.data.type === "object") {
                  return repo
                    .createObject(operation.data)
                    .then((op) => ({ op, operation }));
                } else if (operation.data.type === "folder") {
                  return repo
                    .createFolder(operation.data)
                    .then((op) => ({ op, operation }));
                }
                break;
              case "update":
                if (operation.data.type === "object") {
                  return repo
                    .updateObject(operation.data)
                    .then((op) => ({ op, operation }));
                }
                break;
              case "remove":
                return remove(operation.ref.id).then((op) => ({
                  op,
                  operation,
                }));
            }
            return Promise.resolve({
              op: failure(InvalidData.CODE, [
                `Unsupported operation ${operation.op} for ${operation.data.type}`,
              ]),
              operation,
            });
          })
          .filter((x) => x !== null);

        for await (const atoms of repo.removeAtoms(
          removeOperations.map(([key]) => key),
        )) {
          if (!atoms.success) return respondError(atoms);
          for (const atom of atoms.data) {
            const [, resolve] = removeOperations.find(([key]) => key === atom)!;
            resolve(success({ type: "atom", key: atom }));
          }
        }

        const atomicsSettled = await Promise.allSettled(atomicOperations);

        const atomicResults = atomicsSettled
          .map((promiseResult) => {
            if (promiseResult.status === "rejected")
              return errorToJsonApiMapper(promiseResult);
            if (promiseResult.value.op.success) {
              if (
                promiseResult.value.operation.op === "add" ||
                promiseResult.value.operation.op === "update"
              ) {
                const data = promiseResult.value.op.data;
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
          new NotFoundError("Storage endpoint not found").toResult(),
          404,
        );
      }
    }
  };
}
