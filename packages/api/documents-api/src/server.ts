import { DocumentsRepository } from "@laikacms/documents";
import {
  BadRequestError,
  NotFoundError,
  LaikaResult,
  LaikaError,
  ErrorCodeToStatusMap,
  ErrorStatus,
} from "@laikacms/core";
import * as Result from "effect/Result";
import {
  documentCreateFromJsonApiZ,
  documentSummaryToJsonApiZ,
  documentToJsonApiZ,
  revisionCreateFromJsonApiZ,
  revisionSummaryToJsonApiZ,
  revisionToJsonApiZ,
  unpublishedCreateFromJsonApiZ,
  unpublishedSummaryToJsonApiZ,
  unpublishedToJsonApiZ,
  unpublishedUpdateFromJsonApiZ,
  toJsonApi,
  documentUpdateFromJsonApiZ,
} from "./jsonapi.js";
import z, { ZodType, ZodError } from "zod";
import {
  buildPaginationLinks,
  JsonApiCollectionResponse,
  JsonApiResource,
  parsePaginationQuery,
  zodIssueFormatter,
  errorToJsonApiMapper,
  JsonApiError,
  JsonApiResponse,
} from "@laikacms/json-api";

type AllJsonApiResponses =
  | JsonApiResponse
  | JsonApiCollectionResponse
  | JsonApiError;

const json = <
  T extends AllJsonApiResponses | { meta: any } | { "atomic:results": any },
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
    throw new Error("respondError called with success result");
  return json(errorToJsonApiMapper(result), status);
}

// JSON:API success response for single resource
function respondResource<T>(
  result: LaikaResult<T>,
  outputSchema: ReturnType<typeof toJsonApi>,
) {
  if (Result.isFailure(result)) {
    // Check if this is a "not found" error and return 404
    const isNotFound =
      result.failure.code === NotFoundError.CODE ||
      result.failure.message?.toLowerCase().includes("not found");
    return respondError(result, isNotFound ? 404 : 400);
  }
  // Wrap the resource in a "data" field per JSON:API spec
  return json({ data: outputSchema.parse(result.success) });
}

