import { DocumentsRepository } from "@laikacms/documents";
import {
  BadRequestError,
  NotFoundError,
  Result,
  failure,
  ErrorCodeToStatusMap,
  ErrorStatus,
  Logger,
} from "@laikacms/core";
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
function respondError(result: Result<any>, status: ErrorStatus = 400) {
  if (result.success)
    throw new Error("respondError called with success result");
  return json(errorToJsonApiMapper(result), status);
}

// JSON:API success response for single resource
function respondResource<T>(
  result: Result<T>,
  outputSchema: ReturnType<typeof toJsonApi>,
) {
  if (!result.success) {
    // Check if this is a "not found" error and return 404
    const isNotFound =
      result.code === NotFoundError.CODE ||
      result.messages?.some((m) => m.toLowerCase().includes("not found"));
    return respondError(result, isNotFound ? 404 : 400);
  }
  // Wrap the resource in a "data" field per JSON:API spec
  return json({ data: outputSchema.parse(result.data) });
}

// JSON:API success response for void result (delete operations)
function respondVoid(result: Result<void>) {
  if (!result.success) {
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

interface DocumentsApiOptions {
  repo: DocumentsRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Logger | undefined;
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

      const listRecords = async (summaries: boolean) => {
        const { type, folder, depth } = recordsQueryZ.parse(queryParams);
        const generator = summaries ? 
          repo.listRecordSummaries({
            pagination: parsePaginationQuery(queryParams),
            folder,
            type,
            depth
          }) :
          repo.listRecords({
            pagination: parsePaginationQuery(queryParams),
            folder,
            type,
            depth
          });
        
        const allResults = [];
        for await (const result of generator) {
          if (!result.success) {
            return respondError(result);
          }
          allResults.push(...result.data);
        }

        console.log('Fetched records:', allResults);

        // Determine the appropriate schema based on the type and include mode
        const transformedResults = allResults.map((entry) => {
          if (summaries) {
            switch (entry.type) {
              case "published":
                return documentSummaryToJsonApiZ.parse({ ...entry, type: "published-summary" });
              case "unpublished":
                return unpublishedSummaryToJsonApiZ.parse({ ...entry, type: "unpublished-summary" });
              default:
                throw new Error(`Unknown entry type: ${(entry as any).type}`);
            }
          } else {
            switch (entry.type) {
              case "published":
                return documentToJsonApiZ.parse(entry);
              case "unpublished":
                return unpublishedToJsonApiZ.parse(entry);
              default:
                throw new Error(`Unknown entry type: ${(entry as any).type}`);
            }
          }
        });

        return json({ data: transformedResults });
      }

      // ===== RECORDS =====
      if (resource === "records" && request.method === "GET") {
        return listRecords(false);
      }

      if (resource === "record-summaries" && request.method === "GET") {
        return listRecords(true);
      }

      // ===== DOCUMENTS (PUBLISHED) =====
      if (resource === "published" && request.method === "GET" && key) {
        return respondResource(
          await repo.getDocument(key),
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
          await repo.unpublish(key, data.attributes.status),
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
          await repo.createDocument(data),
          documentToJsonApiZ,
        );
      }

      if (resource === "published" && request.method === "PATCH" && key) {
        const body = await request.json();
        const data = documentUpdateFromJsonApiZ.parse(body.data);
        const updateData = { ...data, key };
        return respondResource(
          await repo.updateDocument(updateData),
          documentToJsonApiZ,
        );
      }

      if (resource === "published" && request.method === "DELETE" && key) {
        return respondVoid(await repo.deleteDocument(key));
      }

      if (resource === "unpublished" && request.method === "GET" && key) {
        return respondResource(
          await repo.getUnpublished(key),
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
          await repo.publish(key),
          documentToJsonApiZ,
        );
      }

      if (resource === "unpublished" && request.method === "POST") {
        const body = await request.json();
        const { data } = unpublishedCreateBodyZ.parse(body);
        return respondResource(
          await repo.createUnpublished(data),
          unpublishedToJsonApiZ,
        );
      }

      if (resource === "unpublished" && request.method === "PATCH" && key) {
        const body = await request.json();
        const { data: bodyData } = unpublishedUpdateBodyZ.parse(body);
        const updateData = { ...bodyData, key };
        return respondResource(
          await repo.updateUnpublished(updateData),
          unpublishedToJsonApiZ,
        );
      }

      if (resource === "unpublished" && request.method === "DELETE" && key) {
        return respondVoid(await repo.deleteUnpublished(key));
      }

      // ===== REVISIONS =====
      if (resource === "revisions" && request.method === "POST") {
        const body = await request.json();
        const { data } = revisionCreateBodyZ.parse(body);
        return respondResource(
          await repo.createRevision(data),
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

        const allResults = [];
        for await (const result of generator) {
          if (!result.success) {
            return respondError(result);
          }
          allResults.push(...result.data);
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
          await repo.getRevision(key, action),
          revisionToJsonApiZ,
        );
      }

      // ===== ATOMIC OPERATIONS =====
      if (resource === "operations" && request.method === "POST") {
        const body = await request.json();
        const parsedBody = operationsZ.parse(body);

        const atomicOperations = parsedBody["atomic:operations"].map(
          async (operation) => {
            let result: Result<any>;
            let schema: any = null;

            if (operation.op === "add") {
              if (
                "data" in operation &&
                operation.data.type === "unpublished"
              ) {
                result = await repo.createUnpublished(
                  operation.data,
                );
                schema = unpublishedToJsonApiZ;
              } else if (
                "data" in operation &&
                operation.data.type === "published"
              ) {
                result = await repo.createDocument(
                  operation.data,
                );
                schema = documentToJsonApiZ;
              } else {
                result = failure(BadRequestError.CODE, [
                  `Cannot add type: ${(operation as any).data?.type}`,
                ]);
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
                      result = await repo.publish(ref.id);
                      schema = documentToJsonApiZ;
                    } else {
                      result = failure(BadRequestError.CODE, [
                        `Cannot publish ${ref.type}`,
                      ]);
                    }
                    break;
                  case '/unpublish':
                    if (ref.type === "document") {
                      if (!data) {
                        result = failure(BadRequestError.CODE, [
                          `Missing data for unpublish operation`,
                        ]);
                        break;
                      }
                      result = await repo.unpublish(
                        ref.id,
                        data.attributes.status,
                      );
                      schema = unpublishedToJsonApiZ;
                    } else {
                      result = failure(BadRequestError.CODE, [
                        `Cannot unpublish ${ref.type}`,
                      ]);
                    }
                  default:
                    result = failure(BadRequestError.CODE, [
                      `Unknown action: ${href}`,
                    ]);
                }
              } else if ("data" in operation) {
                // Update content operation
                const { data } = operation as z.infer<
                  typeof updateUnpublishedOpZ
                >;
                result = await repo.updateUnpublished(data);
                schema = unpublishedToJsonApiZ;
              } else {
                result = failure(BadRequestError.CODE, [
                  "Invalid update operation",
                ]);
              }
              return { op: result, operation, schema };
            }

            if (operation.op === "remove") {
              const { ref } = operation as z.infer<typeof removeOpZ>;
              if (ref.type === "document") {
                result = await repo.deleteDocument(ref.id);
                schema = null;
              } else if (ref.type === "unpublished") {
                result = await repo.deleteUnpublished(ref.id);
                schema = null;
              } else {
                result = failure(BadRequestError.CODE, [
                  `Cannot remove ${ref.type}`,
                ]);
              }
              return { op: result, operation, schema };
            }

            return {
              op: failure(BadRequestError.CODE, [
                `Unsupported operation: ${(operation as any).op}`,
              ]),
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

          if (!op.success) {
            return {
              errors: op.messages?.map((m) => ({
                status: "400",
                title: "Operation Failed",
                detail: m,
              })) ?? [
                {
                  status: "400",
                  title: "Operation Failed",
                  detail: "Unknown error",
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
            return { data: schema.parse(op.data) };
          }

          return { data: null };
        });

        return json({
          "atomic:results": atomicResults,
        });
      }

      options.logger?.debug('Documents endpoint not found:', path);
      const error = new NotFoundError("Endpoint not found")

      console.log('error', error.toResult())

      return respondError(
        error.toResult(),
        404,
      );
    },
  };
}