// JSON:API success response for void result (delete operations)
function respondVoid(result: LaikaResult<void>) {
  if (Result.isFailure(result)) {
    return respondError(result);
  }
  return json({ meta: { deleted: true } });
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
  let hasMore = false;
  let lastCursor: string | undefined;

  const links = buildPaginationLinks(baseUrl, pagination, hasMore, lastCursor);

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

interface DocumentsApiOptions {
  repo: DocumentsRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Console | undefined;
}

export function buildJsonApi(options: DocumentsApiOptions) {
  const { repo, onError, basePath = "" } = options;

  // Allow empty string for folder filter (to list all records at root level)
  const folderFilterZ = z
    .string()
    .regex(/^[a-zA-Z0-9_/-]*$/)
    .default("");

  const recordsQueryZ = z
    .object({
      "filter[type]": z
        .union([
          z.literal("published"),
          z.literal("unpublished"),
          z.literal("all"),
        ])
        .default('published'),
      "filter[folder]": folderFilterZ,
      "filter[depth]": z.coerce.number().min(1)
    })
    .transform(
      ({ "filter[type]": type, "filter[folder]": folder, "filter[depth]": depth }) => ({
        type: type === 'all' ? undefined : type,
        folder,
        depth
      }),
    );

  const unpublishedQueryZ = z
    .object({
      "filter[status]": z
        .string()
        .transform((val) => val.split(","))
        .optional(),
      "filter[folder]": folderFilterZ,
    })
    .transform(({ "filter[status]": statuses, "filter[folder]": folder }) => ({
      statuses,
      folder,
    }));

  // Request body wrappers for JSON:API format
  const documentCreateBodyZ = z.object({
    data: documentCreateFromJsonApiZ,
  });

  const unpublishedCreateBodyZ = z.object({
    data: unpublishedCreateFromJsonApiZ,
  });

  const unpublishedUpdateBodyZ = z.object({
    data: unpublishedUpdateFromJsonApiZ,
  });

  const unpublishBodyZ = z.object({
    data: z.object({
      type: z.literal("unpublished"),
      attributes: z.object({
        status: z.string(),
      }),
    }),
  });

  const statusChangeBodyZ = z.object({
    data: z.object({
      type: z.literal("unpublished"),
      attributes: z.object({
        status: z.string(),
      }),
    }),
  });

  const revisionCreateBodyZ = z.object({
    data: revisionCreateFromJsonApiZ,
  });

  const refZ = z.object({
    id: z.string(),
    type: z.union([
      z.literal("document"),
      z.literal("unpublished"),
      z.literal("revision"),
    ]),
  });

  // Separate operation schemas for better type inference
  const addUnpublishedOpZ = z.object({
    op: z.literal("add"),
    data: unpublishedCreateFromJsonApiZ,
  });

  const addDocumentOpZ = z.object({
    op: z.literal("add"),
    data: documentCreateFromJsonApiZ,
  });

  const stateTransitionOpZ = z.object({
    op: z.literal("update"),
    href: z.union([z.literal("/publish"), z.literal("/unpublish")]),
    ref: refZ,
    data: z
      .object({
        type: z.literal("unpublished"),
        attributes: z.object({
          status: z.string(),
        }),
      })
      .optional(),
  });

  const updateUnpublishedOpZ = z.object({
    op: z.literal("update"),
    data: unpublishedUpdateFromJsonApiZ,
  });

  const removeOpZ = z.object({
    op: z.literal("remove"),
    ref: refZ,
  });

  const operationsZ = z.object({
    "atomic:operations": z.array(
      z.union([
        addUnpublishedOpZ,
        addDocumentOpZ,
        stateTransitionOpZ,
        updateUnpublishedOpZ,
        removeOpZ,
      ]),
    ),
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
            // TODO: Root endpoint - list available endpoints
            type: "endpoints",
            id: "documents-api",
            attributes: {
              endpoints: [
                "records",
                "record-summaries",
                "published",
                "unpublished",
                "unpublished-summaries",
                "revisions",
                "operations",
              ],
            },
          },
        });
      }

      const pathParts = path.split("/");
      const resource = pathParts[0];
      const key = pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined;
      const action = pathParts[2];

      const queryParams = Object.fromEntries(url.searchParams.entries());

      const listFullRecords = async () => {
        const { type, folder, depth } = recordsQueryZ.parse(queryParams);
        const allResults: any[] = [];
        for await (const result of repo.listRecords({
          pagination: parsePaginationQuery(queryParams),
          folder,
          type,
          depth
        })) {
          if (Result.isFailure(result)) {
            return respondError(result);
          }
          allResults.push(...result.success);
        }

        console.log('Fetched records:', allResults);

        const transformedResults = allResults.map((entry: any) => {
          switch (entry.type) {
            case "published":
              return documentToJsonApiZ.parse(entry);
            case "unpublished":
              return unpublishedToJsonApiZ.parse(entry);
            default:
              throw new Error(`Unknown entry type: ${(entry as any).type}`);
          }
        });

        return json({ data: transformedResults });
      }

      const listRecordSummaries = async () => {
        const { type, folder, depth } = recordsQueryZ.parse(queryParams);
        const allResults: any[] = [];
        for await (const result of repo.listRecordSummaries({
          pagination: parsePaginationQuery(queryParams),
          folder,
          type,
          depth
        })) {
          if (Result.isFailure(result)) {
            return respondError(result);
          }
          allResults.push(...result.success);
        }

        console.log('Fetched record summaries:', allResults);

        const transformedResults = allResults.map((entry: any) => {
          switch (entry.type) {
            case "published":
              return documentSummaryToJsonApiZ.parse({ ...entry, type: "published-summary" });
            case "unpublished":
              return unpublishedSummaryToJsonApiZ.parse({ ...entry, type: "unpublished-summary" });
            default:
              throw new Error(`Unknown entry type: ${(entry as any).type}`);
          }
        });

        return json({ data: transformedResults });
      }

      // ===== RECORDS =====
      if (resource === "records" && request.method === "GET") {
        return listFullRecords();
      }

      if (resource === "record-summaries" && request.method === "GET") {
        return listRecordSummaries();
      }

      // ===== DOCUMENTS (PUBLISHED) =====
      if (resource === "published" && request.method === "GET" && key) {
        return respondResource(
          await firstResult(repo.getDocument(key)),
          documentToJsonApiZ,
        );
      }

      if (
        resource === "published" &&
        action === "unpublish" &&
        request.method === "POST" &&
        key
      ) {
        const body = await request.json();
        const { data } = unpublishBodyZ.parse(body);
        return respondResource(
          await firstResult(repo.unpublish(key, data.attributes.status)),
          unpublishedToJsonApiZ,
        );
      }

      if (resource === "published" && request.method === "POST") {
        const body = await request.json();
        console.log(
          "Received document creation request:",
          JSON.stringify(body, null, 2),
        );
        const { data } = documentCreateBodyZ.parse(body);
        return respondResource(
          await firstResult(repo.createDocument(data)),
          documentToJsonApiZ,
        );
      }

      if (resource === "published" && request.method === "PATCH" && key) {
        const body = await request.json();
        const data = documentUpdateFromJsonApiZ.parse(body.data);
        const updateData = { ...data, key };
        return respondResource(
          await firstResult(repo.updateDocument(updateData)),
          documentToJsonApiZ,
        );
      }

      if (resource === "published" && request.method === "DELETE" && key) {
        return respondVoid(await firstResult(repo.deleteDocument(key)));
      }

      if (resource === "unpublished" && request.method === "GET" && key) {
        return respondResource(
          await firstResult(repo.getUnpublished(key)),
          unpublishedToJsonApiZ,
        );
      }

      if (
        resource === "unpublished" &&
        action === "publish" &&
        request.method === "POST" &&
        key
      ) {
        return respondResource(
          await firstResult(repo.publish(key)),
          documentToJsonApiZ,
        );
      }

      if (resource === "unpublished" && request.method === "POST") {
        const body = await request.json();
        const { data } = unpublishedCreateBodyZ.parse(body);
        return respondResource(
          await firstResult(repo.createUnpublished(data)),
          unpublishedToJsonApiZ,
        );
      }

      if (resource === "unpublished" && request.method === "PATCH" && key) {
        const body = await request.json();
        const { data: bodyData } = unpublishedUpdateBodyZ.parse(body);
        const updateData = { ...bodyData, key };
        return respondResource(
          await firstResult(repo.updateUnpublished(updateData)),
          unpublishedToJsonApiZ,
        );
      }

      if (resource === "unpublished" && request.method === "DELETE" && key) {
        return respondVoid(await firstResult(repo.deleteUnpublished(key)));
      }

      // ===== REVISIONS =====
      if (resource === "revisions" && request.method === "POST") {
        const body = await request.json();
        const { data } = revisionCreateBodyZ.parse(body);
        return respondResource(
          await firstResult(repo.createRevision(data)),
          revisionToJsonApiZ,
        );
      }

      if (
        resource === "revisions" &&
        request.method === "GET" &&
        key &&
        !action
      ) {
        const generator = repo.listRevisions(key, {
          pagination: parsePaginationQuery(queryParams),
        });

        const allResults: any[] = [];
        for await (const result of generator) {
          if (Result.isFailure(result)) {
            return respondError(result);
          }
          allResults.push(...result.success);
        }

        return respondCollection(
          request,
          allResults,
          revisionToJsonApiZ,
          request.url,
        );
      }

      if (
        resource === "revisions" &&
        request.method === "GET" &&
        key &&
        action
      ) {
        return respondResource(
          await firstResult(repo.getRevision(key, action)),
          revisionToJsonApiZ,
        );
      }

      // ===== ATOMIC OPERATIONS =====
      if (resource === "operations" && request.method === "POST") {
        const body = await request.json();
        const parsedBody = operationsZ.parse(body);

        const atomicOperations = parsedBody["atomic:operations"].map(
          async (operation) => {
            let result: LaikaResult<any>;
            let schema: any = null;

            if (operation.op === "add") {
              if (
                "data" in operation &&
                operation.data.type === "unpublished"
              ) {
                result = await firstResult(repo.createUnpublished(
                  operation.data,
                ));
                schema = unpublishedToJsonApiZ;
              } else if (
                "data" in operation &&
                operation.data.type === "published"
              ) {
                result = await firstResult(repo.createDocument(
                  operation.data,
                ));
                schema = documentToJsonApiZ;
              } else {
                result = Result.fail(new BadRequestError(
                  `Cannot add type: ${(operation as any).data?.type}`,
                ));
              }
              return { op: result, operation, schema };
            }

            if (operation.op === "update") {
              if ("href" in operation && "ref" in operation) {
                // State transition operation
                const { href, ref, data } = operation as z.infer<
                  typeof stateTransitionOpZ
                >;
                switch (href) {
                  case "/publish":
                    if (ref.type === "unpublished") {
                      result = await firstResult(repo.publish(ref.id));
                      schema = documentToJsonApiZ;
                    } else {
                      result = Result.fail(new BadRequestError(
                        `Cannot publish ${ref.type}`,
                      ));
                    }
                    break;
                  case '/unpublish':
                    if (ref.type === "document") {
                      if (!data) {
                        result = Result.fail(new BadRequestError(
                          `Missing data for unpublish operation`,
                        ));
                        break;
                      }
                      result = await firstResult(repo.unpublish(
                        ref.id,
                        data.attributes.status,
                      ));
                      schema = unpublishedToJsonApiZ;
                    } else {
                      result = Result.fail(new BadRequestError(
                        `Cannot unpublish ${ref.type}`,
                      ));
                    }
                  default:
                    result = Result.fail(new BadRequestError(
                      `Unknown action: ${href}`,
                    ));
                }
              } else if ("data" in operation) {
                // Update content operation
                const { data } = operation as z.infer<
                  typeof updateUnpublishedOpZ
                >;
                result = await firstResult(repo.updateUnpublished(data));
                schema = unpublishedToJsonApiZ;
              } else {
                result = Result.fail(new BadRequestError(
                  "Invalid update operation",
                ));
              }
              return { op: result, operation, schema };
            }

            if (operation.op === "remove") {
              const { ref } = operation as z.infer<typeof removeOpZ>;
              if (ref.type === "document") {
                result = await firstResult(repo.deleteDocument(ref.id));
                schema = null;
              } else if (ref.type === "unpublished") {
                result = await firstResult(repo.deleteUnpublished(ref.id));
                schema = null;
              } else {
                result = Result.fail(new BadRequestError(
                  `Cannot remove ${ref.type}`,
                ));
              }
              return { op: result, operation, schema };
            }

            return {
              op: Result.fail(new BadRequestError(
                `Unsupported operation: ${(operation as any).op}`,
              )),
              operation,
              schema: null,
            };
          },
        );

        const atomicsSettled = await Promise.allSettled(atomicOperations);

        const atomicResults = atomicsSettled.map((promiseResult) => {
          if (promiseResult.status === "rejected") {
            return {
              errors: [
                {
                  status: "500",
                  title: "Operation Failed",
                  detail: promiseResult.reason.message,
                },
              ],
            };
          }

          const { op, operation, schema } = promiseResult.value;

          if (Result.isFailure(op)) {
            return {
              errors: [
                {
                  status: "400",
                  title: "Operation Failed",
                  detail: op.failure.message,
                },
              ],
            };
          }

          // For remove operations, return meta instead of data
          if (operation.op === "remove") {
            return {
              meta: {
                deleted: true,
                ref: operation.ref,
              },
            };
          }

          // For other operations, return the transformed data
          if (schema) {
            return { data: schema.parse(op.success) };
          }

          return { data: null };
        });

        return json({
          "atomic:results": atomicResults,
        });
      }

      options.logger?.debug('Documents endpoint not found:', path);
      const error = new NotFoundError("Endpoint not found")

      console.log('error', Result.fail(error))

      return respondError(
        Result.fail(error),
        404,
      );
    },
  };
}
